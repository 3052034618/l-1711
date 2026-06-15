const express = require('express');
const Joi = require('joi');
const { success, pagedSuccess, asyncHandler } = require('../utils/errorHandler');
const { authRequired, roleRequired } = require('../middleware/auth');
const WarningService = require('../services/WarningService');

const router = express.Router();

router.get(
  '/stats',
  authRequired,
  asyncHandler(async (req, res) => {
    const filters = {};
    const { deptId, employeeId } = req.query;

    if (req.user.role === 'employee') {
      filters.employeeId = req.user.employeeId;
    } else if (req.user.role === 'manager') {
      if (deptId) filters.deptId = parseInt(deptId);
      else filters.deptManagerId = req.user.id;
    } else {
      if (deptId) filters.deptId = parseInt(deptId);
      if (employeeId) filters.employeeId = parseInt(employeeId);
    }

    const stats = await WarningService.getDashboardStats(filters);
    success(res, stats);
  })
);

router.get(
  '/',
  authRequired,
  asyncHandler(async (req, res) => {
    const filters = {};
    const {
      ticketNo,
      employeeId,
      deptId,
      reportId,
      warningType,
      warningLevel,
      status,
      readStatus,
      deptManagerId,
      page = 1,
      pageSize = 20,
    } = req.query;

    if (req.user.role === 'employee') {
      filters.employeeId = req.user.employeeId;
    } else if (req.user.role === 'manager') {
      if (employeeId) filters.employeeId = parseInt(employeeId);
      else if (deptId) filters.deptId = parseInt(deptId);
      else filters.deptManagerId = req.user.id;
    } else {
      if (ticketNo) filters.ticketNo = ticketNo;
      if (employeeId) filters.employeeId = parseInt(employeeId);
      if (deptId) filters.deptId = parseInt(deptId);
      if (reportId) filters.reportId = parseInt(reportId);
      if (deptManagerId) filters.deptManagerId = parseInt(deptManagerId);
    }

    if (warningType) filters.warningType = warningType;
    if (warningLevel) filters.warningLevel = warningLevel;
    if (status) filters.status = status;
    if (readStatus) filters.readStatus = readStatus;

    const result = await WarningService.getTicketList(filters, {
      page: parseInt(page),
      pageSize: parseInt(pageSize),
    });
    pagedSuccess(res, result);
  })
);

router.get(
  '/:id',
  authRequired,
  asyncHandler(async (req, res) => {
    const ticket = await WarningService.getTicketDetail(
      parseInt(req.params.id),
      req.user.id,
      req.user.role
    );
    success(res, ticket);
  })
);

router.post(
  '/:id/read',
  authRequired,
  asyncHandler(async (req, res) => {
    const ticket = await WarningService.markTicketRead(
      parseInt(req.params.id),
      req.user.employeeId || req.user.id,
      req.user.role
    );
    success(res, ticket, '已标记为已读');
  })
);

router.post(
  '/batch-read',
  authRequired,
  asyncHandler(async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ code: 400, message: '请选择工单' });
    }

    let count = 0;
    for (const id of ids) {
      try {
        await WarningService.markTicketRead(
          parseInt(id),
          req.user.employeeId || req.user.id,
          req.user.role
        );
        count++;
      } catch (e) {}
    }

    success(res, { count }, `已标记 ${count} 条已读`);
  })
);

router.post(
  '/:id/handle',
  authRequired,
  roleRequired('admin', 'hr', 'medical', 'manager'),
  asyncHandler(async (req, res) => {
    const schema = Joi.object({
      action: Joi.string().valid('processing', 'resolved', 'closed', 'ignored').required(),
      remark: Joi.string().allow(null, ''),
    });

    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({ code: 400, message: error.details[0].message });
    }

    const result = await WarningService.handleTicket(
      parseInt(req.params.id),
      req.user.id,
      value.action,
      value.remark
    );

    success(res, result, '处理成功');
  })
);

router.post(
  '/batch-handle',
  authRequired,
  roleRequired('admin', 'hr', 'medical', 'manager'),
  asyncHandler(async (req, res) => {
    const { ids, action, remark } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ code: 400, message: '请选择工单' });
    }
    if (!action) {
      return res.status(400).json({ code: 400, message: '请选择处理操作' });
    }

    const result = await WarningService.batchHandleTickets(
      ids.map(Number),
      req.user.id,
      action,
      remark
    );

    success(res, result, '批量处理完成');
  })
);

router.post(
  '/',
  authRequired,
  roleRequired('admin', 'hr', 'medical'),
  asyncHandler(async (req, res) => {
    const schema = Joi.object({
      employeeId: Joi.number().required(),
      warningType: Joi.string().valid(
        'consecutive_abnormal',
        'high_risk_value',
        'multiple_abnormal',
        'health_score_low',
        'custom'
      ).default('custom'),
      warningLevel: Joi.string().valid('low', 'medium', 'high', 'critical').default('medium'),
      title: Joi.string().required(),
      description: Joi.string().allow(null, ''),
      suggestions: Joi.string().allow(null, ''),
      reportId: Joi.number().allow(null),
      abnormalItems: Joi.array().default([]),
      assigneeId: Joi.number().allow(null),
      dueTime: Joi.date().allow(null),
    });

    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({ code: 400, message: error.details[0].message });
    }

    const result = await WarningService.createManualTicket(value, req.user.id);
    success(res, result, '创建成功', 201);
  })
);

router.post(
  '/analyze-report/:reportId',
  authRequired,
  roleRequired('admin', 'hr', 'medical'),
  asyncHandler(async (req, res) => {
    const result = await WarningService.analyzeReportAndGenerateWarnings(
      parseInt(req.params.reportId)
    );
    success(res, result, `分析完成，生成 ${result.warningsGenerated} 条预警`);
  })
);

router.post(
  '/push-unread',
  authRequired,
  roleRequired('admin', 'hr'),
  asyncHandler(async (req, res) => {
    const result = await WarningService.processUnreadWarningsPush();
    success(res, result);
  })
);

module.exports = router;
