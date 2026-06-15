const { Op } = require('sequelize');
const {
  WarningTicket,
  CheckupReport,
  ReportItem,
  Employee,
  Department,
  User,
  sequelize,
} = require('../models');
const NotificationService = require('./NotificationService');
const { generateWorkOrderNo, paginate, formatPagedResult } = require('../utils/helpers');
const { logger, audit } = require('../utils/logger');
const { NotFoundError, ValidationError, ForbiddenError } = require('../utils/errorHandler');
const config = require('../config');

class WarningService {
  async analyzeReportAndGenerateWarnings(reportId) {
    const report = await CheckupReport.findByPk(reportId, {
      include: [{ association: 'employee' }, { association: 'department' }],
    });

    if (!report) {
      throw new NotFoundError('报告不存在');
    }

    const employee = report.employee;
    const department = report.department;
    if (!employee) {
      throw new NotFoundError('员工数据缺失');
    }

    const reportItems = await ReportItem.findAll({
      where: { reportId },
      raw: true,
    });

    const warnings = [];

    warnings.push(...this._checkConsecutiveAbnormal(report, reportItems));
    warnings.push(...this._checkHighRiskValues(report, reportItems));
    warnings.push(...this._checkMultipleAbnormal(report, reportItems));
    warnings.push(...this._checkHealthScore(report));

    const createdTickets = [];

    for (const warning of warnings) {
      try {
        const ticket = await this._createWarningTicket({
          ...warning,
          report,
          employee,
          department,
          reportItems,
        });
        createdTickets.push(ticket);
      } catch (e) {
        logger.error('创建预警工单失败', e);
      }
    }

    logger.info(
      `分析报告 ${report.reportNo} 完成，生成 ${createdTickets.length} 条预警`
    );

    return {
      reportId,
      reportNo: report.reportNo,
      totalAnalyzed: reportItems.length,
      warningsGenerated: createdTickets.length,
      tickets: createdTickets,
    };
  }

  _checkConsecutiveAbnormal(report, reportItems) {
    const warnings = [];
    const consecutiveItems = reportItems.filter(
      (item) => item.consecutive_abnormal_years >= 2 && item.is_abnormal
    );

    if (consecutiveItems.length === 0) {
      return warnings;
    }

    const highConsecutive = consecutiveItems.filter(
      (item) => item.consecutive_abnormal_years >= 3
    );

    if (highConsecutive.length > 0) {
      warnings.push({
        type: 'consecutive_abnormal',
        level: highConsecutive.some((i) => i.is_high_risk) ? 'critical' : 'high',
        title: `连续${Math.max(...highConsecutive.map((i) => i.consecutive_abnormal_years))}年异常指标预警`,
        description: `员工连续多年体检指标异常，存在慢性疾病风险，建议及时就医检查并调整生活方式。`,
        abnormalItems: highConsecutive.map((i) => ({
          itemCode: i.item_code,
          itemName: i.item_name,
          value: `${i.result_value}${i.unit || ''}`,
          level: i.abnormal_level,
          consecutiveYears: i.consecutive_abnormal_years,
        })),
        suggestions: `建议立即前往相关专科就诊，完善进一步检查。连续异常指标：${highConsecutive.map((i) => i.item_name).join('、')}。`,
      });
    }

    const twoYearItems = consecutiveItems.filter(
      (item) => item.consecutive_abnormal_years === 2
    );

    if (twoYearItems.length > 0 && highConsecutive.length === 0) {
      warnings.push({
        type: 'consecutive_abnormal',
        level: 'high',
        title: '连续2年异常指标预警',
        description: `连续2年出现${twoYearItems.length}项异常指标，需重点关注并干预。`,
        abnormalItems: twoYearItems.map((i) => ({
          itemCode: i.item_code,
          itemName: i.item_name,
          value: `${i.result_value}${i.unit || ''}`,
          level: i.abnormal_level,
          consecutiveYears: 2,
        })),
        suggestions: `建议${twoYearItems.length >= 3 ? '进行专项复查并咨询医生' : '定期复查，调整生活方式，3个月后复查相关指标'}。异常指标：${twoYearItems.map((i) => i.item_name).join('、')}。`,
      });
    }

    return warnings;
  }

  _checkHighRiskValues(report, reportItems) {
    const warnings = [];
    const highRiskItems = reportItems.filter((item) => item.is_high_risk);

    if (highRiskItems.length === 0) {
      return warnings;
    }

    const criticalItems = highRiskItems.filter(
      (i) => i.abnormal_level === 'severe' || i.abnormal_level === 'critical'
    );

    warnings.push({
      type: 'high_risk_value',
      level: criticalItems.length > 0 ? 'critical' : 'high',
      title: `高危值预警（${highRiskItems.length}项）`,
      description: criticalItems.length > 0
        ? `检测到${criticalItems.length}项严重异常指标，存在严重健康风险，请立即就医！`
        : `检测到${highRiskItems.length}项高危指标，建议尽快就医。`,
      abnormalItems: highRiskItems.map((i) => ({
        itemCode: i.item_code,
        itemName: i.item_name,
        value: `${i.result_value}${i.unit || ''}`,
        refRange: i.ref_range,
        level: i.abnormal_level,
      })),
      suggestions:
        criticalItems.length > 0
          ? `紧急建议：请立即前往医院急诊或专科就诊！指标：${criticalItems.map((i) => i.item_name).join('、')}已达危急值。`
          : `建议尽快到相关专科进一步检查，明确诊断并接受规范治疗。`,
    });

    return warnings;
  }

  _checkMultipleAbnormal(report, reportItems) {
    const warnings = [];
    const abnormalItems = reportItems.filter((i) => i.is_abnormal);

    if (abnormalItems.length >= 5) {
      warnings.push({
        type: 'multiple_abnormal',
        level: abnormalItems.length >= 8 ? 'high' : 'medium',
        title: `多项指标异常（${abnormalItems.length}项）`,
        description: `本次体检共发现${abnormalItems.length}项异常指标，涉及多个系统，提示整体健康状况下降。`,
        abnormalItems: abnormalItems.slice(0, 10).map((i) => ({
          itemCode: i.item_code,
          itemName: i.item_name,
          value: `${i.result_value}${i.unit || ''}`,
          level: i.abnormal_level,
        })),
        suggestions: `建议进行全面健康评估，调整生活方式，必要时进行针对性体检复查。异常指标较多，建议寻求健康管理师专业指导。`,
      });
    }

    return warnings;
  }

  _checkHealthScore(report) {
    const warnings = [];
    const score = parseFloat(report.totalScore);

    if (isNaN(score)) {
      return warnings;
    }

    if (score < 60) {
      warnings.push({
        type: 'health_score_low',
        level: 'high',
        title: `健康评分偏低（${score.toFixed(1)}分）`,
        description: `本次体检健康综合评分${score.toFixed(1)}分，低于及格线，健康状况需重点关注。`,
        abnormalItems: [],
        suggestions: `健康评分严重偏低，建议尽快进行系统性检查，并制定个性化健康改善计划。建议减少加班熬夜，规律作息，均衡饮食，适度运动。`,
      });
    } else if (score < 75) {
      warnings.push({
        type: 'health_score_low',
        level: 'medium',
        title: `健康评分需关注（${score.toFixed(1)}分）`,
        description: `本次体检健康综合评分${score.toFixed(1)}分，存在多项健康风险因素。`,
        abnormalItems: [],
        suggestions: `建议关注体检异常项目，制定改善计划，3-6个月后复查评估效果。保持良好作息，坚持运动。`,
      });
    }

    return warnings;
  }

  async _createWarningTicket(data) {
    const { type, level, title, description, abnormalItems, suggestions, report, employee, department } = data;

    const existing = await WarningTicket.findOne({
      where: {
        reportId: report.id,
        warningType: type,
      },
    });

    if (existing) {
      logger.info(`预警工单已存在，跳过创建: ${report.reportNo}-${type}`);
      return existing;
    }

    const deptManagerId = department ? department.managerId : null;

    const ticket = await WarningTicket.create({
      ticketNo: generateWorkOrderNo(),
      employeeId: employee.id,
      employeeName: employee.name,
      deptId: department ? department.id : null,
      deptManagerId,
      reportId: report.id,
      reportItemIds: abnormalItems.map((a) => a.id || a.itemCode),
      warningType: type,
      warningLevel: level,
      title,
      description,
      abnormalItems,
      suggestions,
      status: 'pending',
      readStatus: 'unread',
      pushStatus: 'pending',
      sourceType: 'auto',
    });

    await this._dispatchWarningNotifications(ticket, employee, department);

    return ticket;
  }

  async _dispatchWarningNotifications(ticket, employee, department) {
    try {
      await NotificationService.create({
        type: 'warning',
        channel: 'system',
        receiverId: employee.id,
        receiverType: 'employee',
        title: `【健康预警】${ticket.title}`,
        content: `${ticket.description}\n\n建议：${ticket.suggestions}`,
        relatedType: 'warning_ticket',
        relatedId: ticket.id.toString(),
        priority: ticket.warningLevel === 'critical' ? 10 : ticket.warningLevel === 'high' ? 8 : 5,
      });

      if (ticket.deptManagerId) {
        await NotificationService.create({
          type: 'warning',
          channel: 'system',
          receiverId: ticket.deptManagerId,
          receiverType: 'employee',
          title: `【下属健康预警】${ticket.employeeName} - ${ticket.title}`,
          content: `您的下属${ticket.employeeName}体检发现健康预警：\n${ticket.description}\n\n请关注员工健康状况，必要时协调工作安排。`,
          relatedType: 'warning_ticket',
          relatedId: ticket.id.toString(),
          priority: ticket.warningLevel === 'critical' ? 9 : 6,
        });
      }

      ticket.pushCount = (ticket.pushCount || 0) + 1;
      ticket.pushStatus = 'success';
      ticket.lastPushTime = new Date();
      await ticket.save();

      if (ticket.warningLevel === 'critical' || ticket.warningLevel === 'high') {
        const receivers = [
          { id: employee.id, name: employee.name },
        ];
        if (department && department.managerId) {
          const manager = await Employee.findByPk(department.managerId);
          if (manager) {
            receivers.push({ id: manager.id, name: manager.name });
          }
        }
        try {
          await NotificationService.pushWarningToWecomGroup(ticket, receivers);
        } catch (e) {
          logger.warn('企业微信群推送失败，已记录到系统通知', e.message);
        }
      }
    } catch (error) {
      logger.error('发送预警通知失败', error);
      ticket.pushStatus = 'failed';
      await ticket.save();
    }
  }

  async processUnreadWarningsPush() {
    const cutoffTime = new Date(Date.now() - config.app.warningUnreadHours * 60 * 60 * 1000);

    const pendingTickets = await WarningTicket.findAll({
      where: {
        readStatus: { [Op.notIn]: ['all_read', 'employee_read'] },
        status: { [Op.notIn]: ['closed', 'resolved'] },
        pushCount: { [Op.lte]: 5 },
        [Op.or]: [
          { lastPushTime: { [Op.lte]: cutoffTime } },
          { lastPushTime: null },
        ],
      },
      include: [
        { association: 'employee', attributes: ['id', 'name'] },
        { association: 'department', attributes: ['id', 'deptName', 'managerId'] },
      ],
      limit: 200,
    });

    const results = { total: pendingTickets.length, pushed: 0, failed: 0 };

    for (const ticket of pendingTickets) {
      try {
        const receivers = [{ id: ticket.employee.id, name: ticket.employee.name }];

        if (ticket.deptManagerId) {
          const manager = await Employee.findByPk(ticket.deptManagerId);
          if (manager) receivers.push({ id: manager.id, name: manager.name });
        }

        await NotificationService.pushWarningToWecomGroup(ticket, receivers);

        ticket.pushCount = (ticket.pushCount || 0) + 1;
        ticket.lastPushTime = new Date();
        ticket.pushStatus = 'success';
        await ticket.save();

        results.pushed++;
      } catch (error) {
        ticket.pushStatus = 'failed';
        await ticket.save();
        results.failed++;
        logger.error(`推送预警失败: ${ticket.ticketNo}`, error.message);
      }
    }

    logger.info(
      `处理未读预警推送: 总计${results.total}, 成功${results.pushed}, 失败${results.failed}`
    );
    return results;
  }

  async getTicketList(filters = {}, options = {}) {
    const { page = 1, pageSize = 20 } = options;
    const { limit, offset } = paginate(page, pageSize);

    const where = {};
    if (filters.ticketNo) where.ticketNo = { [Op.like]: `%${filters.ticketNo}%` };
    if (filters.employeeId) where.employeeId = filters.employeeId;
    if (filters.deptId) where.deptId = filters.deptId;
    if (filters.deptManagerId) where.deptManagerId = filters.deptManagerId;
    if (filters.reportId) where.reportId = filters.reportId;
    if (filters.warningType) where.warningType = filters.warningType;
    if (filters.warningLevel) where.warningLevel = filters.warningLevel;
    if (filters.status) where.status = filters.status;
    if (filters.readStatus) where.readStatus = filters.readStatus;
    if (filters.onlyMineEmployee) where.employeeId = filters.onlyMineEmployee;
    if (filters.onlyMineDept) where.deptManagerId = filters.onlyMineDept;

    if (filters.createdAtRange) {
      where.createdAt = {
        [Op.between]: [filters.createdAtRange.start, filters.createdAtRange.end],
      };
    }

    const { count, rows } = await WarningTicket.findAndCountAll({
      where,
      include: [
        { association: 'employee', attributes: ['id', 'name', 'empNo'] },
        { association: 'department', attributes: ['id', 'deptName'] },
        { association: 'report', attributes: ['id', 'reportNo', 'checkupDate', 'year'] },
      ],
      order: [
        ['warningLevel', 'DESC'],
        ['createdAt', 'DESC'],
      ],
      limit,
      offset,
    });

    return formatPagedResult(rows, count, page, pageSize);
  }

  async getTicketDetail(ticketId, userId, userRole) {
    const ticket = await WarningTicket.findByPk(ticketId, {
      include: [
        { association: 'employee', attributes: ['id', 'name', 'empNo', 'phone', 'gender', 'age'] },
        { association: 'department', attributes: ['id', 'deptName'] },
        { association: 'report' },
      ],
    });

    if (!ticket) {
      throw new NotFoundError('预警工单不存在');
    }

    const hasPermission =
      userRole === 'admin' ||
      userRole === 'hr' ||
      userRole === 'medical' ||
      ticket.employeeId === userId ||
      ticket.deptManagerId === userId;

    if (!hasPermission) {
      throw new ForbiddenError('无权限查看此预警工单');
    }

    return ticket;
  }

  async markTicketRead(ticketId, userId, role) {
    const ticket = await WarningTicket.findByPk(ticketId);
    if (!ticket) {
      throw new NotFoundError('预警工单不存在');
    }

    const isEmployee = ticket.employeeId === userId;
    const isManager = ticket.deptManagerId === userId;
    const isAdmin = ['admin', 'hr', 'medical'].includes(role);

    if (!isEmployee && !isManager && !isAdmin) {
      throw new ForbiddenError('无权限操作此工单');
    }

    const oldReadStatus = ticket.readStatus;

    if (isEmployee && oldReadStatus === 'unread') {
      ticket.readStatus = 'employee_read';
    } else if (isManager && oldReadStatus === 'unread') {
      ticket.readStatus = 'manager_read';
    } else if ((isEmployee && oldReadStatus === 'manager_read') || (isManager && oldReadStatus === 'employee_read')) {
      ticket.readStatus = 'all_read';
    } else if (isAdmin) {
      ticket.readStatus = 'all_read';
    }

    if (!ticket.firstReadTime) {
      ticket.firstReadTime = new Date();
    }

    if (ticket.status === 'pending') {
      ticket.status = 'read';
    }

    await ticket.save();

    return ticket;
  }

  async handleTicket(ticketId, handlerId, action, remark) {
    const ticket = await WarningTicket.findByPk(ticketId);
    if (!ticket) {
      throw new NotFoundError('预警工单不存在');
    }

    const validActions = ['processing', 'resolved', 'closed', 'ignored'];
    if (!validActions.includes(action)) {
      throw new ValidationError('无效的处理操作');
    }

    ticket.status = action;
    ticket.handlerId = handlerId;
    ticket.handleTime = new Date();
    if (remark) {
      ticket.handleRemark = remark;
    }

    await ticket.save();

    audit(handlerId, 'handle', 'warning_ticket', {
      id: ticketId,
      action,
      remark,
    });

    return ticket;
  }

  async getDashboardStats(filters = {}) {
    const where = {};
    if (filters.deptId) where.deptId = filters.deptId;
    if (filters.employeeId) where.employeeId = filters.employeeId;

    const totalCount = await WarningTicket.count({ where });

    const levelStats = await WarningTicket.findAll({
      attributes: ['warningLevel', [sequelize.fn('COUNT', '*'), 'count']],
      where,
      group: ['warningLevel'],
      raw: true,
    });

    const statusStats = await WarningTicket.findAll({
      attributes: ['status', [sequelize.fn('COUNT', '*'), 'count']],
      where,
      group: ['status'],
      raw: true,
    });

    const typeStats = await WarningTicket.findAll({
      attributes: ['warningType', [sequelize.fn('COUNT', '*'), 'count']],
      where,
      group: ['warningType'],
      raw: true,
    });

    const unreadCount = await WarningTicket.count({
      where: {
        ...where,
        readStatus: { [Op.in]: ['unread'] },
      },
    });

    const pendingCount = await WarningTicket.count({
      where: {
        ...where,
        status: { [Op.in]: ['pending', 'read', 'processing'] },
      },
    });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayNewCount = await WarningTicket.count({
      where: {
        ...where,
        createdAt: { [Op.gte]: todayStart },
      },
    });

    return {
      total: totalCount,
      unread: unreadCount,
      pending: pendingCount,
      todayNew: todayNewCount,
      byLevel: Object.fromEntries(levelStats.map((s) => [s.warningLevel, parseInt(s.count)])),
      byStatus: Object.fromEntries(statusStats.map((s) => [s.status, parseInt(s.count)])),
      byType: Object.fromEntries(typeStats.map((s) => [s.warningType, parseInt(s.count)])),
    };
  }

  async createManualTicket(data, operatorId) {
    const {
      employeeId,
      warningType = 'custom',
      warningLevel = 'medium',
      title,
      description,
      suggestions = '',
      reportId = null,
      abnormalItems = [],
      assigneeId = null,
      dueTime = null,
    } = data;

    const employee = await Employee.findByPk(employeeId, {
      include: [{ association: 'department' }],
    });
    if (!employee) {
      throw new NotFoundError('员工不存在');
    }

    const ticket = await WarningTicket.create({
      ticketNo: generateWorkOrderNo(),
      employeeId,
      employeeName: employee.name,
      deptId: employee.deptId,
      deptManagerId: employee.department?.managerId || null,
      reportId,
      warningType,
      warningLevel,
      title,
      description,
      suggestions,
      abnormalItems,
      assigneeId,
      dueTime,
      status: 'pending',
      readStatus: 'unread',
      pushStatus: 'pending',
      sourceType: 'manual',
      createdBy: operatorId,
    });

    await this._dispatchWarningNotifications(ticket, employee, employee.department);

    audit(operatorId, 'create_manual', 'warning_ticket', {
      id: ticket.id,
      ticketNo: ticket.ticketNo,
      employeeId,
    });

    return ticket;
  }

  async batchHandleTickets(ticketIds, handlerId, action, remark) {
    const result = { success: 0, failed: 0, errors: [] };

    for (const ticketId of ticketIds) {
      try {
        await this.handleTicket(ticketId, handlerId, action, remark);
        result.success++;
      } catch (error) {
        result.failed++;
        result.errors.push({ ticketId, error: error.message });
      }
    }

    return result;
  }
}

module.exports = new WarningService();
module.exports.WarningService = WarningService;
