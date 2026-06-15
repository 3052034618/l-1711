const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { success, pagedSuccess, asyncHandler } = require('../utils/errorHandler');
const { authRequired, roleRequired, uploadLimiter } = require('../middleware/auth');
const ReportService = require('../services/ReportService');
const ExternalReportService = require('../services/ExternalReportService');
const QueryExportService = require('../services/QueryExportService');
const config = require('../config');

const uploadDir = path.resolve(config.storage.uploadPath);
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(uploadDir, 'temp');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    cb(null, `${timestamp}_${Math.random().toString(36).substring(2, 8)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
});

const router = express.Router();

router.get(
  '/',
  authRequired,
  asyncHandler(async (req, res) => {
    const filters = {};
    const {
      reportNo,
      employeeId,
      deptId,
      year,
      half,
      source,
      hasAbnormal,
      hasHighRisk,
      page = 1,
      pageSize = 20,
    } = req.query;

    if (req.user.role === 'employee') {
      filters.employeeId = req.user.employeeId;
    } else if (req.user.role === 'manager' && !filters.deptId && !filters.employeeId) {
      filters.deptId = req.user.deptId;
    }

    if (reportNo) filters.reportNo = reportNo;
    if (employeeId) filters.employeeId = parseInt(employeeId);
    if (deptId) filters.deptId = parseInt(deptId);
    if (year) filters.year = parseInt(year);
    if (half) filters.half = half;
    if (source) filters.source = source;
    if (hasAbnormal !== undefined) filters.hasAbnormal = hasAbnormal === 'true';
    if (hasHighRisk !== undefined) filters.hasHighRisk = hasHighRisk === 'true';

    const result = await ReportService.getReportList(filters, {
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
    const report = await ReportService.getReportDetail(parseInt(req.params.id));
    success(res, report);
  })
);

router.get(
  '/:id/items',
  authRequired,
  asyncHandler(async (req, res) => {
    const { ReportItem } = require('../models');
    const items = await ReportItem.findAll({
      where: { reportId: parseInt(req.params.id) },
      order: [['itemCategory', 'ASC'], ['itemName', 'ASC']],
    });
    success(res, items);
  })
);

router.post(
  '/upload',
  authRequired,
  uploadLimiter,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ code: 400, message: '请上传文件' });
    }

    const data = JSON.parse(req.body.data || '{}');
    const employeeId = data.employeeId || req.user.employeeId;

    const result = await ExternalReportService.uploadAndParse(
      { ...data, employeeId },
      req.file,
      req.user.id
    );

    success(res, result, '上传成功', 201);
  })
);

router.post(
  '/:id/items',
  authRequired,
  roleRequired('admin', 'hr', 'medical'),
  asyncHandler(async (req, res) => {
    const { items } = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ code: 400, message: '请提供指标数组' });
    }
    const result = await ExternalReportService.updateReportItems(
      parseInt(req.params.id),
      items,
      req.user.id
    );
    success(res, result, '更新成功');
  })
);

router.delete(
  '/:id',
  authRequired,
  roleRequired('admin', 'hr', 'medical'),
  asyncHandler(async (req, res) => {
    const result = await ExternalReportService.deleteUploadedReport(
      parseInt(req.params.id),
      req.user.id
    );
    success(res, result, '删除成功');
  })
);

router.post(
  '/:id/retry-ocr',
  authRequired,
  roleRequired('admin', 'hr', 'medical'),
  asyncHandler(async (req, res) => {
    const result = await ExternalReportService.retryOcr(
      parseInt(req.params.id),
      req.user.id
    );
    success(res, result);
  })
);

router.get(
  '/uploaded/list',
  authRequired,
  roleRequired('admin', 'hr', 'medical'),
  asyncHandler(async (req, res) => {
    const filters = {};
    const { employeeId, deptId, year, uploaderId, page = 1, pageSize = 20 } = req.query;
    if (employeeId) filters.employeeId = parseInt(employeeId);
    if (deptId) filters.deptId = parseInt(deptId);
    if (year) filters.year = parseInt(year);
    if (uploaderId) filters.uploaderId = parseInt(uploaderId);

    const result = await ExternalReportService.getUploadedReports(filters, {
      page: parseInt(page),
      pageSize: parseInt(pageSize),
    });
    pagedSuccess(res, result);
  })
);

router.post(
  '/export-items',
  authRequired,
  roleRequired('admin', 'hr', 'medical'),
  asyncHandler(async (req, res) => {
    const { reportIds } = req.body;
    if (!Array.isArray(reportIds) || reportIds.length === 0) {
      return res.status(400).json({ code: 400, message: '请选择报告' });
    }
    const result = await QueryExportService.exportReportItems(reportIds.map(Number));
    success(res, result, '导出成功');
  })
);

module.exports = router;
