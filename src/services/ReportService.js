const { Op } = require('sequelize');
const {
  CheckupReport,
  CheckupOrder,
  ReportItem,
  Employee,
  Hospital,
  Appointment,
  sequelize,
} = require('../models');
const CheckupOrderService = require('./CheckupOrderService');
const NotificationService = require('./NotificationService');
const WarningService = require('./WarningService');
const { generateOrderNo, paginate, formatPagedResult, calculateAge, roundTo } = require('../utils/helpers');
const { logger, audit } = require('../utils/logger');
const { NotFoundError, ValidationError } = require('../utils/errorHandler');
const axios = require('axios');
const Tesseract = require('tesseract.js');
const path = require('path');
const config = require('../config');

class ReportService {
  async fetchReportFromHospital(checkupOrderId, operatorId) {
    const order = await CheckupOrder.findByPk(checkupOrderId, {
      include: [
        { association: 'hospital' },
        { association: 'employee' },
        { association: 'appointment' },
      ],
    });

    if (!order) {
      throw new NotFoundError('体检单不存在');
    }

    if (order.status !== 'completed') {
      throw new ValidationError('体检未完成，无法抓取报告');
    }

    let existingReport = await CheckupReport.findOne({
      where: { checkupOrderId },
    });

    if (existingReport && existingReport.status === 1 && existingReport.fetchStatus === 'success') {
      throw new ValidationError('该体检报告已存在且已成功获取');
    }

    if (!existingReport) {
      existingReport = await CheckupReport.create({
        reportNo: generateOrderNo(),
        checkupOrderId,
        orderNo: order.orderNo,
        employeeId: order.employeeId,
        deptId: order.deptId,
        hospitalId: order.hospitalId,
        hospitalName: order.hospitalName,
        checkupDate: order.checkupDate,
        reportDate: new Date().toISOString().split('T')[0],
        year: order.appointment ? order.appointment.year : new Date().getFullYear(),
        half: order.appointment ? order.appointment.half : '1',
        source: 'hospital',
        items: [],
        fetchStatus: 'fetching',
        fetchRetryCount: 0,
        ocrStatus: 'not_needed',
        status: 0,
      });
    } else {
      existingReport.fetchStatus = 'fetching';
      existingReport.fetchRetryCount = (existingReport.fetchRetryCount || 0) + 1;
      await existingReport.save();
    }

    let reportData;
    try {
      reportData = await this._callHospitalFetchApi(order);
      if (!reportData || !reportData.items || reportData.items.length === 0) {
        throw new Error('医院返回数据为空或格式无效');
      }
    } catch (error) {
      existingReport.fetchStatus = 'failed';
      existingReport.fetchError = `${error.message || '未知错误'}（时间：${new Date().toLocaleString('zh-CN')}）`;
      existingReport.status = 0;
      await existingReport.save();

      logger.error(`抓取医院报告失败 [${order.orderNo}]: ${error.message}`);
      throw new Error(`报告抓取失败：${error.message || '请稍后重试'}`);
    }

    return this._createReportFromHospitalData(order, reportData, operatorId, existingReport);
  }

  async _callHospitalFetchApi(order) {
    const hospital = order.hospital;

    if (!hospital) {
      throw new Error('体检单未关联医院信息');
    }

    if (!hospital.fetchEnabled) {
      throw new Error('该医院未启用报告自动抓取功能');
    }

    const endpoint = hospital.apiEndpoint || config.hospital.apiBase;
    const apiKey = hospital.apiKey || config.hospital.apiKey;

    if (!endpoint) {
      throw new Error('医院API接口未配置');
    }

    try {
      const response = await axios.get(
        `${endpoint}/checkup/reports/${order.hospitalOrderNo || order.orderNo}`,
        {
          headers: { 'X-API-Key': apiKey },
          timeout: 60000,
        }
      );

      if (!response.data || !response.data.items) {
        throw new Error('医院返回数据格式不正确，缺少items字段');
      }

      logger.info(`成功获取医院报告: ${order.orderNo}, 指标数: ${response.data.items.length}`);
      return response.data;
    } catch (error) {
      let errorMsg = error.message;
      if (error.response) {
        errorMsg = `HTTP ${error.response.status}: ${error.response.data?.message || error.response.statusText}`;
      } else if (error.code === 'ECONNABORTED') {
        errorMsg = '请求超时，医院接口响应过慢';
      } else if (error.code === 'ECONNREFUSED') {
        errorMsg = '无法连接到医院接口服务器';
      }
      throw new Error(errorMsg);
    }
  }

  _generateSuggestions(items) {
    const suggestions = [];
    const abnormalItems = items.filter((i) => i.isAbnormal);

    const itemSuggestions = {
      bmi: '建议控制饮食，增加有氧运动，每周至少3次，每次30分钟以上。',
      bp_sys: '注意监测血压，减少盐分摄入，避免熬夜和情绪激动。',
      bp_dia: '注意监测血压，减少盐分摄入，避免熬夜和情绪激动。',
      tc: '建议低脂饮食，减少动物内脏和蛋黄摄入，3个月后复查。',
      tg: '建议控制碳水摄入，增加膳食纤维，戒烟限酒，加强运动。',
      ldl: '建议减少饱和脂肪摄入，必要时咨询心内科医生。',
      hdl: '建议增加有氧运动，适量摄入坚果和橄榄油。',
      fbg: '建议控制糖分摄入，规律饮食，建议复查空腹血糖及糖化血红蛋白。',
      alt: '建议避免熬夜和饮酒，清淡饮食，2周后复查肝功能。',
      ast: '建议避免熬夜和饮酒，清淡饮食，2周后复查肝功能。',
      uric_acid: '建议低嘌呤饮食，多饮水，避免海鲜、啤酒、动物内脏。',
      creatinine: '建议多饮水，避免肾毒性药物，定期复查肾功能。',
    };

    abnormalItems.forEach((item) => {
      if (itemSuggestions[item.itemCode]) {
        suggestions.push(itemSuggestions[item.itemCode]);
      }
    });

    if (abnormalItems.length >= 3) {
      suggestions.unshift('多项指标异常，建议进行全面健康管理，必要时到专科就诊。');
    }

    if (suggestions.length === 0) {
      suggestions.push('建议保持规律作息，均衡饮食，适度运动，定期体检。');
    }

    return suggestions.join('\n\n');
  }

  async _createReportFromHospitalData(order, reportData, operatorId, existingReport = null) {
    const result = await sequelize.transaction(async (t) => {
      const employee = order.employee;
      const appointment = order.appointment;

      let report;
      if (existingReport) {
        report = existingReport;
        report.reportNo = reportData.reportNo || report.reportNo;
        report.totalScore = reportData.totalScore;
        report.summary = reportData.summary;
        report.suggestions = reportData.suggestions;
        report.abnormalCount = reportData.abnormalCount || 0;
        report.highRiskCount = reportData.highRiskCount || 0;
        report.items = reportData.items;
        report.fetchStatus = 'success';
        report.fetchError = null;
        report.status = 1;
        await report.save({ transaction: t });

        await ReportItem.destroy({ where: { reportId: report.id }, transaction: t });
      } else {
        report = await CheckupReport.create(
          {
            reportNo: reportData.reportNo || generateOrderNo(),
            checkupOrderId: order.id,
            orderNo: order.orderNo,
            employeeId: order.employeeId,
            deptId: order.deptId,
            hospitalId: order.hospitalId,
            hospitalName: order.hospitalName,
            checkupDate: reportData.checkupDate || order.checkupDate,
            reportDate: reportData.reportDate || new Date().toISOString().split('T')[0],
            year: appointment ? appointment.year : new Date().getFullYear(),
            half: appointment ? appointment.half : '1',
            source: 'hospital',
            totalScore: reportData.totalScore,
            summary: reportData.summary,
            suggestions: reportData.suggestions,
            abnormalCount: reportData.abnormalCount || 0,
            highRiskCount: reportData.highRiskCount || 0,
            items: reportData.items,
            fetchStatus: 'success',
            ocrStatus: 'not_needed',
            status: 1,
          },
          { transaction: t }
        );
      }

      const itemsWithHistory = await this._enrichItemsWithHistory(
        order.employeeId,
        report.year,
        reportData.items
      );

      const reportItems = itemsWithHistory.map((item) => ({
        reportId: report.id,
        employeeId: order.employeeId,
        year: report.year,
        checkupDate: report.checkupDate,
        itemCode: item.itemCode,
        itemName: item.itemName,
        itemCategory: item.itemCategory,
        resultValue: item.resultValue,
        numericValue: item.numericValue,
        unit: item.unit,
        refRangeMin: item.refRangeMin,
        refRangeMax: item.refRangeMax,
        refRange: item.refRange,
        abnormalLevel: item.abnormalLevel || 'normal',
        isAbnormal: !!item.isAbnormal,
        isHighRisk: !!item.isHighRisk,
        trend: item.trend,
        diffPercent: item.diffPercent,
        lastValue: item.lastValue,
        lastYear: item.lastYear,
        consecutiveAbnormalYears: item.consecutiveAbnormalYears || (item.isAbnormal ? 1 : 0),
        doctorAdvice: item.doctorAdvice,
      }));

      await ReportItem.bulkCreate(reportItems, { transaction: t });

      if (appointment) {
        appointment.status = 'completed';
        await appointment.save({ transaction: t });
      }

      return { report, reportItems };
    });

    audit(operatorId, 'create', 'checkup_report', {
      id: result.report.id,
      reportNo: result.report.reportNo,
      employeeId: order.employeeId,
      abnormalCount: result.report.abnormalCount,
    });

    setTimeout(() => {
      WarningService.analyzeReportAndGenerateWarnings(result.report.id).catch((e) => {
        logger.error('分析报告生成预警失败', e);
      });
    }, 1000);

    if (order.employeeId) {
      NotificationService.create({
        type: 'report_ready',
        channel: 'system',
        receiverId: order.employeeId,
        receiverType: 'employee',
        title: '您的体检报告已出炉',
        content: `您的体检报告已生成，本次共发现${result.report.abnormalCount}项异常，请登录系统查看详情。`,
        relatedType: 'checkup_report',
        relatedId: result.report.id.toString(),
      }).catch((e) => logger.error('发送报告通知失败', e));
    }

    logger.info(`报告入库成功: ${result.report.reportNo}, 异常${result.report.abnormalCount}项`);
    return result;
  }

  async _enrichItemsWithHistory(employeeId, currentYear, items) {
    const enriched = [];
    const itemCodes = items.map((i) => i.itemCode);

    const historyItems = await ReportItem.findAll({
      where: {
        employeeId,
        itemCode: { [Op.in]: itemCodes },
        year: { [Op.lt]: currentYear },
      },
      order: [['year', 'DESC']],
      raw: true,
    });

    for (const item of items) {
      const history = historyItems.filter((h) => h.item_code === item.itemCode);
      const lastHistory = history[0];

      const enrichedItem = { ...item };

      if (lastHistory) {
        enrichedItem.lastValue = lastHistory.result_value;
        enrichedItem.lastYear = lastHistory.year;

        if (
          item.numericValue !== null &&
          item.numericValue !== undefined &&
          lastHistory.numeric_value !== null
        ) {
          const current = parseFloat(item.numericValue);
          const last = parseFloat(lastHistory.numeric_value);
          if (last > 0 && current > 0) {
            enrichedItem.diffPercent = roundTo(((current - last) / last) * 100, 2);

            if (item.isAbnormal && lastHistory.is_abnormal) {
              enrichedItem.trend =
                Math.abs(enrichedItem.diffPercent) < 5
                  ? 'stable'
                  : enrichedItem.diffPercent > 0
                  ? 'deteriorated'
                  : 'improved';
            } else if (item.isAbnormal) {
              enrichedItem.trend = 'new';
            } else {
              enrichedItem.trend =
                Math.abs(enrichedItem.diffPercent) < 5 ? 'stable' : enrichedItem.diffPercent > 0 ? 'improved' : 'deteriorated';
            }
          }
        }

        let consecutive = 0;
        if (item.isAbnormal) {
          consecutive = 1;
          for (const h of history) {
            if (h.year === currentYear - consecutive && h.is_abnormal) {
              consecutive++;
            } else {
              break;
            }
          }
        }
        enrichedItem.consecutiveAbnormalYears = consecutive;
      } else if (item.isAbnormal) {
        enrichedItem.trend = 'new';
        enrichedItem.consecutiveAbnormalYears = 1;
      }

      enriched.push(enrichedItem);
    }

    return enriched;
  }

  async getReportDetail(reportId) {
    const report = await CheckupReport.findByPk(reportId, {
      include: [
        { association: 'employee', attributes: ['id', 'name', 'empNo', 'gender', 'birthday', 'phone'] },
        { association: 'department', attributes: ['id', 'deptName'] },
        { association: 'hospital', attributes: ['id', 'hospitalName'] },
        { association: 'checkupOrder' },
      ],
    });

    if (!report) {
      throw new NotFoundError('报告不存在');
    }

    const items = await ReportItem.findAll({
      where: { reportId },
      order: [['itemCategory', 'ASC'], ['itemName', 'ASC']],
    });

    const groupedItems = {};
    items.forEach((item) => {
      const cat = item.itemCategory || '其他';
      if (!groupedItems[cat]) {
        groupedItems[cat] = [];
      }
      groupedItems[cat].push(item);
    });

    return {
      ...report.toJSON(),
      items,
      groupedItems,
    };
  }

  async getReportList(filters = {}, options = {}) {
    const { page = 1, pageSize = 20 } = options;
    const { limit, offset } = paginate(page, pageSize);

    const where = {};
    if (filters.reportNo) where.reportNo = { [Op.like]: `%${filters.reportNo}%` };
    if (filters.employeeId) where.employeeId = filters.employeeId;
    if (filters.deptId) where.deptId = filters.deptId;
    if (filters.year) where.year = filters.year;
    if (filters.half) where.half = filters.half;
    if (filters.source) where.source = filters.source;
    if (filters.hasAbnormal !== undefined) {
      where.abnormalCount = filters.hasAbnormal ? { [Op.gt]: 0 } : 0;
    }
    if (filters.hasHighRisk !== undefined) {
      where.highRiskCount = filters.hasHighRisk ? { [Op.gt]: 0 } : 0;
    }

    const { count, rows } = await CheckupReport.findAndCountAll({
      where,
      include: [
        { association: 'employee', attributes: ['id', 'name', 'empNo'] },
        { association: 'department', attributes: ['id', 'deptName'] },
        { association: 'hospital', attributes: ['id', 'hospitalName'] },
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    return formatPagedResult(rows, count, page, pageSize);
  }

  async getEmployeeReports(employeeId, options = {}) {
    return this.getReportList({ employeeId }, options);
  }

  async getHealthTrend(employeeId, itemCode, yearRange = 5) {
    const currentYear = new Date().getFullYear();
    const startYear = currentYear - yearRange + 1;

    const items = await ReportItem.findAll({
      where: {
        employeeId,
        itemCode,
        year: { [Op.between]: [startYear, currentYear] },
      },
      include: [
        { association: 'report', attributes: ['reportNo', 'checkupDate'] },
      ],
      order: [['year', 'ASC'], ['checkupDate', 'ASC']],
    });

    const yearlyData = {};
    items.forEach((item) => {
      if (!yearlyData[item.year]) {
        yearlyData[item.year] = {
          year: item.year,
          value: item.numericValue,
          abnormalLevel: item.abnormalLevel,
          isAbnormal: item.isAbnormal,
          refRange: item.refRange,
          refRangeMin: item.refRangeMin,
          refRangeMax: item.refRangeMax,
          checkupDate: item.checkupDate,
        };
      }
    });

    const sortedYears = Object.keys(yearlyData)
      .map(Number)
      .sort((a, b) => a - b);

    const trendData = sortedYears.map((y) => yearlyData[y]);

    let overallTrend = 'stable';
    if (trendData.length >= 2) {
      const values = trendData
        .map((d) => parseFloat(d.value))
        .filter((v) => !isNaN(v));
      if (values.length >= 2) {
        const diff = values[values.length - 1] - values[0];
        const avg = values.reduce((s, v) => s + v, 0) / values.length;
        if (avg > 0) {
          const diffPercent = (diff / avg) * 100;
          overallTrend = Math.abs(diffPercent) < 5 ? 'stable' : diffPercent > 0 ? 'rising' : 'falling';
        }
      }
    }

    return {
      itemCode,
      itemName: items[0]?.itemName || itemCode,
      unit: items[0]?.unit || '',
      overallTrend,
      data: trendData,
      minValue: trendData.length ? Math.min(...trendData.map((d) => parseFloat(d.value) || 0)) : 0,
      maxValue: trendData.length ? Math.max(...trendData.map((d) => parseFloat(d.value) || 0)) : 0,
    };
  }

  async getAllTrendsForEmployee(employeeId, yearRange = 5) {
    const currentYear = new Date().getFullYear();
    const startYear = currentYear - yearRange + 1;

    const reports = await CheckupReport.findAll({
      where: {
        employeeId,
        year: { [Op.between]: [startYear, currentYear] },
      },
      attributes: ['id', 'year', 'totalScore', 'abnormalCount'],
      order: [['year', 'ASC']],
    });

    const allItems = await ReportItem.findAll({
      where: {
        employeeId,
        year: { [Op.between]: [startYear, currentYear] },
        isAbnormal: true,
      },
      attributes: ['itemCode', 'itemName', 'year', 'numericValue', 'abnormalLevel', 'isHighRisk'],
      order: [['itemCode', 'ASC'], ['year', 'ASC']],
    });

    const abnormalItemMap = {};
    allItems.forEach((item) => {
      if (!abnormalItemMap[item.itemCode]) {
        abnormalItemMap[item.itemCode] = {
          itemCode: item.itemCode,
          itemName: item.itemName,
          records: [],
          totalAbnormalYears: 0,
          hasHighRisk: false,
        };
      }
      abnormalItemMap[item.itemCode].records.push({
        year: item.year,
        value: item.numericValue,
        abnormalLevel: item.abnormalLevel,
        isHighRisk: item.isHighRisk,
      });
      abnormalItemMap[item.itemCode].totalAbnormalYears++;
      if (item.isHighRisk) {
        abnormalItemMap[item.itemCode].hasHighRisk = true;
      }
    });

    const yearlySummary = reports.map((r) => ({
      year: r.year,
      totalScore: r.totalScore,
      abnormalCount: r.abnormalCount,
    }));

    const scoreTrend = yearlySummary.map((r) => r.totalScore);
    let scoreTrendStr = 'stable';
    if (scoreTrend.length >= 2 && scoreTrend.every((s) => s !== null)) {
      const first = scoreTrend[0];
      const last = scoreTrend[scoreTrend.length - 1];
      const diff = last - first;
      scoreTrendStr = Math.abs(diff) < 3 ? 'stable' : diff > 0 ? 'improved' : 'deteriorated';
    }

    const abnormalItems = Object.values(abnormalItemMap).sort(
      (a, b) => b.totalAbnormalYears - a.totalAbnormalYears
    );

    return {
      employeeId,
      yearRange,
      yearlySummary,
      scoreTrend: scoreTrendStr,
      abnormalItems: abnormalItems.slice(0, 20),
      consecutiveAbnormalItems: abnormalItems.filter((i) => i.totalAbnormalYears >= 2),
      highRiskItems: abnormalItems.filter((i) => i.hasHighRisk),
    };
  }

  async processOcrForReport(reportId, filePath, operatorId) {
    const report = await CheckupReport.findByPk(reportId);
    if (!report) {
      throw new NotFoundError('报告不存在');
    }

    report.ocrStatus = 'processing';
    await report.save();

    try {
      const result = await Tesseract.recognize(filePath, 'chi_sim+eng', {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            logger.info(`OCR进度: ${reportId} - ${Math.round(m.progress * 100)}%`);
          }
        },
      });

      const extractedData = this._parseOcrText(result.data.text);

      report.ocrStatus = 'success';

      if (extractedData.items && extractedData.items.length > 0) {
        const existingItems = report.items || [];
        const mergedItems = this._mergeOcrItems(existingItems, extractedData.items);

        const enriched = await this._enrichItemsWithHistory(
          report.employeeId,
          report.year,
          mergedItems
        );

        report.items = enriched;
        report.abnormalCount = enriched.filter((i) => i.isAbnormal).length;
        report.highRiskCount = enriched.filter((i) => i.isHighRisk).length;

        await ReportItem.destroy({ where: { reportId } });
        const reportItems = enriched.map((item) => ({
          reportId: report.id,
          employeeId: report.employeeId,
          year: report.year,
          checkupDate: report.checkupDate,
          itemCode: item.itemCode,
          itemName: item.itemName,
          itemCategory: item.itemCategory || '未分类',
          resultValue: item.resultValue,
          numericValue: item.numericValue,
          unit: item.unit,
          refRange: item.refRange,
          refRangeMin: item.refRangeMin,
          refRangeMax: item.refRangeMax,
          abnormalLevel: item.abnormalLevel || 'normal',
          isAbnormal: !!item.isAbnormal,
          isHighRisk: !!item.isHighRisk,
          consecutiveAbnormalYears: item.consecutiveAbnormalYears || 0,
        }));
        await ReportItem.bulkCreate(reportItems);
      }

      await report.save();

      audit(operatorId, 'ocr_process', 'checkup_report', {
        reportId,
        filePath,
        itemsExtracted: extractedData.items?.length || 0,
      });

      return {
        success: true,
        text: result.data.text.substring(0, 500),
        itemsExtracted: extractedData.items?.length || 0,
      };
    } catch (error) {
      report.ocrStatus = 'failed';
      await report.save();
      throw error;
    }
  }

  _parseOcrText(text) {
    const items = [];
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

    const knownPatterns = [
      { code: 'wbc', name: '白细胞', category: '血常规' },
      { code: 'rbc', name: '红细胞', category: '血常规' },
      { code: 'hgb', name: '血红蛋白', category: '血常规' },
      { code: 'plt', name: '血小板', category: '血常规' },
      { code: 'alt', name: '谷丙转氨酶', category: '肝功能' },
      { code: 'ast', name: '谷草转氨酶', category: '肝功能' },
      { code: 'tc', name: '总胆固醇', category: '血脂' },
      { code: 'tg', name: '甘油三酯', category: '血脂' },
      { code: 'ldl', name: '低密度脂蛋白', category: '血脂' },
      { code: 'hdl', name: '高密度脂蛋白', category: '血脂' },
      { code: 'fbg', name: '空腹血糖', category: '血糖' },
      { code: 'creatinine', name: '肌酐', category: '肾功能' },
      { code: 'bun', name: '尿素氮', category: '肾功能' },
      { code: 'uric_acid', name: '尿酸', category: '肾功能' },
    ];

    lines.forEach((line) => {
      for (const pattern of knownPatterns) {
        if (line.includes(pattern.name)) {
          const match = line.match(/(\d+(\.\d+)?)/);
          if (match) {
            items.push({
              itemCode: pattern.code,
              itemName: pattern.name,
              itemCategory: pattern.category,
              numericValue: parseFloat(match[1]),
              resultValue: match[1],
              isAbnormal: line.includes('↑') || line.includes('↓') || line.includes('异常'),
              abnormalLevel: line.includes('↑↑') || line.includes('↓↓') ? 'moderate' : line.includes('↑') || line.includes('↓') ? 'mild' : 'normal',
            });
          }
          break;
        }
      }
    });

    return { items };
  }

  _mergeOcrItems(existingItems, ocrItems) {
    const merged = [...existingItems];
    const existingCodes = new Set(existingItems.map((i) => i.itemCode));

    ocrItems.forEach((ocrItem) => {
      if (existingCodes.has(ocrItem.itemCode)) {
        const existing = merged.find((i) => i.itemCode === ocrItem.itemCode);
        if (existing && !existing.numericValue && ocrItem.numericValue) {
          Object.assign(existing, ocrItem);
        }
      } else {
        merged.push(ocrItem);
      }
    });

    return merged;
  }

  async processHospitalCallback(data, operatorId) {
    const { hospitalOrderNo, orderNo, status, reportData } = data;

    let order;
    if (hospitalOrderNo) {
      order = await CheckupOrder.findOne({ where: { hospitalOrderNo } });
    }
    if (!order && orderNo) {
      order = await CheckupOrder.findOne({
        include: [{ association: 'hospital' }, { association: 'employee' }, { association: 'appointment' }],
        where: { orderNo },
      });
    }

    if (!order) {
      throw new NotFoundError('未找到对应的体检单');
    }

    if (status === 'completed') {
      order.status = 'completed';
      order.completedTime = new Date();
      await order.save();
    }

    if (reportData) {
      return this._createReportFromHospitalData(order, reportData, operatorId);
    }

    return { order, message: '状态已更新' };
  }

  async processReportFetchQueue(limit = 100) {
    const orders = await CheckupOrderService.getOrdersReadyForReportFetch(limit);
    const results = { success: 0, failed: 0, skipped: 0 };

    for (const order of orders) {
      try {
        const existing = await CheckupReport.findOne({
          where: { checkupOrderId: order.id },
        });

        if (existing) {
          results.skipped++;
          continue;
        }

        await this.fetchReportFromHospital(order.id, 0);
        results.success++;
      } catch (error) {
        results.failed++;
        logger.error(`自动抓取报告失败: ${order.orderNo}`, error.message);
      }
    }

    logger.info(`报告抓取队列处理完成: 成功${results.success}, 失败${results.failed}, 跳过${results.skipped}`);
    return results;
  }
}

module.exports = new ReportService();
module.exports.ReportService = ReportService;
