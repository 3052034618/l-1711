const { Op } = require('sequelize');
const { AuditLog, User, WarningTicket, sequelize } = require('../models');
const NotificationService = require('./NotificationService');
const { paginate, formatPagedResult } = require('../utils/helpers');
const { logger } = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

class SystemService {
  async log(data) {
    try {
      const {
        userId,
        username,
        employeeId,
        module,
        action,
        resource,
        resourceId,
        method,
        url,
        ip,
        userAgent,
        requestParams,
        oldValue,
        newValue,
        result,
        errorMsg,
        duration,
        detail,
      } = data;

      return await AuditLog.create({
        traceId: uuidv4().replace(/-/g, '').substring(0, 32),
        userId,
        username,
        employeeId,
        module,
        action,
        resource,
        resourceId,
        method,
        url,
        ip,
        userAgent,
        requestParams,
        oldValue,
        newValue,
        result: result || 'success',
        errorMsg,
        duration,
        detail,
      });
    } catch (e) {
      logger.error('写入操作日志失败', e);
    }
  }

  async queryLogs(filters = {}, options = {}) {
    const { page = 1, pageSize = 20 } = options;
    const { limit, offset } = paginate(page, pageSize);

    const where = {};
    if (filters.userId) where.userId = filters.userId;
    if (filters.module) where.module = filters.module;
    if (filters.action) where.action = filters.action;
    if (filters.resource) where.resource = filters.resource;
    if (filters.result) where.result = filters.result;
    if (filters.ip) where.ip = { [Op.like]: `%${filters.ip}%` };

    if (filters.timeRange) {
      where.createdAt = {
        [Op.between]: [filters.timeRange.start, filters.timeRange.end],
      };
    }

    if (filters.keyword) {
      where[Op.or] = [
        { module: { [Op.like]: `%${filters.keyword}%` } },
        { action: { [Op.like]: `%${filters.keyword}%` } },
        { resource: { [Op.like]: `%${filters.keyword}%` } },
      ];
    }

    const { count, rows } = await AuditLog.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    return formatPagedResult(rows, count, page, pageSize);
  }

  async getSystemStats() {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const todayLogs = await AuditLog.count({
      where: { createdAt: { [Op.gte]: todayStart } },
    });

    const totalUsers = await User.count({ where: { status: 1 } });
    const activeWarnings = await WarningTicket.count({
      where: { status: { [Op.in]: ['pending', 'read', 'processing'] } },
    });

    const moduleStats = await AuditLog.findAll({
      attributes: ['module', [sequelize.fn('COUNT', '*'), 'count']],
      where: { createdAt: { [Op.gte]: todayStart } },
      group: ['module'],
      raw: true,
    });

    const actionStats = await AuditLog.findAll({
      attributes: ['action', [sequelize.fn('COUNT', '*'), 'count']],
      where: { createdAt: { [Op.gte]: todayStart } },
      group: ['action'],
      limit: 15,
      raw: true,
      order: [[sequelize.literal('count'), 'DESC']],
    });

    return {
      timestamp: now.toISOString(),
      todayLogs,
      totalUsers,
      activeWarnings,
      moduleStats: Object.fromEntries(
        moduleStats.map((m) => [m.module, parseInt(m.count)])
      ),
      topActions: actionStats.map((a) => ({
        action: a.action,
        count: parseInt(a.count),
      })),
    };
  }

  async pushUnreadWarningsToGroup() {
    const cutoffTime = new Date(
      Date.now() - config.app.warningUnreadHours * 60 * 60 * 1000
    );

    const unreadTickets = await WarningTicket.findAll({
      where: {
        readStatus: { [Op.in]: ['unread'] },
        status: { [Op.in]: ['pending', 'read'] },
        [Op.or]: [
          { lastPushTime: null },
          { lastPushTime: { [Op.lte]: cutoffTime } },
        ],
      },
      include: [
        { association: 'employee', attributes: ['id', 'name'] },
        { association: 'department', attributes: ['id', 'deptName', 'managerId'] },
      ],
      limit: 100,
    });

    const results = { total: unreadTickets.length, pushed: 0, failed: 0 };

    for (const ticket of unreadTickets) {
      try {
        const receivers = [{ id: ticket.employeeId, name: ticket.employeeName }];

        if (ticket.deptManagerId) {
          const User = require('../models').User;
          const user = await User.findByPk(ticket.deptManagerId);
          if (user) {
            receivers.push({ id: user.id, name: user.realName });
          }
        }

        await NotificationService.pushWarningToWecomGroup(ticket, receivers);

        ticket.pushCount = (ticket.pushCount || 0) + 1;
        ticket.lastPushTime = new Date();
        ticket.pushStatus = 'success';
        await ticket.save();
        results.pushed++;
      } catch (e) {
        results.failed++;
        logger.error(`推送预警${ticket.ticketNo}到群失败`, e.message);
      }
    }

    logger.info(
      `超24小时未读预警群推送完成: 总计${results.total}, 成功${results.pushed}, 失败${results.failed}`
    );
    return results;
  }

  async createSystemAnnouncement(data, operatorId) {
    const { type = 'system', title, content, priority = 5 } = data;

    const allUsers = await User.findAll({
      where: { status: 1 },
      attributes: ['id'],
    });

    const notifications = allUsers.map((u) => ({
      type,
      channel: 'system',
      receiverId: u.id,
      receiverType: 'user',
      title,
      content,
      priority,
      payload: { fromSystem: true },
    }));

    const result = await NotificationService.batchCreate(notifications);

    await this.log({
      userId: operatorId,
      module: 'system',
      action: 'announce',
      resource: 'notification',
      result: 'success',
      detail: { announcementCount: notifications.length, title },
    });

    return { sent: result.length };
  }
}

class ConcurrencyControl {
  constructor() {
    this.locks = new Map();
    this.semaphores = new Map();
  }

  async acquireLock(key, timeout = 30000) {
    const startTime = Date.now();
    while (this.locks.has(key)) {
      if (Date.now() - startTime > timeout) {
        throw new Error(`获取锁超时: ${key}`);
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    this.locks.set(key, { acquiredAt: Date.now(), timeout });
    return () => this.locks.delete(key);
  }

  isLocked(key) {
    return this.locks.has(key);
  }

  async acquireSemaphore(key, limit = config.app.concurrentLimit) {
    if (!this.semaphores.has(key)) {
      this.semaphores.set(key, { count: 0, limit, queue: [] });
    }

    const sem = this.semaphores.get(key);

    if (sem.count < sem.limit) {
      sem.count++;
      return () => {
        sem.count--;
        this._processQueue(key);
      };
    }

    return new Promise((resolve) => {
      sem.queue.push(() => {
        sem.count++;
        resolve(() => {
          sem.count--;
          this._processQueue(key);
        });
      });
    });
  }

  _processQueue(key) {
    const sem = this.semaphores.get(key);
    if (!sem || sem.queue.length === 0) return;
    if (sem.count < sem.limit) {
      const next = sem.queue.shift();
      if (next) next();
    }
  }

  getSemaphoreStatus(key) {
    const sem = this.semaphores.get(key);
    if (!sem) return null;
    return {
      count: sem.count,
      limit: sem.limit,
      queueSize: sem.queue.length,
    };
  }
}

const concurrency = new ConcurrencyControl();

module.exports = {
  systemService: new SystemService(),
  concurrency,
  SystemService,
  ConcurrencyControl,
};
module.exports.default = new SystemService();
