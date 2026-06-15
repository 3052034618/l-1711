const { Op } = require('sequelize');
const {
  CheckupReport,
  ReportItem,
  Employee,
  Department,
  sequelize,
} = require('../models');
const ReportService = require('./ReportService');
const WarningService = require('./WarningService');
const { generateOrderNo, paginate, formatPagedResult } = require('../utils/helpers');
const { logger, audit } = require('../utils/logger');
const { ValidationError, NotFoundError } = require('../utils/errorHandler');
const fs = require('fs');
const path = require('path');
const config = require('../config');

const ALLOWED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/jpg',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

const MAX_FILE_SIZE = 20 * 1024 * 1024;

class ExternalReportService {
  validateUploadFile(file) {
    if (!file) {
      throw new ValidationError('请上传文件');
    }

    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      throw new ValidationError(
        '不支持的文件格式，仅支持 PDF、JPG、PNG、Excel 格式'
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new ValidationError('文件大小不能超过 20MB');
    }

    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.pdf', '.jpg', '.jpeg', '.png', '.xls', '.xlsx'].includes(ext)) {
      throw new ValidationError('不支持的文件扩展名');
    }

    return {
      valid: true,
      fileType: this._detectFileType(ext),
      ext,
    };
  }

  _detectFileType(ext) {
    if (ext === '.pdf') return 'pdf';
    if (['.jpg', '.jpeg', '.png'].includes(ext)) return 'image';
    if (['.xls', '.xlsx'].includes(ext)) return 'excel';
    return 'json';
  }

  async uploadAndParse(data, file, operatorId) {
    const { employeeId, checkupDate, year, half = '1', hospitalName = '', reportNo = '' } = data;

    const employee = await Employee.findByPk(employeeId, {
      include: [{ association: 'department' }],
    });
    if (!employee) {
      throw new NotFoundError('员工不存在');
    }

    const fileInfo = this.validateUploadFile(file);

    const targetDir = path.resolve(config.storage.uploadPath, 'reports', String(employeeId));
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const timestamp = Date.now();
    const fileName = `${timestamp}_${file.originalname}`;
    const targetPath = path.join(targetDir, fileName);

    fs.copyFileSync(file.path, targetPath);

    const result = await sequelize.transaction(async (t) => {
      const report = await CheckupReport.create(
        {
          reportNo: reportNo || generateOrderNo(),
          employeeId,
          deptId: employee.deptId,
          hospitalId: null,
          hospitalName,
          checkupDate: checkupDate || new Date().toISOString().split('T')[0],
          reportDate: new Date().toISOString().split('T')[0],
          year: year || new Date(checkupDate || Date.now()).getFullYear(),
          half,
          source: 'manual_upload',
          fileUrl: `/uploads/reports/${employeeId}/${fileName}`,
          fileType: fileInfo.fileType,
          totalScore: data.totalScore || null,
          summary: data.summary || null,
          suggestions: data.suggestions || null,
          abnormalCount: data.abnormalCount || 0,
          highRiskCount: data.highRiskCount || 0,
          items: [],
          fetchStatus: 'success',
          ocrStatus: fileInfo.fileType === 'pdf' || fileInfo.fileType === 'image' ? 'pending' : 'not_needed',
          uploaderId: operatorId,
          status: 1,
        },
        { transaction: t }
      );

      if (data.items && Array.isArray(data.items) && data.items.length > 0) {
        const itemsWithHistory = await ReportService._enrichItemsWithHistory(
          employeeId,
          report.year,
          data.items
        );

        const reportItems = itemsWithHistory.map((item) => ({
          reportId: report.id,
          employeeId,
          year: report.year,
          checkupDate: report.checkupDate,
          itemCode: item.itemCode,
          itemName: item.itemName,
          itemCategory: item.itemCategory || '未分类',
          resultValue: item.resultValue,
          numericValue: item.numericValue,
          unit: item.unit,
          refRangeMin: item.refRangeMin,
          refRangeMax: item.refRangeMax,
          refRange: item.refRange,
          abnormalLevel: item.abnormalLevel || 'normal',
          isAbnormal: !!item.isAbnormal,
          isHighRisk: !!item.isHighRisk,
          consecutiveAbnormalYears: item.consecutiveAbnormalYears || (item.isAbnormal ? 1 : 0),
        }));

        await ReportItem.bulkCreate(reportItems, { transaction: t });

        report.items = itemsWithHistory;
        report.abnormalCount = reportItems.filter((i) => i.isAbnormal).length;
        report.highRiskCount = reportItems.filter((i) => i.isHighRisk).length;
        await report.save({ transaction: t });
      }

      return { report, filePath: targetPath };
    });

    audit(operatorId, 'upload', 'external_report', {
      employeeId,
      reportId: result.report.id,
      reportNo: result.report.reportNo,
      fileName: file.originalname,
      fileSize: file.size,
    });

    if (fileInfo.fileType === 'pdf' || fileInfo.fileType === 'image') {
      setTimeout(async () => {
        try {
          await ReportService.processOcrForReport(result.report.id, result.filePath, operatorId);
        } catch (e) {
          logger.error(`OCR处理失败: ${result.report.id}`, e);
        }
      }, 1000);
    }

    if (result.report.abnormalCount > 0) {
      setTimeout(() => {
        WarningService.analyzeReportAndGenerateWarnings(result.report.id).catch((e) => {
          logger.error('分析外部报告预警失败', e);
        });
      }, 2000);
    }

    logger.info(`外部报告上传成功: ${result.report.reportNo}, 员工: ${employeeId}`);

    return {
      report: result.report,
      fileInfo: {
        originalName: file.originalname,
        size: file.size,
        type: fileInfo.fileType,
        url: result.report.fileUrl,
      },
      ocrPending: fileInfo.fileType === 'pdf' || fileInfo.fileType === 'image',
    };
  }

  async updateReportItems(reportId, items, operatorId) {
    const report = await CheckupReport.findByPk(reportId);
    if (!report) {
      throw new NotFoundError('报告不存在');
    }

    if (report.source !== 'manual_upload') {
      throw new ValidationError('只能编辑手动上传的报告');
    }

    const result = await sequelize.transaction(async (t) => {
      await ReportItem.destroy({ where: { reportId } }, { transaction: t });

      const itemsWithHistory = await ReportService._enrichItemsWithHistory(
        report.employeeId,
        report.year,
        items
      );

      const reportItems = itemsWithHistory.map((item) => ({
        reportId,
        employeeId: report.employeeId,
        year: report.year,
        checkupDate: report.checkupDate,
        itemCode: item.itemCode,
        itemName: item.itemName,
        itemCategory: item.itemCategory || '未分类',
        resultValue: item.resultValue,
        numericValue: item.numericValue,
        unit: item.unit,
        refRangeMin: item.refRangeMin,
        refRangeMax: item.refRangeMax,
        refRange: item.refRange,
        abnormalLevel: item.abnormalLevel || 'normal',
        isAbnormal: !!item.isAbnormal,
        isHighRisk: !!item.isHighRisk,
        consecutiveAbnormalYears: item.consecutiveAbnormalYears || 0,
      }));

      await ReportItem.bulkCreate(reportItems, { transaction: t });

      report.items = itemsWithHistory;
      report.abnormalCount = reportItems.filter((i) => i.isAbnormal).length;
      report.highRiskCount = reportItems.filter((i) => i.isHighRisk).length;
      await report.save({ transaction: t });

      return report;
    });

    audit(operatorId, 'update_items', 'external_report', { reportId, itemsCount: items.length });

    return result;
  }

  async deleteUploadedReport(reportId, operatorId) {
    const report = await CheckupReport.findByPk(reportId);
    if (!report) {
      throw new NotFoundError('报告不存在');
    }

    if (report.source !== 'manual_upload') {
      throw new ValidationError('只能删除手动上传的报告');
    }

    await sequelize.transaction(async (t) => {
      await ReportItem.destroy({ where: { reportId } }, { transaction: t });
      await report.destroy({ transaction: t });
    });

    if (report.fileUrl) {
      const filePath = path.resolve('.', report.fileUrl);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (e) {
          logger.warn('删除报告文件失败', e);
        }
      }
    }

    audit(operatorId, 'delete', 'external_report', { reportId, reportNo: report.reportNo });

    return { success: true };
  }

  async getUploadedReports(filters = {}, options = {}) {
    const { page = 1, pageSize = 20 } = options;
    const { limit, offset } = paginate(page, pageSize);

    const where = { source: 'manual_upload' };
    if (filters.employeeId) where.employeeId = filters.employeeId;
    if (filters.deptId) where.deptId = filters.deptId;
    if (filters.year) where.year = filters.year;
    if (filters.uploaderId) where.uploaderId = filters.uploaderId;

    const { count, rows } = await CheckupReport.findAndCountAll({
      where,
      include: [
        { association: 'employee', attributes: ['id', 'name', 'empNo'] },
        { association: 'department', attributes: ['id', 'deptName'] },
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    return formatPagedResult(rows, count, page, pageSize);
  }

  async retryOcr(reportId, operatorId) {
    const report = await CheckupReport.findByPk(reportId);
    if (!report) {
      throw new NotFoundError('报告不存在');
    }

    if (!report.fileUrl || !['pdf', 'image'].includes(report.fileType)) {
      throw new ValidationError('该报告无需或不支持OCR识别');
    }

    report.ocrStatus = 'pending';
    await report.save();

    const filePath = path.resolve('.', report.fileUrl);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundError('报告源文件不存在');
    }

    setTimeout(async () => {
      try {
        await ReportService.processOcrForReport(reportId, filePath, operatorId);
      } catch (e) {
        logger.error(`重试OCR失败: ${reportId}`, e);
      }
    }, 500);

    audit(operatorId, 'retry_ocr', 'external_report', { reportId });

    return { success: true, message: '已提交OCR重处理' };
  }

  parseExcelData(excelJsonData) {
    const items = [];

    if (!excelJsonData || !Array.isArray(excelJsonData)) {
      return items;
    }

    const categoryMap = {
      '一般检查': ['身高', '体重', 'bmi', '血压', '心率'],
      '血常规': ['白细胞', '红细胞', '血红蛋白', '血小板', '红细胞压积'],
      '肝功能': ['谷丙', '谷草', '总胆红素', '直接胆红素', '白蛋白', '总蛋白'],
      '肾功能': ['肌酐', '尿素氮', '尿酸', '尿素'],
      '血脂': ['总胆固醇', '甘油三酯', '低密度', '高密度'],
      '血糖': ['空腹血糖', '血糖', '糖化'],
      '肿瘤标志物': ['afp', 'cea', 'ca125', 'ca199', 'psa'],
    };

    excelJsonData.forEach((row) => {
      if (!row.name && !row.项目名称 && !row.指标) {
        return;
      }

      const name = row.name || row.项目名称 || row.指标 || '';
      let category = '未分类';
      for (const [cat, keywords] of Object.entries(categoryMap)) {
        if (keywords.some((k) => name.toLowerCase().includes(k.toLowerCase()))) {
          category = cat;
          break;
        }
      }

      const numericValue = row.numericValue || row.数值 || row.result_value;
      const isAbnormal = row.isAbnormal || row.异常 || row.结果 === '异常' ||
        (row.参考范围 && this._checkAbnormal(numericValue, row.参考范围));
      const isHighRisk = row.isHighRisk || (isAbnormal && row.高危);

      items.push({
        itemCode: row.code || row.编码 || this._genItemCode(name),
        itemName: name,
        itemCategory: category,
        resultValue: row.value || row.结果 || row.result || (numericValue !== undefined ? String(numericValue) : ''),
        numericValue: numericValue !== undefined ? parseFloat(numericValue) : null,
        unit: row.unit || row.单位 || '',
        refRange: row.refRange || row.参考范围 || '',
        isAbnormal: !!isAbnormal,
        isHighRisk: !!isHighRisk,
        abnormalLevel: row.level || row.级别 || (isHighRisk ? 'severe' : isAbnormal ? 'mild' : 'normal'),
      });
    });

    return items;
  }

  _checkAbnormal(value, refRange) {
    if (value === undefined || value === null || !refRange) {
      return false;
    }

    const numVal = parseFloat(value);
    if (isNaN(numVal)) return false;

    const match = refRange.match(/(\d+(\.\d+)?)\s*[-~]\s*(\d+(\.\d+)?)/);
    if (match) {
      const min = parseFloat(match[1]);
      const max = parseFloat(match[3]);
      return numVal < min || numVal > max;
    }

    const lessMatch = refRange.match(/[<≤]\s*(\d+(\.\d+)?)/);
    if (lessMatch) {
      return numVal > parseFloat(lessMatch[1]);
    }

    const greaterMatch = refRange.match(/[>≥]\s*(\d+(\.\d+)?)/);
    if (greaterMatch) {
      return numVal < parseFloat(greaterMatch[1]);
    }

    return false;
  }

  _genItemCode(name) {
    let code = name.replace(/[\s（）()、,，.。]/g, '').toLowerCase();
    if (code.length > 32) code = code.substring(0, 32);
    return code || 'unknown';
  }
}

module.exports = new ExternalReportService();
module.exports.ExternalReportService = ExternalReportService;
