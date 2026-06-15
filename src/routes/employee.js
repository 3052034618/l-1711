const express = require('express');
const Joi = require('joi');
const { success, pagedSuccess, asyncHandler } = require('../utils/errorHandler');
const { authRequired, roleRequired } = require('../middleware/auth');
const { Employee, Department } = require('../models');
const QueryExportService = require('../services/QueryExportService');
const ReportService = require('../services/ReportService');

const router = express.Router();

router.get(
  '/',
  authRequired,
  asyncHandler(async (req, res) => {
    const { page = 1, pageSize = 20, deptId, keyword, workType, status } = req.query;

    const where = {};
    if (deptId) where.deptId = deptId;
    if (workType) where.workType = workType;
    if (status !== undefined) where.status = status;
    if (keyword) {
      where = {
        ...where,
        [require('sequelize').Op.or]: [
          { name: { [require('sequelize').Op.like]: `%${keyword}%` } },
          { empNo: { [require('sequelize').Op.like]: `%${keyword}%` } },
          { phone: { [require('sequelize').Op.like]: `%${keyword}%` } },
        ],
      };
    }

    const { limit, offset } = (await import('../utils/helpers')).paginate(page, pageSize);

    const { count, rows } = await Employee.findAndCountAll({
      where,
      include: [{ association: 'department', attributes: ['id', 'deptName'] }],
      order: [['deptId', 'ASC'], ['empNo', 'ASC']],
      limit,
      offset,
    });

    pagedSuccess(res, (await import('../utils/helpers')).formatPagedResult(rows, count, page, pageSize));
  })
);

router.get(
  '/:id',
  authRequired,
  asyncHandler(async (req, res) => {
    const employee = await Employee.findByPk(req.params.id, {
      include: [{ association: 'department' }],
    });
    if (!employee) {
      return res.status(404).json({ code: 404, message: '员工不存在' });
    }
    success(res, employee);
  })
);

router.get(
  '/:id/full-record',
  authRequired,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const record = await QueryExportService.getEmployeeFullRecord(parseInt(id));
    success(res, record);
  })
);

router.get(
  '/:id/health-trend',
  authRequired,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { itemCode, yearRange = 5 } = req.query;

    let result;
    if (itemCode) {
      result = await ReportService.getHealthTrend(parseInt(id), itemCode, parseInt(yearRange));
    } else {
      result = await ReportService.getAllTrendsForEmployee(parseInt(id), parseInt(yearRange));
    }

    success(res, result);
  })
);

router.post(
  '/',
  authRequired,
  roleRequired('admin', 'hr'),
  asyncHandler(async (req, res) => {
    const schema = Joi.object({
      empNo: Joi.string().required(),
      name: Joi.string().required(),
      gender: Joi.string().valid('male', 'female', 'unknown').default('unknown'),
      birthday: Joi.date().allow(null),
      idCard: Joi.string().allow(null),
      phone: Joi.string().allow(null),
      email: Joi.string().email().allow(null),
      deptId: Joi.number().required(),
      position: Joi.string().allow(null),
      positionLevel: Joi.string().allow(null),
      entryDate: Joi.date().allow(null),
      workType: Joi.string()
        .valid('office', 'factory', 'field', 'high_risk', 'other')
        .default('office'),
      bloodType: Joi.string().valid('A', 'B', 'AB', 'O', 'unknown').default('unknown'),
      allergyHistory: Joi.string().allow(null),
      chronicDisease: Joi.string().allow(null),
    });

    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({ code: 400, message: error.details[0].message });
    }

    const existing = await Employee.findOne({ where: { empNo: value.empNo } });
    if (existing) {
      return res.status(409).json({ code: 409, message: '工号已存在' });
    }

    const employee = await Employee.create(value);
    success(res, employee, '创建成功', 201);
  })
);

router.put(
  '/:id',
  authRequired,
  roleRequired('admin', 'hr'),
  asyncHandler(async (req, res) => {
    const employee = await Employee.findByPk(req.params.id);
    if (!employee) {
      return res.status(404).json({ code: 404, message: '员工不存在' });
    }

    const allowedFields = [
      'name',
      'gender',
      'birthday',
      'idCard',
      'phone',
      'email',
      'deptId',
      'position',
      'positionLevel',
      'entryDate',
      'workType',
      'bloodType',
      'allergyHistory',
      'chronicDisease',
      'status',
    ];

    const updateData = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    }

    await employee.update(updateData);
    success(res, employee, '更新成功');
  })
);

router.get(
  '/departments/tree',
  authRequired,
  asyncHandler(async (req, res) => {
    const depts = await Department.findAll({
      where: { status: 1 },
      order: [['sort', 'ASC'], ['id', 'ASC']],
    });

    const map = {};
    const roots = [];
    depts.forEach((d) => {
      const node = d.toJSON();
      node.children = [];
      map[d.id] = node;
      if (!d.parentId || d.parentId === 0) {
        roots.push(node);
      } else if (map[d.parentId]) {
        map[d.parentId].children.push(node);
      } else {
        roots.push(node);
      }
    });

    success(res, roots);
  })
);

router.post(
  '/departments',
  authRequired,
  roleRequired('admin', 'hr'),
  asyncHandler(async (req, res) => {
    const dept = await Department.create(req.body);
    success(res, dept, '创建成功', 201);
  })
);

module.exports = router;
