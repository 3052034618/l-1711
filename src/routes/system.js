const express = require('express');
const { success, pagedSuccess, asyncHandler } = require('../utils/errorHandler');
const { authRequired, roleRequired } = require('../middleware/auth');
const { systemService } = require('../services/SystemService');
const NotificationService = require('../services/NotificationService');

const router = express.Router();

router.get(
  '/stats',
  authRequired,
  roleRequired('admin', 'hr', 'medical'),
  asyncHandler(async (req, res) => {
    const stats = await systemService.getSystemStats();
    success(res, stats);
  })
);

router.get(
  '/logs',
  authRequired,
  roleRequired('admin', 'hr'),
  asyncHandler(async (req, res) => {
    const filters = {};
    const {
      userId,
      module,
      action,
      resource,
      result,
      ip,
      keyword,
      startTime,
      endTime,
      page = 1,
      pageSize = 20,
    } = req.query;

    if (userId) filters.userId = parseInt(userId);
    if (module) filters.module = module;
    if (action) filters.action = action;
    if (resource) filters.resource = resource;
    if (result) filters.result = result;
    if (ip) filters.ip = ip;
    if (keyword) filters.keyword = keyword;
    if (startTime || endTime) {
      filters.timeRange = {
        start: startTime ? new Date(startTime) : new Date('2020-01-01'),
        end: endTime ? new Date(endTime) : new Date(),
      };
    }

    const result2 = await systemService.queryLogs(filters, {
      page: parseInt(page),
      pageSize: parseInt(pageSize),
    });
    pagedSuccess(res, result2);
  })
);

router.post(
  '/push-unread-warnings',
  authRequired,
  roleRequired('admin', 'hr'),
  asyncHandler(async (req, res) => {
    const result = await systemService.pushUnreadWarningsToGroup();
    success(res, result);
  })
);

router.post(
  '/announcement',
  authRequired,
  roleRequired('admin', 'hr'),
  asyncHandler(async (req, res) => {
    const { title, content, type = 'system', priority = 5 } = req.body;
    if (!title || !content) {
      return res.status(400).json({ code: 400, message: '标题和内容必填' });
    }
    const result = await systemService.createSystemAnnouncement(
      { title, content, type, priority },
      req.user.id
    );
    success(res, result, '公告已发布');
  })
);

router.get(
  '/notifications',
  authRequired,
  asyncHandler(async (req, res) => {
    const filters = {};
    const { type, readStatus, page = 1, pageSize = 20 } = req.query;
    if (type) filters.type = type;
    if (readStatus) filters.readStatus = readStatus;

    const result = await NotificationService.getNotificationList(
      req.user.employeeId || req.user.id,
      filters,
      { page: parseInt(page), pageSize: parseInt(pageSize) }
    );
    pagedSuccess(res, result);
  })
);

router.get(
  '/notifications/unread-count',
  authRequired,
  asyncHandler(async (req, res) => {
    const result = await NotificationService.getUnreadCount(
      req.user.employeeId || req.user.id
    );
    success(res, result);
  })
);

router.post(
  '/notifications/read',
  authRequired,
  asyncHandler(async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ code: 400, message: '请选择通知' });
    }
    const result = await NotificationService.markAsRead(
      ids.map(Number),
      req.user.employeeId || req.user.id
    );
    success(res, result);
  })
);

router.post(
  '/notifications/read-all',
  authRequired,
  asyncHandler(async (req, res) => {
    const result = await NotificationService.markAllAsRead(
      req.user.employeeId || req.user.id
    );
    success(res, result);
  })
);

router.post(
  '/notifications/test-wecom',
  authRequired,
  roleRequired('admin', 'hr'),
  asyncHandler(async (req, res) => {
    const { content = '测试消息 - 企业体检管理系统推送测试' } = req.body;
    const mockTicket = {
      ticketNo: 'WO-TEST',
      employeeName: '测试用户',
      warningType: 'custom',
      warningLevel: 'low',
      title: '测试预警',
      description: content,
      abnormalItems: [],
      suggestions: '这是一条测试消息，请忽略。',
    };
    const result = await NotificationService.pushWarningToWecomGroup(mockTicket, []);
    success(res, { success: result });
  })
);

router.post(
  '/database/sync',
  authRequired,
  roleRequired('admin'),
  asyncHandler(async (req, res) => {
    const { force = false } = req.body;
    const sequelize = require('../config/database');
    try {
      await sequelize.sync({ force: !!force, alter: !force });
      success(res, { force, alter: !force }, '数据库同步成功');
    } catch (e) {
      return res.status(500).json({ code: 500, message: '数据库同步失败: ' + e.message });
    }
  })
);

router.post(
  '/init/sample-data',
  authRequired,
  roleRequired('admin'),
  asyncHandler(async (req, res) => {
    const result = await require('../seed/initSampleData')();
    success(res, result, '示例数据初始化完成');
  })
);

router.get(
  '/health',
  asyncHandler(async (req, res) => {
    const sequelize = require('../config/database');
    try {
      await sequelize.authenticate();
      success(res, {
        status: 'ok',
        timestamp: new Date().toISOString(),
        database: 'connected',
        version: require('../../package.json').version,
      });
    } catch (e) {
      return res.status(503).json({
        code: 503,
        status: 'error',
        timestamp: new Date().toISOString(),
        database: 'disconnected',
        error: e.message,
      });
    }
  })
);

module.exports = router;
