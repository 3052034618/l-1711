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
const ExcelJS = require('exceljs');

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

    let parsedItems = data.items ? (Array.isArray(data.items) ? data.items : []) : [];
    let excelParseResult = null;

    if (fileInfo.fileType === 'excel') {
      try {
        excelParseResult = await this._parseExcelFile(targetPath);
        if (excelParseResult && excelParseResult.items && excelParseResult.items.length > 0) {
          parsedItems = excelParseResult.items;
          logger.info(`Excel解析成功，提取到 ${parsedItems.length} 项指标: ${targetPath}`);
        }
      } catch (e) {
        logger.warn(`Excel自动解析失败，将使用手动上传数据: ${e.message}`);
      }
    }

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
          summary: data.summary || (excelParseResult ? excelParseResult.summary : null),
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

      let finalItems = parsedItems;
      if (finalItems && Array.isArray(finalItems) && finalItems.length > 0) {
        const itemsWithHistory = await ReportService._enrichItemsWithHistory(
          employeeId,
          report.year,
          finalItems
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

      return { report, filePath: targetPath, excelParseResult };
    });

    audit(operatorId, 'upload', 'external_report', {
      employeeId,
      reportId: result.report.id,
      reportNo: result.report.reportNo,
      fileName: file.originalname,
      fileSize: file.size,
      itemsExtracted: parsedItems.length,
      excelParsed: fileInfo.fileType === 'excel',
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

    logger.info(`外部报告上传成功: ${result.report.reportNo}, 员工: ${employeeId}, 指标: ${parsedItems.length}项`);

    return {
      report: result.report,
      fileInfo: {
        originalName: file.originalname,
        size: file.size,
        type: fileInfo.fileType,
        url: result.report.fileUrl,
      },
      ocrPending: fileInfo.fileType === 'pdf' || fileInfo.fileType === 'image',
      excelParsed: fileInfo.fileType === 'excel' && result.excelParseResult,
      itemsExtracted: parsedItems.length,
    };
  }

  async _parseExcelFile(filePath) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const allItems = [];
    let summary = null;

    const knownColumns = {
      name: ['项目名称', '项目', '指标名称', '指标', '检查项目', '检验项目', '项目名', 'name'],
      result: ['结果', '检查结果', '检验结果', '测定值', '结果值', '数值', 'value', 'result'],
      unit: ['单位', '计量单位', 'unit'],
      refRange: ['参考范围', '参考值', '参考区间', '正常值范围', '范围', 'reference', 'ref'],
      abnormal: ['异常', '异常标记', '结果异常', 'flag', 'abnormal', '△', '↑', '↓', 'H', 'L'],
      category: ['分类', '类别', '分组', 'category', '组名'],
    };

    for (const worksheet of workbook.worksheets) {
      if (!worksheet || worksheet.rowCount < 2) continue;

      const headerRow = this._findHeaderRow(worksheet, knownColumns);
      if (!headerRow || headerRow.index >= worksheet.rowCount) continue;

      const columnMap = this._mapColumns(headerRow, knownColumns);
      if (!columnMap.name || !columnMap.result) continue;

      let currentCategory = worksheet.name && worksheet.name !== 'Sheet1' ? worksheet.name : null;

      for (let i = headerRow.index + 1; i <= worksheet.rowCount; i++) {
        const row = worksheet.getRow(i);
        if (!row || row.cellCount === 0) continue;

        const name = this._getCellValue(row, columnMap.name);
        const result = this._getCellValue(row, columnMap.result);

        if (!name || String(name).trim() === '') continue;

        if (columnMap.category) {
          const cat = this._getCellValue(row, columnMap.category);
          if (cat && String(cat).trim() !== '') {
            currentCategory = String(cat).trim();
          }
        }

        const unit = columnMap.unit ? this._getCellValue(row, columnMap.unit) : '';
        const refRange = columnMap.refRange ? this._getCellValue(row, columnMap.refRange) : '';
        let abnormal = columnMap.abnormal ? this._getCellValue(row, columnMap.abnormal) : '';

        const nameStr = String(name).trim();
        const resultStr = result !== null && result !== undefined ? String(result).trim() : '';

        if (nameStr.includes('总结') || nameStr.includes('结论') || nameStr.includes('综述')) {
          summary = resultStr;
          continue;
        }

        let numericValue = null;
        if (resultStr !== '') {
          const numMatch = resultStr.match(/-?\d+(\.\d+)?/);
          if (numMatch) {
            numericValue = parseFloat(numMatch[0]);
          }
        }

        const abnormalFlags = ['↑', '↓', 'H', 'L', '异常', '偏高', '偏低', '高', '低'];
        let isAbnormal = !!abnormal && abnormalFlags.some((f) => String(abnormal).includes(f));
        if (!isAbnormal && resultStr) {
          isAbnormal = abnormalFlags.some((f) => resultStr.includes(f));
        }

        let abnormalLevel = 'normal';
        if (isAbnormal) {
          if (String(abnormal || resultStr).includes('↑↑') || String(abnormal || resultStr).includes('↓↓') || String(abnormal || resultStr).includes('严重')) {
            abnormalLevel = 'severe';
          } else if (numericValue !== null && refRange) {
            const match = refRange.match(/(\d+(\.\d+)?)\s*[-~]\s*(\d+(\.\d+)?)/);
            if (match) {
              const min = parseFloat(match[1]);
              const max = parseFloat(match[3]);
              if (numericValue > max * 1.3 || numericValue < min * 0.7) {
                abnormalLevel = 'moderate';
              } else {
                abnormalLevel = 'mild';
              }
            }
          } else {
            abnormalLevel = 'mild';
          }
        }

        let refRangeMin = null;
        let refRangeMax = null;
        if (refRange) {
          const match = refRange.match(/(\d+(\.\d+)?)\s*[-~]\s*(\d+(\.\d+)?)/);
          if (match) {
            refRangeMin = parseFloat(match[1]);
            refRangeMax = parseFloat(match[3]);
          } else {
            const lessMatch = refRange.match(/[<≤]\s*(\d+(\.\d+)?)/);
            if (lessMatch) {
              refRangeMin = 0;
              refRangeMax = parseFloat(lessMatch[1]);
            } else {
              const greaterMatch = refRange.match(/[>≥]\s*(\d+(\.\d+)?)/);
              if (greaterMatch) {
                refRangeMin = parseFloat(greaterMatch[1]);
                refRangeMax = null;
              }
            }
          }

          if (!isAbnormal && numericValue !== null && refRangeMin !== null && refRangeMax !== null) {
            isAbnormal = numericValue < refRangeMin || numericValue > refRangeMax;
            if (isAbnormal) {
              abnormalLevel = numericValue > refRangeMax * 1.3 || numericValue < refRangeMin * 0.7 ? 'moderate' : 'mild';
            }
          }
        }

        const itemCode = this._genItemCode(nameStr);

        allItems.push({
          itemCode,
          itemName: nameStr,
          itemCategory: currentCategory || this._detectCategory(nameStr),
          resultValue: resultStr,
          numericValue,
          unit: unit ? String(unit).trim() : '',
          refRange: refRange ? String(refRange).trim() : '',
          refRangeMin,
          refRangeMax,
          isAbnormal,
          isHighRisk: abnormalLevel === 'severe',
          abnormalLevel,
        });
      }
    }

    return {
      items: allItems,
      summary,
      sheetCount: workbook.worksheets.length,
    };
  }

  _findHeaderRow(worksheet, knownColumns) {
    const maxScanRows = Math.min(10, worksheet.rowCount);
    for (let i = 1; i <= maxScanRows; i++) {
      const row = worksheet.getRow(i);
      if (!row) continue;

      let hitCount = 0;
      row.eachCell((cell) => {
        const val = String(cell.value || '').trim().toLowerCase();
        for (const colDef of Object.values(knownColumns)) {
          if (colDef.some((keyword) => val.includes(keyword.toLowerCase()))) {
            hitCount++;
            break;
          }
        }
      });

      if (hitCount >= 2) {
        return { row, index: i };
      }
    }
    return null;
  }

  _mapColumns(headerRow, knownColumns) {
    const map = {};
    headerRow.row.eachCell((cell, colNumber) => {
      const val = String(cell.value || '').trim().toLowerCase();
      for (const [colName, keywords] of Object.entries(knownColumns)) {
        if (keywords.some((keyword) => val === keyword.toLowerCase() || val.includes(keyword.toLowerCase()))) {
          if (!map[colName]) {
            map[colName] = colNumber;
          }
          break;
        }
      }
    });
    return map;
  }

  _getCellValue(row, colNumber) {
    if (!colNumber || !row) return null;
    const cell = row.getCell(colNumber);
    if (!cell) return null;
    const val = cell.value;
    if (val === null || val === undefined) return null;
    if (typeof val === 'object' && val.result !== undefined) return val.result;
    return val;
  }

  _detectCategory(itemName) {
    const name = itemName.toLowerCase();
    const categoryMap = {
      '血常规': ['白细胞', '红细胞', '血红蛋白', '血小板', '红细胞压积', '平均红细胞', '中性粒', '淋巴', '单核', '嗜酸', '嗜碱', 'wbc', 'rbc', 'hgb', 'plt'],
      '肝功能': ['谷丙', '谷草', '胆红素', '白蛋白', '总蛋白', '球蛋白', '转氨酶', 'alt', 'ast', 'ggt', 'alp'],
      '肾功能': ['肌酐', '尿素氮', '尿酸', '尿素', '胱抑素', 'creatinine', 'bun', 'ua'],
      '血脂': ['总胆固醇', '甘油三酯', '低密度', '高密度', '脂蛋白', '载脂蛋白', 'tc', 'tg', 'ldl', 'hdl'],
      '血糖': ['空腹血糖', '血糖', '糖化', 'glucose', 'fbg', 'hba1c'],
      '一般检查': ['身高', '体重', 'bmi', '血压', '心率', '脉搏', '体温'],
      '肿瘤标志物': ['afp', 'cea', 'ca125', 'ca199', 'ca153', 'psa', '甲胎蛋白', '癌胚抗原'],
      '甲状腺': ['t3', 't4', 'tsh', '甲状腺', 'ft3', 'ft4'],
      '电解质': ['钾', '钠', '氯', '钙', '镁', '磷'],
    };

    for (const [cat, keywords] of Object.entries(categoryMap)) {
      if (keywords.some((k) => name.includes(k.toLowerCase()))) {
        return cat;
      }
    }
    return '其他';
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
