const { Op } = require('sequelize');
const {
  Employee,
  Department,
  Appointment,
  CheckupOrder,
  CheckupReport,
  ReportItem,
  WarningTicket,
  sequelize,
} = require('../models');
const { paginate, formatPagedResult } = require('../utils/helpers');
const { logger } = require('../utils/logger');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const config = require('../config');

class QueryExportService {
  async queryEmployeeLifecycle(filters = {}, options = {}) {
    const { page = 1, pageSize = 20 } = options;
    const { limit, offset } = paginate(page, pageSize);

    const empWhere = { status: 1 };
    if (filters.empNo) empWhere.empNo = { [Op.like]: `%${filters.empNo}%` };
    if (filters.name) empWhere.name = { [Op.like]: `%${filters.name}%` };
    if (filters.gender) empWhere.gender = filters.gender;
    if (filters.deptId) empWhere.deptId = filters.deptId;
    if (filters.workType) empWhere.workType = filters.workType;

    const appointmentWhere = {};
    if (filters.year) appointmentWhere.year = filters.year;
    if (filters.appointmentStatus) appointmentWhere.status = filters.appointmentStatus;

    const orderWhere = {};
    if (filters.checkupDateRange) {
      orderWhere.checkupDate = {
        [Op.between]: [filters.checkupDateRange.start, filters.checkupDateRange.end],
      };
    }
    if (filters.orderStatus) orderWhere.status = filters.orderStatus;

    const reportWhere = {};
    if (filters.hasAbnormal !== undefined) {
      reportWhere.abnormalCount = filters.hasAbnormal ? { [Op.gt]: 0 } : 0;
    }

    const warningWhere = {};
    if (filters.hasWarning !== undefined) {
      if (filters.hasWarning) {
        warningWhere.id = { [Op.not]: null };
      }
    }
    if (filters.warningLevel) warningWhere.warningLevel = filters.warningLevel;

    const itemWhere = {};
    if (filters.checkupItems && filters.checkupItems.length > 0) {
      itemWhere.itemCode = { [Op.in]: filters.checkupItems };
    }

    const { count, rows } = await Employee.findAndCountAll({
      where: empWhere,
      include: [
        {
          association: 'department',
          attributes: ['id', 'deptCode', 'deptName'],
          required: !!filters.deptId,
        },
        {
          association: Appointment.associations.employee
            ? Appointment.associations.employee.target.associations.appointments
            : null,
          model: Appointment,
          as: 'appointments',
          where: Object.keys(appointmentWhere).length ? appointmentWhere : undefined,
          required: false,
          include: [
            {
              model: CheckupOrder,
              as: 'checkupOrder',
              where: Object.keys(orderWhere).length ? orderWhere : undefined,
              required: false,
              include: [
                {
                  model: CheckupReport,
                  as: 'checkupReport',
                  where: Object.keys(reportWhere).length ? reportWhere : undefined,
                  required: false,
                  include: [
                    {
                      model: ReportItem,
                      as: 'reportItems',
                      where: Object.keys(itemWhere).length ? itemWhere : undefined,
                      required: !!filters.checkupItems,
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          model: WarningTicket,
          as: 'warningTickets',
          where: Object.keys(warningWhere).length ? warningWhere : undefined,
          required: !!filters.hasWarning,
        },
      ],
      subQuery: false,
      distinct: true,
      order: [['deptId', 'ASC'], ['empNo', 'ASC']],
      limit,
      offset,
    });

    return formatPagedResult(rows, count, page, pageSize);
  }

  async getEmployeeFullRecord(employeeId) {
    const employee = await Employee.findByPk(employeeId, {
      include: [{ association: 'department' }],
    });

    if (!employee) {
      throw new Error('员工不存在');
    }

    const appointments = await Appointment.findAll({
      where: { employeeId },
      include: [
        { association: 'package' },
        {
          model: CheckupOrder,
          as: 'checkupOrder',
          include: [
            { association: 'hospital' },
            {
              model: CheckupReport,
              as: 'checkupReport',
              include: [
                { model: ReportItem, as: 'reportItems', order: [['itemCategory', 'ASC']] },
              ],
            },
          ],
        },
      ],
      order: [['year', 'DESC'], ['half', 'DESC']],
    });

    const warnings = await WarningTicket.findAll({
      where: { employeeId },
      order: [['createdAt', 'DESC']],
      limit: 50,
    });

    return {
      employee,
      appointments,
      warnings,
      totalCheckups: appointments.filter((a) => a.status === 'completed').length,
      totalAbnormal: appointments.reduce(
        (s, a) => s + (a.checkupOrder?.checkupReport?.abnormalCount || 0),
        0
      ),
      activeWarnings: warnings.filter((w) => ['pending', 'read', 'processing'].includes(w.status)).length,
    };
  }

  async queryAppointments(filters = {}, options = {}) {
    const { page = 1, pageSize = 20 } = options;
    const { limit, offset } = paginate(page, pageSize);

    const where = {};
    if (filters.employeeId) where.employeeId = filters.employeeId;
    if (filters.deptId) where.deptId = filters.deptId;
    if (filters.year) where.year = filters.year;
    if (filters.half) where.half = filters.half;
    if (filters.status) where.status = filters.status;
    if (filters.packageId) where.packageId = filters.packageId;
    if (filters.approvalStatus) where.approvalStatus = filters.approvalStatus;

    if (filters.dateRange) {
      where.createdAt = {
        [Op.between]: [filters.dateRange.start, filters.dateRange.end],
      };
    }

    if (filters.amountRange) {
      where.totalAmount = {
        [Op.gte]: filters.amountRange.min,
        [Op.lte]: filters.amountRange.max,
      };
    }

    const { count, rows } = await Appointment.findAndCountAll({
      where,
      include: [
        { association: 'employee', attributes: ['id', 'name', 'empNo', 'gender'] },
        { association: 'department', attributes: ['id', 'deptName'] },
        { association: 'package', attributes: ['id', 'pkgName', 'price'] },
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    return formatPagedResult(rows, count, page, pageSize);
  }

  async queryReports(filters = {}, options = {}) {
    const { page = 1, pageSize = 20 } = options;
    const { limit, offset } = paginate(page, pageSize);

    const where = {};
    if (filters.employeeId) where.employeeId = filters.employeeId;
    if (filters.deptId) where.deptId = filters.deptId;
    if (filters.year) where.year = filters.year;
    if (filters.half) where.half = filters.half;
    if (filters.source) where.source = filters.source;
    if (filters.checkupDateRange) {
      where.checkupDate = {
        [Op.between]: [filters.checkupDateRange.start, filters.checkupDateRange.end],
      };
    }
    if (filters.scoreRange) {
      where.totalScore = {
        [Op.gte]: filters.scoreRange.min,
        [Op.lte]: filters.scoreRange.max,
      };
    }
    if (filters.minAbnormalCount) {
      where.abnormalCount = { [Op.gte]: filters.minAbnormalCount };
    }
    if (filters.hasHighRisk) {
      where.highRiskCount = { [Op.gte]: 1 };
    }

    const { count, rows } = await CheckupReport.findAndCountAll({
      where,
      include: [
        { association: 'employee', attributes: ['id', 'name', 'empNo', 'gender', 'age'] },
        { association: 'department', attributes: ['id', 'deptName'] },
        { association: 'hospital', attributes: ['id', 'hospitalName'] },
      ],
      order: [['checkupDate', 'DESC']],
      limit,
      offset,
    });

    return formatPagedResult(rows, count, page, pageSize);
  }

  async queryWarnings(filters = {}, options = {}) {
    const { page = 1, pageSize = 20 } = options;
    const { limit, offset } = paginate(page, pageSize);

    const where = {};
    if (filters.employeeId) where.employeeId = filters.employeeId;
    if (filters.deptId) where.deptId = filters.deptId;
    if (filters.warningType) where.warningType = filters.warningType;
    if (filters.warningLevel) where.warningLevel = filters.warningLevel;
    if (filters.status) where.status = filters.status;
    if (filters.readStatus) where.readStatus = filters.readStatus;
    if (filters.createdAtRange) {
      where.createdAt = {
        [Op.between]: [filters.createdAtRange.start, filters.createdAtRange.end],
      };
    }
    if (filters.deptManagerId) where.deptManagerId = filters.deptManagerId;

    const { count, rows } = await WarningTicket.findAndCountAll({
      where,
      include: [
        { association: 'employee', attributes: ['id', 'name', 'empNo'] },
        { association: 'department', attributes: ['id', 'deptName'] },
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

  async exportEmployeeLifecycle(filters = {}) {
    const allData = await this.queryEmployeeLifecycle(filters, { page: 1, pageSize: 10000 });

    const reportDir = path.resolve(config.storage.reportPath);
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    const fileName = `员工体检全生命周期记录_${Date.now()}.xlsx`;
    const filePath = path.join(reportDir, fileName);

    const workbook = new ExcelJS.Workbook();

    const ws = workbook.addWorksheet('员工体检记录', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: '工号', key: 'empNo', width: 14 },
      { header: '姓名', key: 'name', width: 12 },
      { header: '性别', key: 'gender', width: 8 },
      { header: '部门', key: 'deptName', width: 18 },
      { header: '岗位', key: 'position', width: 16 },
      { header: '入职日期', key: 'entryDate', width: 12 },
      { header: '体检年份', key: 'year', width: 10 },
      { header: '半年', key: 'half', width: 8 },
      { header: '套餐名称', key: 'pkgName', width: 22 },
      { header: '预约状态', key: 'apptStatus', width: 12 },
      { header: '体检日期', key: 'checkupDate', width: 12 },
      { header: '体检状态', key: 'orderStatus', width: 12 },
      { header: '报告编号', key: 'reportNo', width: 20 },
      { header: '健康评分', key: 'score', width: 10 },
      { header: '异常项数', key: 'abnormalCount', width: 10 },
      { header: '高危项数', key: 'highRiskCount', width: 10 },
      { header: '预警数', key: 'warningCount', width: 10 },
    ];

    ws.getRow(1).font = { bold: true };
    ws.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

    allData.list.forEach((emp) => {
      const appointments = emp.appointments || [];
      if (appointments.length === 0) {
        ws.addRow({
          empNo: emp.empNo,
          name: emp.name,
          gender: emp.gender === 'male' ? '男' : emp.gender === 'female' ? '女' : '未知',
          deptName: emp.department?.deptName || '',
          position: emp.position || '',
          entryDate: emp.entryDate || '',
        });
      } else {
        appointments.forEach((appt) => {
          const order = appt.checkupOrder;
          const report = order?.checkupReport;
          const warnings = emp.warningTickets?.filter((w) => w.reportId === report?.id) || [];

          ws.addRow({
            empNo: emp.empNo,
            name: emp.name,
            gender: emp.gender === 'male' ? '男' : emp.gender === 'female' ? '女' : '未知',
            deptName: emp.department?.deptName || '',
            position: emp.position || '',
            entryDate: emp.entryDate || '',
            year: appt.year,
            half: appt.half === '1' ? '上半年' : '下半年',
            pkgName: appt.packageName || appt.package?.pkgName || '',
            apptStatus: this._translateApptStatus(appt.status),
            checkupDate: order?.checkupDate || '',
            orderStatus: this._translateOrderStatus(order?.status),
            reportNo: report?.reportNo || '',
            score: report?.totalScore || '',
            abnormalCount: report?.abnormalCount || 0,
            highRiskCount: report?.highRiskCount || 0,
            warningCount: warnings.length,
          });
        });
      }
    });

    if (filters.checkupItems && filters.checkupItems.length > 0) {
      const itemWs = workbook.addWorksheet('异常指标明细');
      itemWs.columns = [
        { header: '工号', key: 'empNo', width: 14 },
        { header: '姓名', key: 'name', width: 12 },
        { header: '部门', key: 'deptName', width: 18 },
        { header: '年份', key: 'year', width: 10 },
        { header: '指标编码', key: 'itemCode', width: 18 },
        { header: '指标名称', key: 'itemName', width: 22 },
        { header: '分类', key: 'category', width: 14 },
        { header: '结果值', key: 'value', width: 14 },
        { header: '单位', key: 'unit', width: 10 },
        { header: '参考范围', key: 'refRange', width: 18 },
        { header: '异常级别', key: 'level', width: 10 },
        { header: '是否高危', key: 'highRisk', width: 10 },
        { header: '连续异常年数', key: 'consecutive', width: 14 },
      ];

      itemWs.getRow(1).font = { bold: true };
      itemWs.getRow(1).alignment = { horizontal: 'center' };

      allData.list.forEach((emp) => {
        (emp.appointments || []).forEach((appt) => {
          const items = appt.checkupOrder?.checkupReport?.reportItems || [];
          items.forEach((item) => {
            if (filters.checkupItems.includes(item.itemCode) || item.isAbnormal) {
              itemWs.addRow({
                empNo: emp.empNo,
                name: emp.name,
                deptName: emp.department?.deptName || '',
                year: appt.year,
                itemCode: item.itemCode,
                itemName: item.itemName,
                category: item.itemCategory || '',
                value: item.resultValue,
                unit: item.unit || '',
                refRange: item.refRange || '',
                level: this._translateAbnormalLevel(item.abnormalLevel),
                highRisk: item.isHighRisk ? '是' : '否',
                consecutive: item.consecutiveAbnormalYears || 0,
              });
            }
          });
        });
      });
    }

    await workbook.xlsx.writeFile(filePath);
    logger.info(`导出员工体检记录: ${fileName}, ${allData.total}条`);

    return {
      fileName,
      url: `/reports/${fileName}`,
      filePath,
      totalCount: allData.total,
    };
  }

  async exportReportItems(reportIds) {
    const reports = await CheckupReport.findAll({
      where: { id: { [Op.in]: reportIds } },
      include: [
        { association: 'employee', attributes: ['id', 'name', 'empNo'] },
        { association: 'department', attributes: ['id', 'deptName'] },
        { model: ReportItem, as: 'reportItems' },
      ],
    });

    const reportDir = path.resolve(config.storage.reportPath);
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    const fileName = `体检报告指标明细_${Date.now()}.xlsx`;
    const filePath = path.join(reportDir, fileName);

    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('指标明细', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: '报告编号', key: 'reportNo', width: 20 },
      { header: '工号', key: 'empNo', width: 14 },
      { header: '姓名', key: 'name', width: 12 },
      { header: '部门', key: 'deptName', width: 18 },
      { header: '体检日期', key: 'checkupDate', width: 12 },
      { header: '指标编码', key: 'itemCode', width: 18 },
      { header: '指标名称', key: 'itemName', width: 24 },
      { header: '分类', key: 'category', width: 14 },
      { header: '结果值', key: 'result', width: 14 },
      { header: '数值', key: 'numeric', width: 14 },
      { header: '单位', key: 'unit', width: 10 },
      { header: '参考范围', key: 'refRange', width: 18 },
      { header: '是否异常', key: 'abnormal', width: 10 },
      { header: '异常级别', key: 'level', width: 10 },
      { header: '是否高危', key: 'highRisk', width: 10 },
      { header: '趋势', key: 'trend', width: 10 },
      { header: '上次值', key: 'lastValue', width: 12 },
      { header: '连续异常年数', key: 'consecutive', width: 14 },
    ];

    ws.getRow(1).font = { bold: true };
    ws.getRow(1).alignment = { horizontal: 'center' };

    let totalItems = 0;
    reports.forEach((report) => {
      (report.reportItems || []).forEach((item) => {
        ws.addRow({
          reportNo: report.reportNo,
          empNo: report.employee?.empNo || '',
          name: report.employee?.name || '',
          deptName: report.department?.deptName || '',
          checkupDate: report.checkupDate,
          itemCode: item.itemCode,
          itemName: item.itemName,
          category: item.itemCategory || '',
          result: item.resultValue,
          numeric: item.numericValue ?? '',
          unit: item.unit || '',
          refRange: item.refRange || '',
          abnormal: item.isAbnormal ? '是' : '否',
          level: this._translateAbnormalLevel(item.abnormalLevel),
          highRisk: item.isHighRisk ? '是' : '否',
          trend: item.trend || '',
          lastValue: item.lastValue || '',
          consecutive: item.consecutiveAbnormalYears || 0,
        });
        totalItems++;
      });
    });

    await workbook.xlsx.writeFile(filePath);
    logger.info(`导出报告指标: ${fileName}, ${reports.length}份报告, ${totalItems}条指标`);

    return {
      fileName,
      url: `/reports/${fileName}`,
      filePath,
      reportCount: reports.length,
      itemCount: totalItems,
    };
  }

  async exportAppointments(filters = {}) {
    const allData = await this.queryAppointments(filters, { page: 1, pageSize: 10000 });

    const reportDir = path.resolve(config.storage.reportPath);
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    const fileName = `体检预约明细_${Date.now()}.xlsx`;
    const filePath = path.join(reportDir, fileName);

    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('预约明细', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: '预约单号', key: 'orderNo', width: 22 },
      { header: '工号', key: 'empNo', width: 14 },
      { header: '姓名', key: 'name', width: 12 },
      { header: '性别', key: 'gender', width: 8 },
      { header: '部门', key: 'deptName', width: 18 },
      { header: '套餐名称', key: 'pkgName', width: 24 },
      { header: '套餐金额', key: 'pkgPrice', width: 12 },
      { header: '加项金额', key: 'extra', width: 12 },
      { header: '总金额', key: 'total', width: 12 },
      { header: '申请年份', key: 'year', width: 10 },
      { header: '半年', key: 'half', width: 8 },
      { header: '状态', key: 'status', width: 12 },
      { header: '审批状态', key: 'approval', width: 12 },
      { header: '申请时间', key: 'createdAt', width: 20 },
      { header: '确认时间', key: 'confirmTime', width: 20 },
      { header: '备注', key: 'remark', width: 20 },
    ];

    ws.getRow(1).font = { bold: true };
    ws.getRow(1).alignment = { horizontal: 'center' };

    allData.list.forEach((a) => {
      ws.addRow({
        orderNo: a.orderNo,
        empNo: a.employee?.empNo || '',
        name: a.employee?.name || '',
        gender: a.employee?.gender === 'male' ? '男' : '女',
        deptName: a.department?.deptName || '',
        pkgName: a.packageName,
        pkgPrice: a.packagePrice,
        extra: a.extraAmount,
        total: a.totalAmount,
        year: a.year,
        half: a.half === '1' ? '上半年' : '下半年',
        status: this._translateApptStatus(a.status),
        approval: this._translateApprovalStatus(a.approvalStatus),
        createdAt: new Date(a.createdAt).toLocaleString('zh-CN'),
        confirmTime: a.confirmTime ? new Date(a.confirmTime).toLocaleString('zh-CN') : '',
        remark: a.applicantRemark || '',
      });
    });

    await workbook.xlsx.writeFile(filePath);
    logger.info(`导出预约明细: ${fileName}, ${allData.total}条`);

    return {
      fileName,
      url: `/reports/${fileName}`,
      filePath,
      totalCount: allData.total,
    };
  }

  async batchExport(exportConfig) {
    const { type, filters, ids } = exportConfig;
    let result;

    switch (type) {
      case 'lifecycle':
        result = await this.exportEmployeeLifecycle(filters);
        break;
      case 'report_items':
        result = await this.exportReportItems(ids);
        break;
      case 'appointments':
        result = await this.exportAppointments(filters);
        break;
      default:
        throw new Error('不支持的导出类型');
    }

    return result;
  }

  _translateApptStatus(status) {
    const map = {
      draft: '草稿',
      pending_approval: '待审批',
      approved: '已通过',
      rejected: '已驳回',
      cancelled: '已取消',
      confirmed: '已确认',
      in_progress: '进行中',
      completed: '已完成',
    };
    return map[status] || status;
  }

  _translateOrderStatus(status) {
    const map = {
      generated: '已生成',
      pushed: '已推送',
      scheduled: '已排期',
      checkin: '已签到',
      checking: '体检中',
      completed: '已完成',
      no_show: '爽约',
      cancelled: '已取消',
    };
    return map[status] || status;
  }

  _translateApprovalStatus(status) {
    const map = {
      none: '无需审批',
      pending: '审批中',
      approved: '审批通过',
      rejected: '已驳回',
    };
    return map[status] || status;
  }

  _translateAbnormalLevel(level) {
    const map = {
      normal: '正常',
      mild: '轻度',
      moderate: '中度',
      severe: '重度',
      critical: '危急',
    };
    return map[level] || level;
  }
}

module.exports = new QueryExportService();
module.exports.QueryExportService = QueryExportService;
