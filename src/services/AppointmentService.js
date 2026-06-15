const { Op } = require('sequelize');
const {
  Appointment,
  Employee,
  Department,
  CheckupPackage,
  CheckupOrder,
  sequelize,
} = require('../models');
const PackageRecommendationService = require('./PackageRecommendationService');
const BudgetService = require('./BudgetService');
const ApprovalService = require('./ApprovalService');
const { generateOrderNo, paginate, formatPagedResult, getCurrentYear } = require('../utils/helpers');
const { logger, audit } = require('../utils/logger');
const { NotFoundError, ConflictError, ValidationError } = require('../utils/errorHandler');

class AppointmentService {
  async createAppointment(data, operatorId) {
    const {
      employeeId,
      packageId,
      extraItems = [],
      preferredDate,
      hospitalId,
      applicantRemark = '',
    } = data;

    const employee = await Employee.findByPk(employeeId);
    if (!employee) {
      throw new NotFoundError('员工不存在');
    }

    const pkg = await CheckupPackage.findByPk(packageId);
    if (!pkg || pkg.status !== 1) {
      throw new NotFoundError('套餐不存在或已下架');
    }

    const year = getCurrentYear();
    const currentMonth = new Date().getMonth() + 1;
    const half = currentMonth <= 6 ? '1' : '2';

    const existingCount = await Appointment.count({
      where: {
        employeeId,
        year,
        status: { [Op.notIn]: ['rejected', 'cancelled', 'draft'] },
      },
    });

    const checkupTimes = existingCount + 1;
    if (checkupTimes > 2) {
      throw new ConflictError('本年度体检次数已达上限（2次）');
    }

    const packagePrice = parseFloat(pkg.price) || 0;
    const extraAmount = extraItems.reduce(
      (sum, item) => sum + (parseFloat(item.price) || 0),
      0
    );
    const totalAmount = packagePrice + extraAmount;

    const budgetCheck = await BudgetService.checkBudgetAndRecommend(
      employee.deptId,
      year,
      half,
      totalAmount
    );

    const result = await sequelize.transaction(async (t) => {
      const appointment = await Appointment.create(
        {
          orderNo: generateOrderNo(),
          employeeId,
          deptId: employee.deptId,
          packageId,
          packageName: pkg.pkgName,
          packagePrice,
          extraItems,
          extraAmount,
          totalAmount,
          hospitalId: hospitalId || pkg.hospitalId,
          preferredDate,
          year,
          half,
          checkupTimes,
          budgetSnapshot: budgetCheck,
          applicantRemark,
          createdBy: operatorId || employeeId,
        },
        { transaction: t }
      );

      const approvalResult = await ApprovalService.initApprovalFlow(
        appointment,
        budgetCheck,
        t
      );

      return {
        appointment,
        approvalResult,
        budgetCheck,
      };
    });

    audit(operatorId, 'create', 'appointment', {
      id: result.appointment.id,
      orderNo: result.appointment.orderNo,
      totalAmount,
      employeeId,
    });

    logger.info(`创建预约成功: ${result.appointment.orderNo}`);

    const response = {
      appointment: {
        id: result.appointment.id,
        orderNo: result.appointment.orderNo,
        employeeId: result.appointment.employeeId,
        deptId: result.appointment.deptId,
        packageId: result.appointment.packageId,
        packageName: result.appointment.packageName,
        totalAmount: result.appointment.totalAmount,
        status: result.appointment.status,
        approvalStatus: result.appointment.approvalStatus,
        approvalLevel: result.approvalResult.approvalLevel,
        totalLevels: result.approvalResult.totalLevels,
        currentLevel: result.approvalResult.currentLevel,
        currentApprover: result.approvalResult.currentApprover,
        isOverBudget: result.approvalResult.isOverBudget,
        budgetShortage: result.approvalResult.budgetShortage,
        isNeedApproval: result.budgetCheck.needApproval,
        approvalSuggestion: result.budgetCheck.suggestion,
      },
      budgetCheck: result.budgetCheck,
    };

    if (result.approvalResult.approvers) {
      response.appointment.approvers = result.approvalResult.approvers;
    }

    return response;
  }

  async getRecommendationsAndCreatePreview(employeeId, packageId, extraItems = []) {
    const recommendations = await PackageRecommendationService.recommendPackages(employeeId);

    let pkgPreview = null;
    if (packageId) {
      const pkg = await CheckupPackage.findByPk(packageId);
      const employee = await Employee.findByPk(employeeId);
      if (pkg && employee) {
        const year = getCurrentYear();
        const currentMonth = new Date().getMonth() + 1;
        const half = currentMonth <= 6 ? '1' : '2';

        const packagePrice = parseFloat(pkg.price) || 0;
        const extraAmount = extraItems.reduce(
          (sum, item) => sum + (parseFloat(item.price) || 0),
          0
        );
        const totalAmount = packagePrice + extraAmount;

        const budgetCheck = await BudgetService.checkBudgetAndRecommend(
          employee.deptId,
          year,
          half,
          totalAmount
        );

        pkgPreview = {
          package: {
            id: pkg.id,
            name: pkg.pkgName,
            price: packagePrice,
            items: pkg.items,
          },
          extraItems,
          extraAmount,
          totalAmount,
          budgetCheck,
          year,
          half,
        };
      }
    }

    return {
      recommendations,
      preview: pkgPreview,
    };
  }

  async confirmAppointment(appointmentId, employeeId, confirmData = {}) {
    const appointment = await Appointment.findByPk(appointmentId);
    if (!appointment) {
      throw new NotFoundError('预约不存在');
    }

    if (appointment.employeeId !== employeeId) {
      throw new ValidationError('只能确认自己的预约');
    }

    if (appointment.status !== 'approved') {
      throw new ValidationError('预约未通过审批，无法确认');
    }

    appointment.status = 'confirmed';
    appointment.confirmTime = new Date();
    if (confirmData.preferredDate) {
      appointment.preferredDate = confirmData.preferredDate;
    }
    await appointment.save();

    logger.info(`员工确认预约: ${appointment.orderNo}`);

    return appointment;
  }

  async cancelAppointment(appointmentId, operatorId, reason = '') {
    const result = await sequelize.transaction(async (t) => {
      const appointment = await Appointment.findByPk(appointmentId, {
        lock: true,
        transaction: t,
      });

      if (!appointment) {
        throw new NotFoundError('预约不存在');
      }

      if (['completed', 'in_progress'].includes(appointment.status)) {
        throw new ConflictError('当前状态不可取消');
      }

      const oldStatus = appointment.status;
      appointment.status = 'cancelled';
      appointment.rejectReason = reason || '用户取消';
      await appointment.save({ transaction: t });

      if (oldStatus === 'approved' || oldStatus === 'confirmed') {
        await BudgetService.unfreezeBudget(
          appointment.deptId,
          appointment.year,
          appointment.half,
          appointment.totalAmount,
          t,
          !!appointment.isOverBudget
        );
      }

      return appointment;
    });

    audit(operatorId, 'cancel', 'appointment', {
      id: appointmentId,
      reason,
    });

    return result;
  }

  async getAppointmentList(filters = {}, options = {}) {
    const { page = 1, pageSize = 20 } = options;
    const { limit, offset } = paginate(page, pageSize);

    const where = {};

    if (filters.employeeId) where.employeeId = filters.employeeId;
    if (filters.deptId) where.deptId = filters.deptId;
    if (filters.status) where.status = filters.status;
    if (filters.year) where.year = filters.year;
    if (filters.half) where.half = filters.half;
    if (filters.approvalStatus) where.approvalStatus = filters.approvalStatus;
    if (filters.orderNo) where.orderNo = { [Op.like]: `%${filters.orderNo}%` };
    if (filters.currentApproverId) where.currentApproverId = filters.currentApproverId;

    if (filters.dateRange) {
      where.createdAt = {
        [Op.between]: [filters.dateRange.start, filters.dateRange.end],
      };
    }

    const { count, rows } = await Appointment.findAndCountAll({
      where,
      include: [
        { association: 'employee', attributes: ['id', 'name', 'empNo', 'gender'] },
        { association: 'department', attributes: ['id', 'deptName'] },
        { association: 'package', attributes: ['id', 'pkgName', 'price', 'pkgType'] },
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    return formatPagedResult(rows, count, page, pageSize);
  }

  async getAppointmentDetail(id) {
    const appointment = await Appointment.findByPk(id, {
      include: [
        { association: 'employee', attributes: ['id', 'name', 'empNo', 'gender', 'birthday', 'phone'] },
        { association: 'department', attributes: ['id', 'deptName'] },
        { association: 'package' },
      ],
    });

    if (!appointment) {
      throw new NotFoundError('预约不存在');
    }

    const approvalHistory = await ApprovalService.getApprovalHistory(id);
    const checkupOrder = await CheckupOrder.findOne({
      where: { appointmentId: id },
    });

    return {
      ...appointment.toJSON(),
      approvalHistory,
      checkupOrder,
    };
  }

  async getEmployeeAppointmentHistory(employeeId, options = {}) {
    return this.getAppointmentList({ employeeId }, options);
  }

  async getCurrentYearAppointments(employeeId) {
    const year = getCurrentYear();
    const appointments = await Appointment.findAll({
      where: {
        employeeId,
        year,
        status: { [Op.not]: 'draft' },
      },
      order: [['createdAt', 'DESC']],
    });

    return {
      year,
      totalCount: appointments.length,
      completedCount: appointments.filter((a) => a.status === 'completed').length,
      list: appointments,
    };
  }

  async getDeptAppointmentStats(deptId, year) {
    const where = { year };
    if (deptId) where.deptId = deptId;

    const appointments = await Appointment.findAll({ where });

    const stats = {
      year,
      total: appointments.length,
      byStatus: {},
      byHalf: { '1': 0, '2': 0 },
      totalAmount: 0,
    };

    appointments.forEach((a) => {
      stats.byStatus[a.status] = (stats.byStatus[a.status] || 0) + 1;
      stats.byHalf[a.half] = (stats.byHalf[a.half] || 0) + 1;
      if (a.status !== 'rejected' && a.status !== 'cancelled' && a.status !== 'draft') {
        stats.totalAmount += parseFloat(a.totalAmount) || 0;
      }
    });

    return stats;
  }
}

module.exports = new AppointmentService();
