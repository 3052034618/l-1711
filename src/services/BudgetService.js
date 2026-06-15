const { Op } = require('sequelize');
const { Budget, Appointment, ApprovalRecord, Department, Employee, sequelize } = require('../models');
const { getCurrentYear, getYearRange } = require('../utils/helpers');
const { logger } = require('../utils/logger');

class BudgetService {
  async getDeptBudget(deptId, year, half = 'all') {
    const budget = await Budget.findOne({
      where: { deptId, year, half },
    });
    if (!budget) {
      return null;
    }
    return this._formatBudget(budget);
  }

  async getOrCreateDeptBudget(deptId, year, half = 'all') {
    let budget = await Budget.findOne({
      where: { deptId, year, half },
    });

    if (!budget) {
      budget = await Budget.create({
        deptId,
        year,
        half,
        totalAmount: 0,
        usedAmount: 0,
        approvedAmount: 0,
      });
    }

    return this._formatBudget(budget);
  }

  async getAvailableBudget(deptId, year, half = 'all') {
    const budget = await Budget.findOne({
      where: { deptId, year, half },
    });

    if (!budget) {
      return {
        available: 0,
        total: 0,
        used: 0,
        approved: 0,
        overBudgetUsed: 0,
        overBudgetApproved: 0,
        sufficient: false,
      };
    }

    const total = parseFloat(budget.totalAmount) || 0;
    const used = parseFloat(budget.usedAmount) || 0;
    const approved = parseFloat(budget.approvedAmount) || 0;
    const overBudgetUsed = parseFloat(budget.overBudgetUsedAmount) || 0;
    const overBudgetApproved = parseFloat(budget.overBudgetApprovedAmount) || 0;
    const normalAvailable = total - used - approved;

    return {
      available: normalAvailable,
      normalAvailable,
      total,
      used,
      approved,
      overBudgetUsed,
      overBudgetApproved,
      usedPercent: total > 0 ? ((used + approved + overBudgetUsed + overBudgetApproved) / total) * 100 : 0,
      normalUsedPercent: total > 0 ? ((used + approved) / total) * 100 : 0,
      sufficient: normalAvailable > 0,
      hasOverBudget: overBudgetUsed > 0 || overBudgetApproved > 0,
    };
  }

  async checkBudgetAndRecommend(deptId, year, half, amount) {
    const result = await this.getAvailableBudget(deptId, year, half);
    const numAmount = parseFloat(amount) || 0;

    let approvalLevel = 0;
    let needApproval = false;

    if (result.total <= 0) {
      needApproval = true;
      approvalLevel = 3;
    } else if (result.available < numAmount) {
      needApproval = true;
      const deficitPercent = ((numAmount - result.available) / result.total) * 100;
      if (deficitPercent <= 5) {
        approvalLevel = 1;
      } else if (deficitPercent <= 20) {
        approvalLevel = 2;
      } else {
        approvalLevel = 3;
      }
    } else {
      const usageAfter = ((result.used + result.approved + numAmount) / result.total) * 100;
      if (usageAfter >= 90) {
        needApproval = true;
        approvalLevel = 1;
      }
    }

    return {
      ...result,
      requestAmount: numAmount,
      needApproval,
      approvalLevel,
      suggestion: this._getBudgetSuggestion(needApproval, approvalLevel, result, numAmount),
    };
  }

  async freezeBudget(deptId, year, half, amount, transaction, isOverBudget = false) {
    const budget = await Budget.findOne({
      where: { deptId, year, half },
      lock: transaction ? true : false,
      transaction,
    });

    if (!budget) {
      throw new Error('部门预算不存在，请先配置预算');
    }

    const numAmount = parseFloat(amount);

    if (isOverBudget) {
      budget.overBudgetApprovedAmount = parseFloat(budget.overBudgetApprovedAmount) + numAmount;
    } else {
      const available = budget.getNormalAvailable();
      if (available < numAmount) {
        throw new Error(`预算不足，可用额度: ${available}, 申请金额: ${amount}`);
      }
      budget.approvedAmount = parseFloat(budget.approvedAmount) + numAmount;
    }

    await budget.save({ transaction });
    return this._formatBudget(budget);
  }

  async consumeBudget(deptId, year, half, amount, transaction, isOverBudget = false) {
    const budget = await Budget.findOne({
      where: { deptId, year, half },
      lock: true,
      transaction,
    });

    if (!budget) {
      throw new Error('部门预算不存在');
    }

    const numAmount = parseFloat(amount);

    if (isOverBudget) {
      if (parseFloat(budget.overBudgetApprovedAmount) >= numAmount) {
        budget.overBudgetApprovedAmount = parseFloat(budget.overBudgetApprovedAmount) - numAmount;
      }
      budget.overBudgetUsedAmount = parseFloat(budget.overBudgetUsedAmount) + numAmount;
    } else {
      if (parseFloat(budget.approvedAmount) >= numAmount) {
        budget.approvedAmount = parseFloat(budget.approvedAmount) - numAmount;
      }
      budget.usedAmount = parseFloat(budget.usedAmount) + numAmount;
    }

    await budget.save({ transaction });
    return this._formatBudget(budget);
  }

  async unfreezeBudget(deptId, year, half, amount, transaction, isOverBudget = false) {
    const budget = await Budget.findOne({
      where: { deptId, year, half },
      lock: true,
      transaction,
    });

    if (!budget) {
      return null;
    }

    const numAmount = parseFloat(amount);
    if (isOverBudget) {
      if (parseFloat(budget.overBudgetApprovedAmount) >= numAmount) {
        budget.overBudgetApprovedAmount = parseFloat(budget.overBudgetApprovedAmount) - numAmount;
        await budget.save({ transaction });
      }
    } else {
      if (parseFloat(budget.approvedAmount) >= numAmount) {
        budget.approvedAmount = parseFloat(budget.approvedAmount) - numAmount;
        await budget.save({ transaction });
      }
    }

    return this._formatBudget(budget);
  }

  async getDeptBudgetList(deptIds, year) {
    const budgets = await Budget.findAll({
      where: {
        deptId: { [Op.in]: deptIds },
        year,
      },
      raw: true,
    });

    return budgets.map((b) => {
      const total = parseFloat(b.totalAmount) || 0;
      const used = parseFloat(b.usedAmount) || 0;
      const approved = parseFloat(b.approvedAmount) || 0;
      return {
        ...b,
        available: total - used - approved,
        usedPercent: total > 0 ? ((used + approved) / total) * 100 : 0,
      };
    });
  }

  async updateBudget(deptId, year, half, data, operatorId) {
    const budget = await Budget.findOne({
      where: { deptId, year, half },
    });

    if (!budget) {
      return Budget.create({
        deptId,
        year,
        half,
        ...data,
      });
    }

    Object.assign(budget, data);
    await budget.save();
    return budget;
  }

  _formatBudget(budget) {
    const total = parseFloat(budget.totalAmount) || 0;
    const used = parseFloat(budget.usedAmount) || 0;
    const approved = parseFloat(budget.approvedAmount) || 0;
    const overBudgetUsed = parseFloat(budget.overBudgetUsedAmount) || 0;
    const overBudgetApproved = parseFloat(budget.overBudgetApprovedAmount) || 0;
    const normalAvailable = total - used - approved;
    const totalAllUsed = used + overBudgetUsed;
    const totalAllApproved = approved + overBudgetApproved;

    return {
      id: budget.id,
      deptId: budget.deptId,
      year: budget.year,
      half: budget.half,
      totalAmount: total,
      usedAmount: used,
      approvedAmount: approved,
      overBudgetUsedAmount: overBudgetUsed,
      overBudgetApprovedAmount: overBudgetApproved,
      availableAmount: normalAvailable,
      normalAvailable,
      totalUsedAmount: totalAllUsed,
      totalApprovedAmount: totalAllApproved,
      perPersonLimit: budget.perPersonLimit ? parseFloat(budget.perPersonLimit) : null,
      usedPercent: total > 0 ? (totalAllUsed / total) * 100 : 0,
      normalUsedPercent: total > 0 ? ((used + approved) / total) * 100 : 0,
      approverIds: budget.approverIds,
      remark: budget.remark,
      hasOverBudget: overBudgetUsed > 0 || overBudgetApproved > 0,
    };
  }

  _getBudgetSuggestion(needApproval, level, result, amount) {
    if (!needApproval) {
      return {
        level: 'info',
        message: `预算充足，可用额度 ${result.available.toFixed(2)} 元，申请 ${amount.toFixed(2)} 元`,
      };
    }

    const suggestions = {
      1: {
        level: 'warning',
        message: `预算紧张，当前已使用 ${result.usedPercent.toFixed(1)}%，需部门主管审批`,
        approvers: ['部门主管', 'HR专员'],
      },
      2: {
        level: 'danger',
        message: `预算不足，差额 ${(amount - result.available).toFixed(2)} 元，需HR经理审批`,
        approvers: ['部门主管', 'HR经理', '财务'],
      },
      3: {
        level: 'critical',
        message: `预算严重不足或未配置，需总经理审批`,
        approvers: ['部门主管', 'HR总监', '财务总监', '总经理'],
      },
    };

    return suggestions[level] || suggestions[3];
  }

  async getOverBudgetDashboard(filters = {}) {
    const { year, half = 'all', deptId } = filters;
    const targetYear = year ? parseInt(year) : getCurrentYear();

    const where = { year: targetYear };
    if (half !== 'all') where.half = half;
    if (deptId) where.deptId = parseInt(deptId);

    const budgets = await Budget.findAll({
      where,
      include: [{ association: 'department', attributes: ['id', 'deptName'] }],
      order: [['deptId', 'ASC'], ['half', 'ASC']],
    });

    const deptIds = budgets.map((b) => b.deptId);
    const halfValues = half !== 'all' ? [half] : ['1', '2'];

    const appointments = await Appointment.findAll({
      where: {
        deptId: { [Op.in]: deptIds },
        year: targetYear,
        half: { [Op.in]: halfValues },
        isOverBudget: true,
        status: { [Op.in]: ['pending_approval', 'approved', 'confirmed', 'in_progress', 'completed'] },
      },
      include: [
        { association: 'employee', attributes: ['id', 'name', 'empNo'] },
        { association: 'department', attributes: ['id', 'deptName'] },
      ],
      order: [['createdAt', 'DESC']],
    });

    const appointmentIds = appointments.map((a) => a.id);
    const approvalRecords = await ApprovalRecord.findAll({
      where: { appointmentId: { [Op.in]: appointmentIds } },
      order: [['approvalLevel', 'ASC']],
    });

    const recordsMap = {};
    approvalRecords.forEach((r) => {
      if (!recordsMap[r.appointmentId]) recordsMap[r.appointmentId] = [];
      recordsMap[r.appointmentId].push(r);
    });

    const result = {
      year: targetYear,
      half,
      summary: {
        totalBudget: 0,
        normalUsed: 0,
        normalApproved: 0,
        overBudgetApproved: 0,
        overBudgetUsed: 0,
        totalOverBudget: 0,
        overBudgetCount: 0,
      },
      byDept: [],
      byHalf: [],
      overBudgetAppointments: [],
    };

    budgets.forEach((b) => {
      const total = parseFloat(b.totalAmount) || 0;
      const used = parseFloat(b.usedAmount) || 0;
      const approved = parseFloat(b.approvedAmount) || 0;
      const overBudgetApproved = parseFloat(b.overBudgetApprovedAmount) || 0;
      const overBudgetUsed = parseFloat(b.overBudgetUsedAmount) || 0;

      result.summary.totalBudget += total;
      result.summary.normalUsed += used;
      result.summary.normalApproved += approved;
      result.summary.overBudgetApproved += overBudgetApproved;
      result.summary.overBudgetUsed += overBudgetUsed;
      result.summary.totalOverBudget += overBudgetApproved + overBudgetUsed;
    });

    const deptMap = {};
    const halfMap = {};

    budgets.forEach((b) => {
      const total = parseFloat(b.totalAmount) || 0;
      const used = parseFloat(b.usedAmount) || 0;
      const approved = parseFloat(b.approvedAmount) || 0;
      const overBudgetApproved = parseFloat(b.overBudgetApprovedAmount) || 0;
      const overBudgetUsed = parseFloat(b.overBudgetUsedAmount) || 0;
      const normalAvailable = total - used - approved;
      const totalOverBudget = overBudgetApproved + overBudgetUsed;

      if (!deptMap[b.deptId]) {
        deptMap[b.deptId] = {
          deptId: b.deptId,
          deptName: b.department?.deptName || '未知部门',
          totalBudget: 0,
          normalUsed: 0,
          normalApproved: 0,
          normalAvailable: 0,
          overBudgetApproved: 0,
          overBudgetUsed: 0,
          totalOverBudget: 0,
          byHalf: {},
        };
      }

      deptMap[b.deptId].totalBudget += total;
      deptMap[b.deptId].normalUsed += used;
      deptMap[b.deptId].normalApproved += approved;
      deptMap[b.deptId].normalAvailable += normalAvailable;
      deptMap[b.deptId].overBudgetApproved += overBudgetApproved;
      deptMap[b.deptId].overBudgetUsed += overBudgetUsed;
      deptMap[b.deptId].totalOverBudget += totalOverBudget;
      deptMap[b.deptId].byHalf[b.half] = {
        totalBudget: total,
        normalUsed: used,
        normalApproved: approved,
        normalAvailable,
        overBudgetApproved,
        overBudgetUsed,
        totalOverBudget,
      };

      if (!halfMap[b.half]) {
        halfMap[b.half] = {
          half: b.half,
          halfName: b.half === '1' ? '上半年' : b.half === '2' ? '下半年' : '全年',
          totalBudget: 0,
          normalUsed: 0,
          normalApproved: 0,
          normalAvailable: 0,
          overBudgetApproved: 0,
          overBudgetUsed: 0,
          totalOverBudget: 0,
        };
      }

      halfMap[b.half].totalBudget += total;
      halfMap[b.half].normalUsed += used;
      halfMap[b.half].normalApproved += approved;
      halfMap[b.half].normalAvailable += normalAvailable;
      halfMap[b.half].overBudgetApproved += overBudgetApproved;
      halfMap[b.half].overBudgetUsed += overBudgetUsed;
      halfMap[b.half].totalOverBudget += totalOverBudget;
    });

    result.byDept = Object.values(deptMap).map((d) => ({
      ...d,
      usagePercent: d.totalBudget > 0 ? ((d.normalUsed + d.normalApproved) / d.totalBudget) * 100 : 0,
      overBudgetPercent: d.totalBudget > 0 ? (d.totalOverBudget / d.totalBudget) * 100 : 0,
    }));

    result.byHalf = Object.values(halfMap);

    result.overBudgetAppointments = appointments.map((apt) => {
      const records = recordsMap[apt.id] || [];
      const currentRecord = records.find((r) => r.status === 'pending');
      const latestRecord = records[records.length - 1];

      return {
        id: apt.id,
        orderNo: apt.orderNo,
        employee: apt.employee,
        department: apt.department,
        packageName: apt.packageName,
        totalAmount: apt.totalAmount,
        year: apt.year,
        half: apt.half,
        status: apt.status,
        approvalStatus: apt.approvalStatus,
        approvalLevel: apt.approvalLevel,
        currentApproverId: apt.currentApproverId,
        isOverBudget: apt.isOverBudget,
        createdAt: apt.createdAt,
        approvalHistory: records.map((r) => ({
          id: r.id,
          approvalLevel: r.approvalLevel,
          approverName: r.approverName,
          status: r.status,
          reason: r.reason,
          approvalTime: r.approvalTime,
        })),
        currentApproval: currentRecord ? {
          id: currentRecord.id,
          approvalLevel: currentRecord.approvalLevel,
          approverName: currentRecord.approverName,
        } : null,
        latestApproval: latestRecord ? {
          id: latestRecord.id,
          approvalLevel: latestRecord.approvalLevel,
          approverName: latestRecord.approverName,
          status: latestRecord.status,
          reason: latestRecord.reason,
        } : null,
      };
    });

    result.summary.overBudgetCount = result.overBudgetAppointments.length;
    result.summary.normalAvailable = result.summary.totalBudget - result.summary.normalUsed - result.summary.normalApproved;
    result.summary.usagePercent = result.summary.totalBudget > 0
      ? ((result.summary.normalUsed + result.summary.normalApproved) / result.summary.totalBudget) * 100
      : 0;
    result.summary.overBudgetPercent = result.summary.totalBudget > 0
      ? (result.summary.totalOverBudget / result.summary.totalBudget) * 100
      : 0;

    return result;
  }

  async getBudgetDetailRecords(filters = {}, options = {}) {
    const { deptId, year, half, type, page = 1, pageSize = 20 } = filters;
    const { limit, offset } = (await import('../utils/helpers')).paginate(page, pageSize);

    const where = {};
    if (deptId) where.deptId = parseInt(deptId);
    if (year) where.year = parseInt(year);
    if (half && half !== 'all') where.half = half;

    switch (type) {
      case 'normalUsed':
        where.status = { [Op.in]: ['confirmed', 'in_progress', 'completed'] };
        where.isOverBudget = false;
        break;
      case 'normalApproved':
        where.status = { [Op.in]: ['approved', 'pending_approval'] };
        where.approvalStatus = { [Op.in]: ['approved', 'pending'] };
        where.isOverBudget = false;
        break;
      case 'overBudgetApproved':
        where.status = { [Op.in]: ['approved', 'pending_approval'] };
        where.isOverBudget = true;
        break;
      case 'overBudgetUsed':
        where.status = { [Op.in]: ['confirmed', 'in_progress', 'completed'] };
        where.isOverBudget = true;
        break;
      default:
        break;
    }

    const { count, rows } = await Appointment.findAndCountAll({
      where,
      include: [
        { association: 'employee', attributes: ['id', 'name', 'empNo'] },
        { association: 'department', attributes: ['id', 'deptName'] },
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    const appointmentIds = rows.map((a) => a.id);
    const approvalRecords = await ApprovalRecord.findAll({
      where: { appointmentId: { [Op.in]: appointmentIds } },
      order: [['approvalLevel', 'ASC']],
    });

    const recordsMap = {};
    approvalRecords.forEach((r) => {
      if (!recordsMap[r.appointmentId]) recordsMap[r.appointmentId] = [];
      recordsMap[r.appointmentId].push(r);
    });

    const list = rows.map((apt) => ({
      id: apt.id,
      orderNo: apt.orderNo,
      employee: apt.employee,
      department: apt.department,
      packageName: apt.packageName,
      totalAmount: apt.totalAmount,
      year: apt.year,
      half: apt.half,
      status: apt.status,
      approvalStatus: apt.approvalStatus,
      isOverBudget: apt.isOverBudget,
      createdAt: apt.createdAt,
      approvalHistory: recordsMap[apt.id] || [],
    }));

    return { list, total: count, page, pageSize, type };
  }
}

module.exports = new BudgetService();
