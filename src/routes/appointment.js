const express = require('express');
const Joi = require('joi');
const { success, pagedSuccess, asyncHandler } = require('../utils/errorHandler');
const { authRequired, roleRequired } = require('../middleware/auth');
const AppointmentService = require('../services/AppointmentService');
const BudgetService = require('../services/BudgetService');
const ApprovalService = require('../services/ApprovalService');
const PackageRecommendationService = require('../services/PackageRecommendationService');
const CheckupOrderService = require('../services/CheckupOrderService');

const router = express.Router();

router.get(
  '/packages/recommend',
  authRequired,
  asyncHandler(async (req, res) => {
    const employeeId = req.user.employeeId;
    const result = await PackageRecommendationService.recommendPackages(employeeId);
    success(res, result);
  })
);

router.get(
  '/packages/recommend/:employeeId',
  authRequired,
  roleRequired('admin', 'hr', 'medical'),
  asyncHandler(async (req, res) => {
    const result = await PackageRecommendationService.recommendPackages(
      parseInt(req.params.employeeId)
    );
    success(res, result);
  })
);

router.post(
  '/preview',
  authRequired,
  asyncHandler(async (req, res) => {
    const { employeeId, packageId, extraItems } = req.body;
    const empId = employeeId || req.user.employeeId;
    const result = await AppointmentService.getRecommendationsAndCreatePreview(
      empId,
      packageId,
      extraItems
    );
    success(res, result);
  })
);

router.post(
  '/',
  authRequired,
  asyncHandler(async (req, res) => {
    const schema = Joi.object({
      employeeId: Joi.number().allow(null),
      packageId: Joi.number().required(),
      extraItems: Joi.array().default([]),
      preferredDate: Joi.date().allow(null),
      hospitalId: Joi.number().allow(null),
      applicantRemark: Joi.string().max(500).allow(null, ''),
    });

    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({ code: 400, message: error.details[0].message });
    }

    const employeeId = value.employeeId || req.user.employeeId;
    const result = await AppointmentService.createAppointment(
      { ...value, employeeId },
      req.user.id
    );

    success(res, result, '创建预约成功', 201);
  })
);

router.get(
  '/',
  authRequired,
  asyncHandler(async (req, res) => {
    const filters = {};
    const {
      employeeId,
      deptId,
      status,
      year,
      half,
      orderNo,
      approvalStatus,
      currentApproverId,
      page = 1,
      pageSize = 20,
    } = req.query;

    if (req.user.role === 'employee') {
      filters.employeeId = req.user.employeeId;
    } else if (req.user.role === 'manager' && !filters.deptId && !filters.employeeId) {
      filters.deptId = req.user.deptId;
    }

    if (employeeId) filters.employeeId = parseInt(employeeId);
    if (deptId) filters.deptId = parseInt(deptId);
    if (status) filters.status = status;
    if (year) filters.year = parseInt(year);
    if (half) filters.half = half;
    if (orderNo) filters.orderNo = orderNo;
    if (approvalStatus) filters.approvalStatus = approvalStatus;
    if (currentApproverId) filters.currentApproverId = parseInt(currentApproverId);

    const result = await AppointmentService.getAppointmentList(filters, {
      page: parseInt(page),
      pageSize: parseInt(pageSize),
    });
    pagedSuccess(res, result);
  })
);

router.get(
  '/pending-approvals',
  authRequired,
  asyncHandler(async (req, res) => {
    const result = await ApprovalService.getPendingApprovals(req.user.id, {
      page: parseInt(req.query.page) || 1,
      pageSize: parseInt(req.query.pageSize) || 20,
    });
    pagedSuccess(res, result);
  })
);

router.get(
  '/approvals/workbench',
  authRequired,
  asyncHandler(async (req, res) => {
    const filters = {
      status: req.query.status,
      isOverBudget: req.query.isOverBudget,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      deptId: req.query.deptId,
      keyword: req.query.keyword,
    };
    const result = await ApprovalService.getApprovalWorkbench(req.user.id, filters, {
      page: parseInt(req.query.page) || 1,
      pageSize: parseInt(req.query.pageSize) || 20,
    });
    pagedSuccess(res, result);
  })
);

router.get(
  '/approvals/stats',
  authRequired,
  asyncHandler(async (req, res) => {
    const result = await ApprovalService.getApprovalStats(req.user.id);
    success(res, result);
  })
);

router.get(
  '/approvals/:id/detail',
  authRequired,
  asyncHandler(async (req, res) => {
    const result = await ApprovalService.getApprovalDetail(
      parseInt(req.params.id),
      req.user.id
    );
    success(res, result);
  })
);

router.get(
  '/:id',
  authRequired,
  asyncHandler(async (req, res) => {
    const detail = await AppointmentService.getAppointmentDetail(parseInt(req.params.id));
    success(res, detail);
  })
);

router.post(
  '/:id/confirm',
  authRequired,
  asyncHandler(async (req, res) => {
    const employeeId = req.user.employeeId;
    const result = await AppointmentService.confirmAppointment(
      parseInt(req.params.id),
      employeeId,
      req.body
    );
    success(res, result, '确认成功');
  })
);

router.post(
  '/:id/cancel',
  authRequired,
  asyncHandler(async (req, res) => {
    const { reason } = req.body;
    const result = await AppointmentService.cancelAppointment(
      parseInt(req.params.id),
      req.user.id,
      reason
    );
    success(res, result, '取消成功');
  })
);

router.post(
  '/:id/approve',
  authRequired,
  asyncHandler(async (req, res) => {
    const { remark, passToNext = true } = req.body;
    const result = await ApprovalService.approve(parseInt(req.params.id), req.user.id, {
      remark,
      passToNext,
    });
    success(res, result, result.message || '审批通过');
  })
);

router.post(
  '/:id/reject',
  authRequired,
  asyncHandler(async (req, res) => {
    const { reason } = req.body;
    if (!reason) {
      return res.status(400).json({ code: 400, message: '请填写驳回原因' });
    }
    const result = await ApprovalService.reject(parseInt(req.params.id), req.user.id, reason);
    success(res, result, result.message || '已驳回');
  })
);

router.post(
  '/:id/transfer',
  authRequired,
  asyncHandler(async (req, res) => {
    const { toApproverId, reason } = req.body;
    if (!toApproverId) {
      return res.status(400).json({ code: 400, message: '请选择转审人' });
    }
    const result = await ApprovalService.transfer(
      parseInt(req.params.id),
      req.user.id,
      parseInt(toApproverId),
      reason
    );
    success(res, result, result.message || '已转审');
  })
);

router.post(
  '/:id/generate-order',
  authRequired,
  roleRequired('admin', 'hr', 'medical'),
  asyncHandler(async (req, res) => {
    const result = await CheckupOrderService.generateCheckupOrder(
      parseInt(req.params.id),
      req.user.id
    );
    success(res, result, '体检单生成成功');
  })
);

router.post(
  '/batch/generate-orders',
  authRequired,
  roleRequired('admin', 'hr', 'medical'),
  asyncHandler(async (req, res) => {
    const { appointmentIds } = req.body;
    if (!Array.isArray(appointmentIds) || appointmentIds.length === 0) {
      return res.status(400).json({ code: 400, message: '请选择预约' });
    }
    const result = await CheckupOrderService.batchGenerateOrders(
      appointmentIds.map(Number),
      req.user.id
    );
    success(res, result, '批量生成完成');
  })
);

router.get(
  '/budget/:deptId/:year/:half?',
  authRequired,
  asyncHandler(async (req, res) => {
    const { deptId, year, half = 'all' } = req.params;
    const result = await BudgetService.getDeptBudget(parseInt(deptId), parseInt(year), half);
    success(res, result);
  })
);

router.post(
  '/budget',
  authRequired,
  roleRequired('admin', 'hr', 'manager'),
  asyncHandler(async (req, res) => {
    const { deptId, year, half = 'all', totalAmount, perPersonLimit, approverIds, remark } =
      req.body;
    const result = await BudgetService.updateBudget(
      parseInt(deptId),
      parseInt(year),
      half,
      { totalAmount, perPersonLimit, approverIds, remark },
      req.user.id
    );
    success(res, result);
  })
);

router.get(
  '/budget/overbudget-dashboard',
  authRequired,
  roleRequired('admin', 'hr', 'manager', 'finance'),
  asyncHandler(async (req, res) => {
    const filters = {
      year: req.query.year,
      half: req.query.half,
      deptId: req.query.deptId,
    };
    const result = await BudgetService.getOverBudgetDashboard(filters);
    success(res, result);
  })
);

router.get(
  '/budget/detail-records',
  authRequired,
  roleRequired('admin', 'hr', 'manager', 'finance'),
  asyncHandler(async (req, res) => {
    const filters = {
      deptId: req.query.deptId,
      year: req.query.year,
      half: req.query.half,
      type: req.query.type,
      page: parseInt(req.query.page) || 1,
      pageSize: parseInt(req.query.pageSize) || 20,
    };
    const result = await BudgetService.getBudgetDetailRecords(filters);
    pagedSuccess(res, result);
  })
);

module.exports = router;
