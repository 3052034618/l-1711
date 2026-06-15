const { Op } = require('sequelize');
const {
  Appointment,
  ApprovalRecord,
  User,
  Employee,
  Department,
  sequelize,
} = require('../models');
const BudgetService = require('./BudgetService');
const { NotificationService } = require('./NotificationService');
const { logger } = require('../utils/logger');

class ApprovalService {
  async getApprovers(deptId, level = 1) {
    const approvers = [];

    let currentDept = await Department.findByPk(deptId);
    let iterations = 0;

    while (currentDept && iterations < 5) {
      iterations++;
      if (currentDept.managerId) {
        approvers.push({
          level: iterations,
          userId: currentDept.managerId,
          deptId: currentDept.id,
          deptName: currentDept.deptName,
          role: iterations === 1 ? '部门主管' : iterations === 2 ? '上级部门主管' : '高管',
        });
      }

      if (approvers.length >= level) break;

      if (currentDept.parentId && currentDept.parentId !== currentDept.id) {
        currentDept = await Department.findByPk(currentDept.parentId);
      } else {
        break;
      }
    }

    return approvers;
  }

  async initApprovalFlow(appointment, budgetCheck, transaction) {
    const { deptId, id: appointmentId, orderNo, totalAmount, employeeId } = appointment;

    if (!budgetCheck.needApproval) {
      appointment.status = 'approved';
      appointment.approvalStatus = 'approved';
      appointment.approvalLevel = 0;
      appointment.currentApproverId = null;
      await appointment.save({ transaction });

      await BudgetService.freezeBudget(
        deptId,
        appointment.year,
        appointment.half,
        totalAmount,
        transaction,
        false
      );

      logger.info(`预约${orderNo}免审批自动通过`);
      return {
        status: 'auto_approved',
        approvalLevel: 0,
        totalLevels: 0,
        currentApprover: null,
        approvers: [],
        records: [],
        isOverBudget: false,
      };
    }

    const level = budgetCheck.approvalLevel;
    const approvers = await this.getApprovers(deptId, level + 1);
    const isOverBudget = !budgetCheck.sufficient;

    if (approvers.length === 0) {
      throw new Error('未找到审批人，请联系HR配置部门主管');
    }

    appointment.status = 'pending_approval';
    appointment.approvalStatus = 'pending';
    appointment.approvalLevel = 1;
    appointment.currentApproverId = approvers[0].userId;
    appointment.isOverBudget = isOverBudget;
    await appointment.save({ transaction });

    const firstApprover = approvers[0];
    let approverName = '待确认';
    try {
      const approverUser = await User.findByPk(firstApprover.userId, { transaction });
      if (approverUser) {
        approverName = approverUser.realName || approverUser.username;
      }
    } catch (e) {
      logger.warn('查询审批人信息失败，继续流程', e.message);
    }

    const firstRecord = await ApprovalRecord.create(
      {
        appointmentId,
        orderNo,
        approverId: firstApprover.userId,
        approverName,
        approvalLevel: 1,
        status: 'pending',
        isOverBudget,
      },
      { transaction }
    );

    setImmediate(() => {
      this._notifyApprover(firstApprover.userId, appointment).catch((e) => {
        logger.error(`[非阻断] 发送审批通知失败，预约已创建: ${appointment.orderNo}`, e.message);
      });
    });

    logger.info(`预约${orderNo}发起审批，第1级审批人：${approverName} (${firstApprover.userId})`);

    return {
      status: 'pending',
      approvalLevel: 1,
      totalLevels: approvers.length,
      currentLevel: 1,
      currentApprover: {
        ...firstApprover,
        name: approverName,
      },
      approvers: approvers.map((a, idx) => ({
        ...a,
        name: idx === 0 ? approverName : '待确认',
      })),
      firstRecord,
      isOverBudget,
      budgetShortage: isOverBudget ? (totalAmount - budgetCheck.available).toFixed(2) : 0,
    };
  }

  async approve(appointmentId, approverId, options = {}) {
    const { remark = '', passToNext = true } = options;

    const result = await sequelize.transaction(async (t) => {
      const appointment = await Appointment.findByPk(appointmentId, { transaction: t });
      if (!appointment) {
        throw new Error('预约不存在');
      }

      if (appointment.approvalStatus !== 'pending') {
        throw new Error('当前状态不可审批');
      }

      if (appointment.currentApproverId !== approverId) {
        throw new Error('您不是当前审批人');
      }

      const currentRecord = await ApprovalRecord.findOne({
        where: {
          appointmentId,
          approverId,
          status: 'pending',
          approvalLevel: appointment.approvalLevel,
        },
        transaction: t,
      });

      if (!currentRecord) {
        throw new Error('未找到待审批记录');
      }

      const approver = await User.findByPk(approverId, { transaction: t });
      const approverName = approver ? approver.realName || approver.username : '未知';

      currentRecord.status = 'approved';
      currentRecord.reason = remark;
      currentRecord.approvalTime = new Date();
      currentRecord.approverName = approverName;
      await currentRecord.save({ transaction: t });

      const budgetInfo = await BudgetService.checkBudgetAndRecommend(
        appointment.deptId,
        appointment.year,
        appointment.half,
        appointment.totalAmount
      );

      const totalLevels = Math.max(1, budgetInfo.approvalLevel + 1);
      const isFinalLevel = appointment.approvalLevel >= totalLevels;

      if (isFinalLevel || !passToNext) {
        appointment.status = 'approved';
        appointment.approvalStatus = 'approved';
        await appointment.save({ transaction: t });

        await BudgetService.freezeBudget(
          appointment.deptId,
          appointment.year,
          appointment.half,
          appointment.totalAmount,
          t,
          !!appointment.isOverBudget
        );

        setImmediate(() => {
          this._notifyApplicant(appointment, 'approved', remark).catch((e) => {
            logger.error('[非阻断] 发送审批通过通知失败', e.message);
          });
        });

        return {
          success: true,
          message: '审批通过',
          status: 'approved',
          isFinal: true,
          isOverBudget: !!appointment.isOverBudget,
        };
      }

      const nextLevel = appointment.approvalLevel + 1;
      const nextApprovers = await this.getApprovers(appointment.deptId, nextLevel + 1);
      const nextApprover = nextApprovers.find((a) => a.level === nextLevel);

      if (!nextApprover) {
        appointment.status = 'approved';
        appointment.approvalStatus = 'approved';
        await appointment.save({ transaction: t });

        await BudgetService.freezeBudget(
          appointment.deptId,
          appointment.year,
          appointment.half,
          appointment.totalAmount,
          t,
          !!appointment.isOverBudget
        );

        setImmediate(() => {
          this._notifyApplicant(appointment, 'approved', remark).catch((e) => {
            logger.error('[非阻断] 发送审批通过通知失败', e.message);
          });
        });

        return {
          success: true,
          message: '审批通过（已无更多审批人）',
          status: 'approved',
          isFinal: true,
          isOverBudget: !!appointment.isOverBudget,
        };
      }

      appointment.approvalLevel = nextLevel;
      appointment.currentApproverId = nextApprover.userId;
      await appointment.save({ transaction: t });

      await ApprovalRecord.create(
        {
          appointmentId,
          orderNo: appointment.orderNo,
          approverId: nextApprover.userId,
          approverName: '待确认',
          approvalLevel: nextLevel,
          status: 'pending',
          isOverBudget: !!appointment.isOverBudget,
        },
        { transaction: t }
      );

      setImmediate(() => {
        this._notifyApprover(nextApprover.userId, appointment).catch((e) => {
          logger.error(`[非阻断] 发送下一级审批通知失败，预约已创建: ${appointment.orderNo}`, e.message);
        });
      });

      return {
        success: true,
        message: `已通过，移交下一级审批`,
        status: 'pending',
        isFinal: false,
        nextApprover: nextApprover.userId,
        nextLevel,
      };
    });

    return result;
  }

  async reject(appointmentId, approverId, reason) {
    const result = await sequelize.transaction(async (t) => {
      const appointment = await Appointment.findByPk(appointmentId, { transaction: t });
      if (!appointment) {
        throw new Error('预约不存在');
      }

      if (appointment.approvalStatus !== 'pending') {
        throw new Error('当前状态不可审批');
      }

      if (appointment.currentApproverId !== approverId) {
        throw new Error('您不是当前审批人');
      }

      const currentRecord = await ApprovalRecord.findOne({
        where: {
          appointmentId,
          approverId,
          status: 'pending',
          approvalLevel: appointment.approvalLevel,
        },
        transaction: t,
      });

      if (!currentRecord) {
        throw new Error('未找到待审批记录');
      }

      const approver = await User.findByPk(approverId, { transaction: t });
      const approverName = approver ? approver.realName || approver.username : '未知';

      currentRecord.status = 'rejected';
      currentRecord.reason = reason;
      currentRecord.approvalTime = new Date();
      currentRecord.approverName = approverName;
      await currentRecord.save({ transaction: t });

      appointment.status = 'rejected';
      appointment.approvalStatus = 'rejected';
      appointment.rejectReason = reason;
      await appointment.save({ transaction: t });

      setImmediate(() => {
        this._notifyApplicant(appointment, 'rejected', reason).catch((e) => {
          logger.error('[非阻断] 发送审批驳回通知失败', e.message);
        });
      });

      return {
        success: true,
        message: '已驳回',
        status: 'rejected',
      };
    });

    return result;
  }

  async transfer(appointmentId, fromApproverId, toApproverId, reason) {
    const appointment = await Appointment.findByPk(appointmentId);
    if (!appointment) {
      throw new Error('预约不存在');
    }

    if (appointment.currentApproverId !== fromApproverId) {
      throw new Error('您不是当前审批人');
    }

    const currentRecord = await ApprovalRecord.findOne({
      where: {
        appointmentId,
        approverId: fromApproverId,
        status: 'pending',
      },
    });

    if (!currentRecord) {
      throw new Error('未找到待审批记录');
    }

    currentRecord.status = 'transferred';
    currentRecord.nextApproverId = toApproverId;
    currentRecord.reason = reason;
    currentRecord.approvalTime = new Date();
    await currentRecord.save();

    appointment.currentApproverId = toApproverId;
    await appointment.save();

    await ApprovalRecord.create({
      appointmentId,
      orderNo: appointment.orderNo,
      approverId: toApproverId,
      approverName: '待确认',
      approvalLevel: appointment.approvalLevel,
      status: 'pending',
      isOverBudget: !!appointment.isOverBudget,
    });

    setImmediate(() => {
      this._notifyApprover(toApproverId, appointment).catch((e) => {
        logger.error(`[非阻断] 发送转审通知失败，预约已创建: ${appointment.orderNo}`, e.message);
      });
    });

    return { success: true, message: '已转审' };
  }

  async getPendingApprovals(approverId, options = {}) {
    const { page = 1, pageSize = 20 } = options;
    const { limit, offset } = (await import('../utils/helpers')).paginate(page, pageSize);

    const { count, rows } = await Appointment.findAndCountAll({
      where: {
        currentApproverId: approverId,
        approvalStatus: 'pending',
        status: 'pending_approval',
      },
      include: [
        { association: 'employee', attributes: ['name', 'empNo'] },
        { association: 'department', attributes: ['deptName'] },
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    return { list: rows, total: count, page, pageSize };
  }

  async getApprovalHistory(appointmentId) {
    const records = await ApprovalRecord.findAll({
      where: { appointmentId },
      order: [['approvalLevel', 'ASC'], ['createdAt', 'ASC']],
    });
    return records;
  }

  async getApprovalWorkbench(approverId, filters = {}, options = {}) {
    const { page = 1, pageSize = 20 } = options;
    const { status = 'pending', isOverBudget, startDate, endDate, deptId, keyword } = filters;
    const { limit, offset } = (await import('../utils/helpers')).paginate(page, pageSize);

    const where = {};
    const recordWhere = { approverId };

    switch (status) {
      case 'pending':
        recordWhere.status = 'pending';
        break;
      case 'approved':
      case 'rejected':
        recordWhere.status = status;
        break;
      case 'transferred':
        recordWhere.status = 'transferred';
        break;
      case 'all':
        break;
      default:
        recordWhere.status = 'pending';
    }

    if (isOverBudget !== undefined && isOverBudget !== null) {
      recordWhere.isOverBudget = isOverBudget === 'true' || isOverBudget === true;
    }

    if (startDate || endDate) {
      recordWhere.createdAt = {};
      if (startDate) recordWhere.createdAt[Op.gte] = new Date(startDate);
      if (endDate) recordWhere.createdAt[Op.lte] = new Date(endDate);
    }

    const appointmentInclude = {
      association: 'appointment',
      attributes: [
        'id', 'orderNo', 'employeeId', 'deptId', 'packageName', 'packagePrice',
        'extraAmount', 'totalAmount', 'year', 'half', 'status', 'approvalStatus',
        'approvalLevel', 'currentApproverId', 'isOverBudget', 'applicantRemark',
        'createdAt'
      ],
      include: [
        { association: 'employee', attributes: ['id', 'name', 'empNo'] },
        { association: 'department', attributes: ['id', 'deptName'] },
      ],
    };

    if (deptId) {
      appointmentInclude.where = { deptId: parseInt(deptId) };
    }

    if (keyword) {
      appointmentInclude.include = appointmentInclude.include || [];
      appointmentInclude.include.push({
        association: 'employee',
        attributes: ['id', 'name', 'empNo'],
        where: {
          [Op.or]: [
            { name: { [Op.like]: `%${keyword}%` } },
            { empNo: { [Op.like]: `%${keyword}%` } },
          ],
        },
        required: true,
      });
    }

    const { count, rows } = await ApprovalRecord.findAndCountAll({
      where: recordWhere,
      include: [appointmentInclude],
      order: [['createdAt', 'DESC']],
      limit,
      offset,
      distinct: true,
    });

    const appointmentIds = rows.map((r) => r.appointmentId);
    const allRecords = await ApprovalRecord.findAll({
      where: { appointmentId: { [Op.in]: appointmentIds } },
      order: [['approvalLevel', 'ASC'], ['createdAt', 'ASC']],
    });

    const recordsMap = {};
    allRecords.forEach((r) => {
      if (!recordsMap[r.appointmentId]) recordsMap[r.appointmentId] = [];
      recordsMap[r.appointmentId].push(r);
    });

    const budgetChecks = {};
    for (const row of rows) {
      const apt = row.appointment;
      if (apt && !budgetChecks[`${apt.deptId}-${apt.year}-${apt.half}`]) {
        try {
          const budget = await BudgetService.getAvailableBudget(apt.deptId, apt.year, apt.half);
          budgetChecks[`${apt.deptId}-${apt.year}-${apt.half}`] = budget;
        } catch (e) {
          logger.warn('查询预算信息失败', e.message);
        }
      }
    }

    const list = rows.map((record) => {
      const apt = record.appointment;
      const budget = apt ? budgetChecks[`${apt.deptId}-${apt.year}-${apt.half}`] : null;
      const history = recordsMap[record.appointmentId] || [];
      const totalLevels = Math.max(...history.map((h) => h.approvalLevel), record.approvalLevel);

      return {
        id: record.id,
        appointmentId: record.appointmentId,
        orderNo: apt?.orderNo,
        approvalLevel: record.approvalLevel,
        totalLevels,
        status: record.status,
        isOverBudget: record.isOverBudget,
        reason: record.reason,
        approvalTime: record.approvalTime,
        createdAt: record.createdAt,
        budgetShortage: apt?.isOverBudget && budget
          ? Math.max(0, apt.totalAmount - (budget.available || 0)).toFixed(2)
          : 0,
        budgetInfo: budget ? {
          total: budget.total,
          available: budget.available,
          usedPercent: budget.usedPercent,
          overBudgetUsed: budget.overBudgetUsed,
        } : null,
        history: history.map((h) => ({
          id: h.id,
          approvalLevel: h.approvalLevel,
          approverName: h.approverName,
          status: h.status,
          reason: h.reason,
          approvalTime: h.approvalTime,
          isOverBudget: h.isOverBudget,
        })),
        employee: apt?.employee ? {
          id: apt.employee.id,
          name: apt.employee.name,
          empNo: apt.employee.empNo,
        } : null,
        department: apt?.department ? {
          id: apt.department.id,
          deptName: apt.department.deptName,
        } : null,
        appointment: apt ? {
          id: apt.id,
          packageName: apt.packageName,
          totalAmount: apt.totalAmount,
          year: apt.year,
          half: apt.half,
          status: apt.status,
          applicantRemark: apt.applicantRemark,
        } : null,
      };
    });

    return { list, total: count, page, pageSize, statusFilter: status };
  }

  async getApprovalDetail(approvalRecordId, approverId) {
    const record = await ApprovalRecord.findOne({
      where: { id: approvalRecordId, approverId },
      include: [
        {
          association: 'appointment',
          include: [
            { association: 'employee', attributes: ['id', 'name', 'empNo', 'phone', 'gender'] },
            { association: 'department', attributes: ['id', 'deptName'] },
            { association: 'checkupPackage', attributes: ['id', 'packageName', 'description'] },
          ],
        },
      ],
    });

    if (!record) {
      throw new Error('审批记录不存在或无权限查看');
    }

    const history = await this.getApprovalHistory(record.appointmentId);
    const budget = await BudgetService.getAvailableBudget(
      record.appointment.deptId,
      record.appointment.year,
      record.appointment.half
    );

    return {
      record,
      appointment: record.appointment,
      history,
      budget,
      budgetShortage: record.isOverBudget
        ? Math.max(0, record.appointment.totalAmount - (budget.available || 0)).toFixed(2)
        : 0,
    };
  }

  async getApprovalStats(approverId) {
    const [pending, approved, rejected, transferred, overBudget] = await Promise.all([
      ApprovalRecord.count({ where: { approverId, status: 'pending' } }),
      ApprovalRecord.count({ where: { approverId, status: 'approved' } }),
      ApprovalRecord.count({ where: { approverId, status: 'rejected' } }),
      ApprovalRecord.count({ where: { approverId, status: 'transferred' } }),
      ApprovalRecord.count({ where: { approverId, isOverBudget: true } }),
    ]);

    return {
      pending,
      approved,
      rejected,
      transferred,
      overBudget,
      total: pending + approved + rejected + transferred,
    };
  }

  async _notifyApprover(approverUserId, appointment) {
    try {
      const result = await NotificationService.create({
        type: 'appointment_approval',
        channel: 'wecom',
        receiverId: approverUserId,
        receiverType: 'employee',
        title: '体检预约待审批',
        content: `您有一条体检预约待审批，单号：${appointment.orderNo}，金额：${appointment.totalAmount}元`,
        relatedType: 'appointment',
        relatedId: appointment.id.toString(),
      });
      if (!result.success) {
        logger.warn(`[非阻断] 审批通知创建失败: ${result.error}`);
      }
    } catch (e) {
      logger.error('[非阻断] 发送审批通知异常', e.message);
    }
  }

  async _notifyApplicant(appointment, result, reason) {
    try {
      const emp = await Employee.findByPk(appointment.employeeId);
      if (emp && emp.id) {
        const notifyResult = await NotificationService.create({
          type: 'approval_result',
          channel: 'system',
          receiverId: emp.id,
          receiverType: 'employee',
          title: result === 'approved' ? '体检预约审批通过' : '体检预约被驳回',
          content:
            result === 'approved'
              ? `您的体检预约（${appointment.orderNo}）已审批通过，请前往确认`
              : `您的体检预约（${appointment.orderNo}）被驳回，原因：${reason || '未说明'}`,
          relatedType: 'appointment',
          relatedId: appointment.id.toString(),
        });
        if (!notifyResult.success) {
          logger.warn(`[非阻断] 审批结果通知创建失败: ${notifyResult.error}`);
        }
      }
    } catch (e) {
      logger.error('[非阻断] 发送审批结果通知异常', e.message);
    }
  }
}

module.exports = new ApprovalService();
