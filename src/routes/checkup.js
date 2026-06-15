const express = require('express');
const { success, pagedSuccess, asyncHandler } = require('../utils/errorHandler');
const { authRequired, roleRequired } = require('../middleware/auth');
const CheckupOrderService = require('../services/CheckupOrderService');
const ReportService = require('../services/ReportService');

const router = express.Router();

router.get(
  '/',
  authRequired,
  asyncHandler(async (req, res) => {
    const filters = {};
    const {
      orderNo,
      employeeId,
      deptId,
      hospitalId,
      status,
      pushStatus,
      hospitalOrderNo,
      checkupDateStart,
      checkupDateEnd,
      page = 1,
      pageSize = 20,
    } = req.query;

    if (req.user.role === 'employee') {
      filters.employeeId = req.user.employeeId;
    } else if (req.user.role === 'manager' && !filters.deptId && !filters.employeeId) {
      filters.deptId = req.user.deptId;
    }

    if (orderNo) filters.orderNo = orderNo;
    if (employeeId) filters.employeeId = parseInt(employeeId);
    if (deptId) filters.deptId = parseInt(deptId);
    if (hospitalId) filters.hospitalId = parseInt(hospitalId);
    if (status) filters.status = status;
    if (pushStatus) filters.pushStatus = pushStatus;
    if (hospitalOrderNo) filters.hospitalOrderNo = hospitalOrderNo;
    if (checkupDateStart && checkupDateEnd) {
      filters.checkupDateRange = { start: checkupDateStart, end: checkupDateEnd };
    }

    const result = await CheckupOrderService.getOrderList(filters, {
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
    const order = await CheckupOrderService.getOrderDetail(parseInt(req.params.id));
    success(res, order);
  })
);

router.post(
  '/checkin',
  authRequired,
  roleRequired('admin', 'hr', 'medical'),
  asyncHandler(async (req, res) => {
    const { qrCode } = req.body;
    if (!qrCode) {
      return res.status(400).json({ code: 400, message: '请提供签到二维码' });
    }
    const result = await CheckupOrderService.checkinOrder(qrCode, req.user.id);
    success(res, result, '签到成功');
  })
);

router.get(
  '/qr/:qrCode',
  authRequired,
  asyncHandler(async (req, res) => {
    const order = await CheckupOrderService.getOrderByQrCode(req.params.qrCode);
    success(res, order);
  })
);

router.put(
  '/:id/status',
  authRequired,
  roleRequired('admin', 'hr', 'medical'),
  asyncHandler(async (req, res) => {
    const { status, ...data } = req.body;
    if (!status) {
      return res.status(400).json({ code: 400, message: '请指定状态' });
    }
    const result = await CheckupOrderService.updateOrderStatus(
      parseInt(req.params.id),
      status,
      data,
      req.user.id
    );
    success(res, result, '状态更新成功');
  })
);

router.post(
  '/:id/retry-push',
  authRequired,
  roleRequired('admin', 'hr', 'medical'),
  asyncHandler(async (req, res) => {
    const result = await CheckupOrderService.retryPushOrder(
      parseInt(req.params.id),
      req.user.id
    );
    success(res, result);
  })
);

router.post(
  '/:id/fetch-report',
  authRequired,
  roleRequired('admin', 'hr', 'medical'),
  asyncHandler(async (req, res) => {
    const result = await ReportService.fetchReportFromHospital(
      parseInt(req.params.id),
      req.user.id
    );
    success(res, result, '报告抓取成功');
  })
);

router.post(
  '/hospital/callback',
  asyncHandler(async (req, res) => {
    const result = await ReportService.processHospitalCallback(req.body, 0);
    success(res, result, '回调处理成功');
  })
);

module.exports = router;
