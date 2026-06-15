const express = require('express');
const { success, pagedSuccess, asyncHandler } = require('../utils/errorHandler');
const { authRequired, roleRequired } = require('../middleware/auth');
const StatisticsReportService = require('../services/StatisticsReportService');
const QueryExportService = require('../services/QueryExportService');

const router = express.Router();

router.get(
  '/dept-daily',
  authRequired,
  asyncHandler(async (req, res) => {
    const { deptId, year, half = 'all' } = req.query;
    const filters = {
      deptId: deptId ? parseInt(deptId) : null,
    };

    if (req.user.role === 'manager' && !filters.deptId) {
      filters.deptId = req.user.deptId;
    }

    const result = await StatisticsReportService.getDeptDailyStats(
      filters.deptId,
      year ? parseInt(year) : new Date().getFullYear(),
      half
    );
    success(res, result);
  })
);

router.get(
  '/abnormal-ranking',
  authRequired,
  asyncHandler(async (req, res) => {
    const { deptId, year, limit = 20 } = req.query;
    const result = await StatisticsReportService.getAbnormalItemsRanking(
      year ? parseInt(year) : new Date().getFullYear(),
      deptId ? parseInt(deptId) : null,
      parseInt(limit)
    );
    success(res, result);
  })
);

router.get(
  '/trend',
  authRequired,
  asyncHandler(async (req, res) => {
    const { years = 5 } = req.query;
    const result = await StatisticsReportService.getTrendAnalysis(parseInt(years));
    success(res, result);
  })
);

router.post(
  '/generate/pdf',
  authRequired,
  roleRequired('admin', 'hr', 'medical'),
  asyncHandler(async (req, res) => {
    const { year, half = 'all', deptId = null } = req.body;
    const targetYear = year ? parseInt(year) : new Date().getFullYear();

    if (req.user.role === 'manager' && !deptId) {
      req.body.deptId = req.user.deptId;
    }

    const result = await StatisticsReportService.generatePDFReport(
      targetYear,
      half,
      deptId ? parseInt(deptId) : null
    );
    success(res, result, 'PDF报表生成成功');
  })
);

router.post(
  '/generate/excel',
  authRequired,
  roleRequired('admin', 'hr', 'medical'),
  asyncHandler(async (req, res) => {
    const { year, half = 'all', deptId = null } = req.body;
    const targetYear = year ? parseInt(year) : new Date().getFullYear();

    if (req.user.role === 'manager' && !deptId) {
      req.body.deptId = req.user.deptId;
    }

    const result = await StatisticsReportService.generateExcelReport(
      targetYear,
      half,
      deptId ? parseInt(deptId) : null
    );
    success(res, result, 'Excel报表生成成功');
  })
);

router.get(
  '/report-history',
  authRequired,
  roleRequired('admin', 'hr', 'medical'),
  asyncHandler(async (req, res) => {
    const filters = {
      year: req.query.year,
      type: req.query.type,
      deptId: req.query.deptId,
      page: parseInt(req.query.page) || 1,
      pageSize: parseInt(req.query.pageSize) || 20,
    };
    const result = await StatisticsReportService.getReportHistory(filters);
    pagedSuccess(res, result);
  })
);

router.get(
  '/report-years',
  authRequired,
  roleRequired('admin', 'hr', 'medical'),
  asyncHandler(async (req, res) => {
    const result = await StatisticsReportService.getReportYears();
    success(res, result);
  })
);

router.get(
  '/report-preview/:fileName',
  authRequired,
  roleRequired('admin', 'hr', 'medical'),
  asyncHandler(async (req, res) => {
    const result = await StatisticsReportService.getReportPreview(req.params.fileName);
    success(res, result);
  })
);

router.post(
  '/query/lifecycle',
  authRequired,
  asyncHandler(async (req, res) => {
    const { filters = {}, page = 1, pageSize = 20 } = req.body;

    if (req.user.role === 'employee') {
      filters.employeeId = req.user.employeeId;
    } else if (req.user.role === 'manager' && !filters.deptId && !filters.employeeId) {
      filters.deptId = req.user.deptId;
    }

    const result = await QueryExportService.queryEmployeeLifecycle(filters, {
      page: parseInt(page),
      pageSize: parseInt(pageSize),
    });
    pagedSuccess(res, result);
  })
);

router.post(
  '/export/lifecycle',
  authRequired,
  roleRequired('admin', 'hr', 'medical'),
  asyncHandler(async (req, res) => {
    const { filters = {} } = req.body;

    if (req.user.role === 'manager' && !filters.deptId && !filters.employeeId) {
      filters.deptId = req.user.deptId;
    }

    const result = await QueryExportService.exportEmployeeLifecycle(filters);
    success(res, result, '导出成功');
  })
);

router.post(
  '/export/appointments',
  authRequired,
  roleRequired('admin', 'hr', 'medical'),
  asyncHandler(async (req, res) => {
    const { filters = {} } = req.body;
    if (req.user.role === 'manager' && !filters.deptId) {
      filters.deptId = req.user.deptId;
    }
    const result = await QueryExportService.exportAppointments(filters);
    success(res, result, '导出成功');
  })
);

router.post(
  '/export/batch',
  authRequired,
  roleRequired('admin', 'hr', 'medical'),
  asyncHandler(async (req, res) => {
    const result = await QueryExportService.batchExport(req.body);
    success(res, result, '批量导出完成');
  })
);

router.post(
  '/query/appointments',
  authRequired,
  asyncHandler(async (req, res) => {
    const { filters = {}, page = 1, pageSize = 20 } = req.body;

    if (req.user.role === 'employee') {
      filters.employeeId = req.user.employeeId;
    } else if (req.user.role === 'manager' && !filters.deptId && !filters.employeeId) {
      filters.deptId = req.user.deptId;
    }

    const result = await QueryExportService.queryAppointments(filters, {
      page: parseInt(page),
      pageSize: parseInt(pageSize),
    });
    pagedSuccess(res, result);
  })
);

router.post(
  '/query/reports',
  authRequired,
  asyncHandler(async (req, res) => {
    const { filters = {}, page = 1, pageSize = 20 } = req.body;

    if (req.user.role === 'employee') {
      filters.employeeId = req.user.employeeId;
    } else if (req.user.role === 'manager' && !filters.deptId && !filters.employeeId) {
      filters.deptId = req.user.deptId;
    }

    const result = await QueryExportService.queryReports(filters, {
      page: parseInt(page),
      pageSize: parseInt(pageSize),
    });
    pagedSuccess(res, result);
  })
);

router.post(
  '/query/warnings',
  authRequired,
  asyncHandler(async (req, res) => {
    const { filters = {}, page = 1, pageSize = 20 } = req.body;

    if (req.user.role === 'employee') {
      filters.employeeId = req.user.employeeId;
    } else if (req.user.role === 'manager' && !filters.deptId && !filters.employeeId) {
      filters.deptManagerId = req.user.id;
    }

    const result = await QueryExportService.queryWarnings(filters, {
      page: parseInt(page),
      pageSize: parseInt(pageSize),
    });
    pagedSuccess(res, result);
  })
);

module.exports = router;
