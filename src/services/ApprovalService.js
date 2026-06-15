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
          t
        );

        return {
          success: true,
          message: '审批通过（已无更多审批人）',
          status: 'approved',
          isFinal: true,
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
        },
        { transaction: t }
      );

      this._notifyApprover(nextApprover.userId, appointment);

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

      await this._notifyApplicant(appointment, 'rejected', reason);

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
    });

    this._notifyApprover(toApproverId, appointment);

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

  _notifyApprover(approverUserId, appointment) {
    NotificationService.create({
      type: 'appointment_approval',
      channel: 'wecom',
      receiverId: approverUserId,
      receiverType: 'employee',
      title: '体检预约待审批',
      content: `您有一条体检预约待审批，单号：${appointment.orderNo}，金额：${appointment.totalAmount}元`,
      relatedType: 'appointment',
      relatedId: appointment.id.toString(),
    }).catch((e) => logger.error('发送审批通知失败', e));
  }

  _notifyApplicant(appointment, result, reason) {
    const employee = Employee.findByPk(appointment.employeeId).then((emp) => {
      if (emp && emp.id) {
        NotificationService.create({
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
        }).catch((e) => logger.error('发送审批结果通知失败', e));
      }
    });
  }
}

module.exports = new ApprovalService();
