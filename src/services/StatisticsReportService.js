const { Op, QueryTypes } = require('sequelize');
const {
  Employee,
  Department,
  Appointment,
  CheckupOrder,
  CheckupReport,
  ReportItem,
  WarningTicket,
  Budget,
  sequelize,
} = require('../models');
const { logger } = require('../utils/logger');
const { getYearRange, roundTo } = require('../utils/helpers');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const path = require('path');
const fs = require('fs');
const config = require('../config');

const chartCanvas = new ChartJSNodeCanvas({
  width: 800,
  height: 400,
  backgroundColour: 'white',
});

class StatisticsReportService {
  async getDeptDailyStats(deptId, year, half) {
    const { start, end } = getYearRange(year);

    const departments = deptId
      ? await Department.findAll({
          where: { id: deptId, status: 1 },
          include: [{ association: 'children' }],
        })
      : await Department.findAll({ where: { status: 1 } });

    const deptIds = this._collectAllDeptIds(departments);

    const stats = [];
    for (const dept of departments) {
      const childDeptIds = this._getDeptAndChildrenIds(dept);
      const deptStats = await this._calcDeptStats(dept, childDeptIds, year, half, start, end);
      stats.push(deptStats);
    }

    return {
      year,
      half,
      generatedAt: new Date().toISOString(),
      totalDepartments: stats.length,
      departments: stats,
      summary: this._calcSummary(stats),
    };
  }

  _collectAllDeptIds(departments) {
    const ids = [];
    const collect = (depts) => {
      for (const d of depts) {
        ids.push(d.id);
        if (d.children && d.children.length) {
          collect(d.children);
        }
      }
    };
    collect(departments);
    return ids;
  }

  _getDeptAndChildrenIds(dept) {
    const ids = [dept.id];
    const collect = (parent) => {
      if (parent.children && parent.children.length) {
        for (const child of parent.children) {
          ids.push(child.id);
          collect(child);
        }
      }
    };
    collect(dept);
    return ids;
  }

  async _calcDeptStats(dept, deptIds, year, half, start, end) {
    const employeeCount = await Employee.count({
      where: { deptId: { [Op.in]: deptIds }, status: 1 },
    });

    const appointments = await Appointment.findAll({
      where: {
        deptId: { [Op.in]: deptIds },
        year,
        half: half === 'all' ? { [Op.in]: ['1', '2'] } : half,
        status: { [Op.notIn]: ['draft', 'rejected'] },
      },
    });

    const submittedCount = appointments.length;
    const approvedCount = appointments.filter((a) =>
      ['approved', 'confirmed', 'in_progress', 'completed'].includes(a.status)
    ).length;

    const checkupOrders = await CheckupOrder.findAll({
      where: {
        deptId: { [Op.in]: deptIds },
        checkupDate: { [Op.between]: [start, end] },
      },
    });

    const generatedCount = checkupOrders.length;
    const completedCount = checkupOrders.filter(
      (o) => o.status === 'completed'
    ).length;
    const noShowCount = checkupOrders.filter((o) => o.status === 'no_show').length;
    const checkinCount = checkupOrders.filter(
      (o) => ['checkin', 'checking', 'completed'].includes(o.status)
    ).length;

    const completionRate = employeeCount > 0
      ? roundTo((completedCount / employeeCount) * 100, 2)
      : 0;
    const checkinRate = generatedCount > 0
      ? roundTo((checkinCount / generatedCount) * 100, 2)
      : 0;
    const noShowRate = generatedCount > 0
      ? roundTo((noShowCount / generatedCount) * 100, 2)
      : 0;

    const reports = await CheckupReport.findAll({
      where: {
        deptId: { [Op.in]: deptIds },
        year,
      },
    });

    const reportCount = reports.length;
    const abnormalReportCount = reports.filter((r) => r.abnormalCount > 0).length;
    const abnormalRate = reportCount > 0
      ? roundTo((abnormalReportCount / reportCount) * 100, 2)
      : 0;

    const totalAbnormalItems = reports.reduce((s, r) => s + (r.abnormalCount || 0), 0);
    const totalHighRiskItems = reports.reduce((s, r) => s + (r.highRiskCount || 0), 0);

    const warningCount = await WarningTicket.count({
      where: {
        deptId: { [Op.in]: deptIds },
        createdAt: { [Op.between]: [start, end] },
      },
    });
    const highWarningCount = await WarningTicket.count({
      where: {
        deptId: { [Op.in]: deptIds },
        warningLevel: { [Op.in]: ['high', 'critical'] },
        createdAt: { [Op.between]: [start, end] },
      },
    });

    const budget = await Budget.findOne({
      where: { deptId: dept.id, year, half: half === 'all' ? 'all' : half },
    });

    const totalBudget = budget ? parseFloat(budget.totalAmount) : 0;
    const usedBudget = appointments
      .filter((a) => a.status === 'completed')
      .reduce((s, a) => s + parseFloat(a.totalAmount || 0), 0);
    const budgetUsageRate = totalBudget > 0
      ? roundTo((usedBudget / totalBudget) * 100, 2)
      : 0;

    return {
      deptId: dept.id,
      deptCode: dept.deptCode,
      deptName: dept.deptName,
      employeeCount,
      appointment: {
        submitted: submittedCount,
        approved: approvedCount,
        approvalRate: submittedCount > 0 ? roundTo((approvedCount / submittedCount) * 100, 2) : 0,
      },
      checkup: {
        generated: generatedCount,
        checkin: checkinCount,
        completed: completedCount,
        noShow: noShowCount,
        completionRate,
        checkinRate,
        noShowRate,
      },
      report: {
        total: reportCount,
        abnormal: abnormalReportCount,
        abnormalRate,
        totalAbnormalItems,
        totalHighRiskItems,
      },
      warning: {
        total: warningCount,
        highLevel: highWarningCount,
      },
      budget: {
        total: totalBudget,
        used: usedBudget,
        remaining: totalBudget - usedBudget,
        usageRate: budgetUsageRate,
      },
    };
  }

  _calcSummary(deptStats) {
    const sum = (arr, getter) => arr.reduce((s, d) => s + getter(d), 0);

    const employeeCount = sum(deptStats, (d) => d.employeeCount);
    const completedCount = sum(deptStats, (d) => d.checkup.completed);
    const abnormalReportCount = sum(deptStats, (d) => d.report.abnormal);
    const totalReport = sum(deptStats, (d) => d.report.total);
    const totalWarning = sum(deptStats, (d) => d.warning.total);
    const totalBudget = sum(deptStats, (d) => d.budget.total);
    const usedBudget = sum(deptStats, (d) => d.budget.used);

    return {
      employeeCount,
      completionRate: employeeCount > 0 ? roundTo((completedCount / employeeCount) * 100, 2) : 0,
      abnormalRate: totalReport > 0 ? roundTo((abnormalReportCount / totalReport) * 100, 2) : 0,
      warningCount: totalWarning,
      budgetUsageRate: totalBudget > 0 ? roundTo((usedBudget / totalBudget) * 100, 2) : 0,
    };
  }

  async getAbnormalItemsRanking(year, deptId, limit = 20) {
    const where = { year };
    if (deptId) {
      where.deptId = deptId;
    }

    const reports = await CheckupReport.findAll({
      where,
      attributes: ['id', 'year'],
    });
    const reportIds = reports.map((r) => r.id);

    if (reportIds.length === 0) {
      return { rankings: [], totalReports: 0 };
    }

    const results = await ReportItem.findAll({
      where: {
        reportId: { [Op.in]: reportIds },
        isAbnormal: true,
      },
      attributes: [
        'itemCode',
        'itemName',
        'itemCategory',
        [sequelize.fn('COUNT', sequelize.col('id')), 'abnormalCount'],
        [sequelize.fn('SUM', sequelize.literal('CASE WHEN is_high_risk = 1 THEN 1 ELSE 0 END')), 'highRiskCount'],
      ],
      group: ['itemCode', 'itemName', 'itemCategory'],
      order: [[sequelize.literal('abnormalCount'), 'DESC']],
      limit,
      raw: true,
    });

    const rankings = results.map((r, idx) => ({
      rank: idx + 1,
      itemCode: r.item_code || r.itemCode,
      itemName: r.item_name || r.itemName,
      itemCategory: r.item_category || r.itemCategory,
      abnormalCount: parseInt(r.abnormalCount || 0),
      highRiskCount: parseInt(r.highRiskCount || 0),
      abnormalRate: roundTo((parseInt(r.abnormalCount || 0) / reports.length) * 100, 2),
    }));

    return {
      rankings,
      totalReports: reports.length,
      period: `${year}年`,
    };
  }

  async getTrendAnalysis(years = 5) {
    const currentYear = new Date().getFullYear();
    const startYear = currentYear - years + 1;
    const yearRange = [];
    for (let y = startYear; y <= currentYear; y++) {
      yearRange.push(y);
    }

    const trends = [];

    for (const year of yearRange) {
      const { start, end } = getYearRange(year);

      const employeeCount = await Employee.count({
        where: { status: 1 },
      });

      const completedCount = await CheckupOrder.count({
        where: {
          status: 'completed',
          checkupDate: { [Op.between]: [start, end] },
        },
      });

      const reportCount = await CheckupReport.count({ where: { year } });
      const abnormalReportCount = await CheckupReport.count({
        where: { year, abnormalCount: { [Op.gt]: 0 } },
      });

      const warningCount = await WarningTicket.count({
        where: { createdAt: { [Op.between]: [start, end] } },
      });

      const appointments = await Appointment.findAll({
        where: { year, status: 'completed' },
      });
      const totalAmount = appointments.reduce(
        (s, a) => s + parseFloat(a.totalAmount || 0),
        0
      );

      const budgets = await Budget.findAll({ where: { year, half: 'all' } });
      const totalBudget = budgets.reduce((s, b) => s + parseFloat(b.totalAmount || 0), 0);
      const usedBudget = budgets.reduce((s, b) => s + parseFloat(b.usedAmount || 0) + parseFloat(b.overBudgetUsedAmount || 0), 0);
      const budgetUsageRate = totalBudget > 0 ? roundTo((usedBudget / totalBudget) * 100, 2) : 0;

      trends.push({
        year,
        employeeCount,
        completedCount,
        completionRate: employeeCount > 0 ? roundTo((completedCount / employeeCount) * 100, 2) : 0,
        reportCount,
        abnormalReportCount,
        abnormalRate: reportCount > 0 ? roundTo((abnormalReportCount / reportCount) * 100, 2) : 0,
        warningCount,
        totalAmount: roundTo(totalAmount, 2),
        totalBudget,
        usedBudget,
        budgetUsageRate,
      });
    }

    return {
      years: yearRange,
      trends,
      metrics: ['completionRate', 'abnormalRate', 'budgetUsageRate', 'warningCount'],
    };
  }

  async generatePDFReport(year, half, deptId = null) {
    const stats = await this.getDeptDailyStats(deptId, year, half);
    const itemRankings = await this.getAbnormalItemsRanking(year, deptId);
    const trend = await this.getTrendAnalysis(5);

    const reportDir = path.resolve(config.storage.reportPath);
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    const fileName = `体检统计报表_${year}年${half === 'all' ? '' : (half === '1' ? '上半年' : '下半年')}_${Date.now()}.pdf`;
    const filePath = path.join(reportDir, fileName);

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: 40 });
        const stream = fs.createWriteStream(filePath);

        doc.pipe(stream);

        this._renderPDFContent(doc, stats, itemRankings, trend, year, half);

        doc.end();

        stream.on('finish', () => {
          logger.info(`PDF报表生成: ${fileName}`);
          resolve({ filePath, fileName, url: `/reports/${fileName}` });
        });
        stream.on('error', reject);
      } catch (e) {
        reject(e);
      }
    });
  }

  _renderPDFContent(doc, stats, itemRankings, trend, year, half) {
    const marginLeft = 40;
    const pageWidth = 515;
    let y = 60;

    doc.fontSize(20).font('Helvetica-Bold');
    doc.text('企业员工体检统计报表', marginLeft, y, { align: 'center', width: pageWidth });
    y += 30;

    doc.fontSize(12).font('Helvetica');
    doc.text(
      `报表周期：${year}年${half === 'all' ? '全年' : half === '1' ? '上半年' : '下半年'}`,
      marginLeft,
      y
    );
    y += 15;
    doc.text(`生成时间：${new Date().toLocaleString('zh-CN')}`, marginLeft, y);
    y += 25;

    doc.moveTo(marginLeft, y).lineTo(marginLeft + pageWidth, y).stroke();
    y += 15;

    const s = stats.summary;
    doc.fontSize(14).font('Helvetica-Bold');
    doc.text('总体概况', marginLeft, y);
    y += 20;

    doc.fontSize(10).font('Helvetica');
    const overviewData = [
      ['总员工数', s.employeeCount + ' 人'],
      ['体检完成率', s.completionRate + ' %'],
      ['异常报告率', s.abnormalRate + ' %'],
      ['预警工单数', s.warningCount + ' 条'],
      ['预算使用率', s.budgetUsageRate + ' %'],
    ];

    overviewData.forEach((row, idx) => {
      const colX = marginLeft + (idx % 2) * 250;
      doc.font('Helvetica-Bold').text(row[0] + ':', colX, y);
      doc.font('Helvetica').text(row[1], colX + 80, y);
      if (idx % 2 === 1) y += 15;
    });
    y += 25;

    doc.moveTo(marginLeft, y).lineTo(marginLeft + pageWidth, y).stroke();
    y += 15;

    doc.fontSize(14).font('Helvetica-Bold');
    doc.text('各部门体检完成情况', marginLeft, y);
    y += 20;

    doc.fontSize(9).font('Helvetica-Bold');
    const headers = ['部门', '员工数', '完成数', '完成率', '异常率', '预算使用'];
    const colWidths = [120, 50, 50, 60, 60, 60];
    let colX = marginLeft;
    headers.forEach((h, i) => {
      doc.text(h, colX, y);
      colX += colWidths[i];
    });
    y += 12;

    doc.fontSize(9).font('Helvetica');
    stats.departments.forEach((d) => {
      if (y > 750) {
        doc.addPage();
        y = 60;
      }
      colX = marginLeft;
      const rowData = [
        d.deptName,
        String(d.employeeCount),
        String(d.checkup.completed),
        d.checkup.completionRate + '%',
        d.report.abnormalRate + '%',
        d.budget.usageRate + '%',
      ];
      rowData.forEach((cell, i) => {
        doc.text(cell, colX, y);
        colX += colWidths[i];
      });
      y += 12;
    });
    y += 20;

    doc.addPage();
    y = 60;
    doc.fontSize(14).font('Helvetica-Bold');
    doc.text('历年趋势分析图表', marginLeft, y);
    y += 10;

    doc.fontSize(10).font('Helvetica');
    doc.text('注：以下图表展示近5年关键指标变化趋势', marginLeft, y);
    y += 20;

    this._drawPDFChart(doc, marginLeft, y, pageWidth, 220, {
      title: '体检完成率趋势 (%)',
      data: trend.trends.map((t) => ({ label: t.year, value: t.completionRate })),
      color: '#4CAF50',
      yMax: 100,
      showGrid: true,
    });
    y += 240;

    this._drawPDFChart(doc, marginLeft, y, pageWidth, 220, {
      title: '异常报告率趋势 (%)',
      data: trend.trends.map((t) => ({ label: t.year, value: t.abnormalRate })),
      color: '#FF9800',
      yMax: 100,
      showGrid: true,
    });
    y += 240;

    if (y > 750) {
      doc.addPage();
      y = 60;
    }

    this._drawPDFChart(doc, marginLeft, y, pageWidth, 220, {
      title: '预算使用率趋势 (%)',
      data: trend.trends.map((t) => ({ label: t.year, value: t.budgetUsageRate })),
      color: '#2196F3',
      yMax: 100,
      showGrid: true,
    });
    y += 240;

    doc.addPage();
    y = 60;
    doc.fontSize(14).font('Helvetica-Bold');
    doc.text(`异常指标TOP ${itemRankings.rankings.length}`, marginLeft, y);
    y += 20;

    doc.fontSize(9).font('Helvetica-Bold');
    const topHeaders = ['排名', '指标名称', '分类', '异常次数', '高危次数', '异常率'];
    const topColWidths = [40, 160, 100, 60, 60, 60];
    colX = marginLeft;
    topHeaders.forEach((h, i) => {
      doc.text(h, colX, y);
      colX += topColWidths[i];
    });
    y += 12;

    doc.fontSize(9).font('Helvetica');
    itemRankings.rankings.forEach((r) => {
      if (y > 780) {
        doc.addPage();
        y = 60;
      }
      colX = marginLeft;
      const row = [
        String(r.rank),
        r.itemName,
        r.itemCategory,
        String(r.abnormalCount),
        String(r.highRiskCount),
        r.abnormalRate + '%',
      ];
      row.forEach((cell, i) => {
        doc.text(cell, colX, y);
        colX += topColWidths[i];
      });
      y += 12;
    });

    y += 20;
    doc.fontSize(14).font('Helvetica-Bold');
    doc.text('历年趋势数据明细', marginLeft, y);
    y += 15;
    doc.fontSize(9).font('Helvetica');
    trend.trends.forEach((t) => {
      if (y > 780) {
        doc.addPage();
        y = 60;
      }
      doc.text(
        `${t.year}年：完成率 ${t.completionRate}%，异常率 ${t.abnormalRate}%，预算使用率 ${t.budgetUsageRate}%，预警 ${t.warningCount} 条`,
        marginLeft,
        y
      );
      y += 12;
    });
  }

  _drawPDFChart(doc, x, y, width, height, options) {
    const { title, data, color = '#2196F3', yMax = null, showGrid = true } = options;

    const padding = { top: 25, right: 20, bottom: 30, left: 50 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const chartX = x + padding.left;
    const chartY = y + padding.top;

    doc.fontSize(11).font('Helvetica-Bold');
    doc.fillColor('#333').text(title, x, y);

    const values = data.map((d) => d.value);
    const maxVal = yMax || Math.max(...values, 10);
    const minVal = 0;
    const valueRange = maxVal - minVal;

    doc.fontSize(8).font('Helvetica');
    doc.fillColor('#888');

    const yTicks = 5;
    for (let i = 0; i <= yTicks; i++) {
      const tickVal = (maxVal * i) / yTicks;
      const tickY = chartY + chartHeight - (chartHeight * i) / yTicks;
      doc.text(tickVal.toFixed(0) + '%', x, tickY - 4, { width: 45, align: 'right' });

      if (showGrid && i < yTicks) {
        doc.strokeColor('#E0E0E0')
           .lineWidth(0.5)
           .moveTo(chartX, tickY)
           .lineTo(chartX + chartWidth, tickY)
           .stroke();
      }
    }

    doc.strokeColor('#333').lineWidth(1);
    doc.moveTo(chartX, chartY).lineTo(chartX, chartY + chartHeight).stroke();
    doc.moveTo(chartX, chartY + chartHeight).lineTo(chartX + chartWidth, chartY + chartHeight).stroke();

    const pointCount = data.length;
    const barWidth = pointCount > 0 ? Math.min(chartWidth / pointCount - 10, 40) : 30;
    const barGap = pointCount > 0 ? (chartWidth - barWidth * pointCount) / (pointCount + 1) : 10;

    data.forEach((d, i) => {
      const barX = chartX + barGap + i * (barWidth + barGap);
      const barHeight = valueRange > 0 ? (chartHeight * d.value) / valueRange : 0;
      const barY = chartY + chartHeight - barHeight;

      doc.fillColor(color)
         .rect(barX, barY, barWidth, barHeight)
         .fill();

      doc.strokeColor('#333').lineWidth(0.5)
         .rect(barX, barY, barWidth, barHeight)
         .stroke();

      doc.fillColor('#333')
         .fontSize(7)
         .text(d.value.toFixed(1) + '%', barX, barY - 10, { width: barWidth, align: 'center' });

      doc.fontSize(8)
         .fillColor('#666')
         .text(d.label, barX, chartY + chartHeight + 5, { width: barWidth, align: 'center' });
    });

    if (data.length >= 2) {
      doc.strokeColor(color).lineWidth(1.5).opacity(0.8);
      data.forEach((d, i) => {
        const barX = chartX + barGap + i * (barWidth + barGap) + barWidth / 2;
        const barHeight = valueRange > 0 ? (chartHeight * d.value) / valueRange : 0;
        const pointY = chartY + chartHeight - barHeight;

        if (i === 0) {
          doc.moveTo(barX, pointY);
        } else {
          doc.lineTo(barX, pointY);
        }
      });
      doc.stroke();

      data.forEach((d, i) => {
        const barX = chartX + barGap + i * (barWidth + barGap) + barWidth / 2;
        const barHeight = valueRange > 0 ? (chartHeight * d.value) / valueRange : 0;
        const pointY = chartY + chartHeight - barHeight;

        doc.fillColor('#FFF')
           .circle(barX, pointY, 3)
           .fill();
        doc.strokeColor(color)
           .lineWidth(1.5)
           .circle(barX, pointY, 3)
           .stroke();
      });
      doc.opacity(1);
    }

    doc.fillColor('#000');
  }

  async generateExcelReport(year, half, deptId = null) {
    const stats = await this.getDeptDailyStats(deptId, year, half);
    const itemRankings = await this.getAbnormalItemsRanking(year, deptId);
    const trend = await this.getTrendAnalysis(5);

    const reportDir = path.resolve(config.storage.reportPath);
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    const fileName = `体检统计报表_${year}年${half === 'all' ? '' : (half === '1' ? '上半年' : '下半年')}_${Date.now()}.xlsx`;
    const filePath = path.join(reportDir, fileName);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Health Management System';
    workbook.created = new Date();

    this._buildSummarySheet(workbook, stats, year, half);
    this._buildDeptSheet(workbook, stats);
    this._buildAbnormalRankingSheet(workbook, itemRankings);
    await this._buildTrendSheet(workbook, trend);

    await workbook.xlsx.writeFile(filePath);
    logger.info(`Excel报表生成: ${fileName}`);

    return { filePath, fileName, url: `/reports/${fileName}` };
  }

  _buildSummarySheet(workbook, stats, year, half) {
    const ws = workbook.addWorksheet('总体概况', { views: [{ state: 'frozen', ySplit: 2 }] });
    ws.columns = [
      { header: '指标', key: 'metric', width: 25 },
      { header: '数值', key: 'value', width: 20 },
      { header: '说明', key: 'note', width: 35 },
    ];

    ws.getRow(1).font = { bold: true, size: 12 };
    ws.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

    const s = stats.summary;
    ws.addRow({ metric: '报表周期', value: `${year}年${half === 'all' ? '全年' : half === '1' ? '上半年' : '下半年'}` });
    ws.addRow({ metric: '统计部门数', value: stats.totalDepartments });
    ws.addRow({ metric: '总员工数', value: s.employeeCount, note: '在职员工' });
    ws.addRow({ metric: '总体体检完成率', value: s.completionRate + ' %' });
    ws.addRow({ metric: '异常报告率', value: s.abnormalRate + ' %' });
    ws.addRow({ metric: '预警工单总数', value: s.warningCount });
    ws.addRow({ metric: '预算使用率', value: s.budgetUsageRate + ' %' });
    ws.addRow({ metric: '生成时间', value: new Date().toLocaleString('zh-CN') });
  }

  _buildDeptSheet(workbook, stats) {
    const ws = workbook.addWorksheet('各部门明细', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: '部门编码', key: 'deptCode', width: 12 },
      { header: '部门名称', key: 'deptName', width: 18 },
      { header: '员工数', key: 'empCount', width: 10 },
      { header: '体检完成数', key: 'completed', width: 12 },
      { header: '完成率', key: 'completionRate', width: 10 },
      { header: '报告数', key: 'reports', width: 10 },
      { header: '异常报告数', key: 'abnormal', width: 12 },
      { header: '异常率', key: 'abnormalRate', width: 10 },
      { header: '预警总数', key: 'warning', width: 10 },
      { header: '高危预警', key: 'highWarning', width: 10 },
      { header: '预算总额', key: 'budgetTotal', width: 12 },
      { header: '已使用', key: 'budgetUsed', width: 12 },
      { header: '使用率', key: 'budgetRate', width: 10 },
    ];

    ws.getRow(1).font = { bold: true };
    ws.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

    stats.departments.forEach((d) => {
      ws.addRow({
        deptCode: d.deptCode,
        deptName: d.deptName,
        empCount: d.employeeCount,
        completed: d.checkup.completed,
        completionRate: d.checkup.completionRate + '%',
        reports: d.report.total,
        abnormal: d.report.abnormal,
        abnormalRate: d.report.abnormalRate + '%',
        warning: d.warning.total,
        highWarning: d.warning.highLevel,
        budgetTotal: d.budget.total,
        budgetUsed: d.budget.used,
        budgetRate: d.budget.usageRate + '%',
      });
    });
  }

  _buildAbnormalRankingSheet(workbook, itemRankings) {
    const ws = workbook.addWorksheet('异常指标排行', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: '排名', key: 'rank', width: 8 },
      { header: '指标名称', key: 'itemName', width: 25 },
      { header: '分类', key: 'category', width: 15 },
      { header: '异常次数', key: 'count', width: 12 },
      { header: '高危次数', key: 'highCount', width: 12 },
      { header: '异常率', key: 'rate', width: 12 },
    ];

    ws.getRow(1).font = { bold: true };
    ws.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

    itemRankings.rankings.forEach((r) => {
      ws.addRow({
        rank: r.rank,
        itemName: r.itemName,
        category: r.itemCategory,
        count: r.abnormalCount,
        highCount: r.highRiskCount,
        rate: r.abnormalRate + '%',
      });
    });
  }

  async _generateChartImage(config) {
    try {
      const configuration = {
        type: config.type || 'line',
        data: config.data,
        options: {
          responsive: true,
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                font: { size: 12 },
              },
            },
            title: {
              display: true,
              text: config.title,
              font: { size: 16, weight: 'bold' },
            },
          },
          scales: {
            y: {
              beginAtZero: true,
              max: config.yMax || 100,
              title: {
                display: true,
                text: config.yLabel || '数值',
              },
            },
          },
        },
      };

      const buffer = await chartCanvas.renderToBuffer(configuration);
      return buffer;
    } catch (e) {
      logger.error('生成图表图片失败', e);
      return null;
    }
  }

  async _buildTrendSheet(workbook, trend) {
    const ws = workbook.addWorksheet('历年趋势', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: '年份', key: 'year', width: 10 },
      { header: '员工数', key: 'empCount', width: 10 },
      { header: '完成体检数', key: 'completed', width: 12 },
      { header: '完成率(%)', key: 'completionRate', width: 12 },
      { header: '报告数', key: 'reports', width: 10 },
      { header: '异常报告数', key: 'abnormal', width: 12 },
      { header: '异常率(%)', key: 'abnormalRate', width: 12 },
      { header: '预算使用率(%)', key: 'budgetRate', width: 14 },
      { header: '预警数', key: 'warning', width: 10 },
      { header: '预算总额(万)', key: 'totalBudget', width: 12 },
      { header: '已使用(万)', key: 'usedBudget', width: 12 },
    ];

    ws.getRow(1).font = { bold: true };
    ws.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

    const trendData = [];
    trend.trends.forEach((t) => {
      const rowData = {
        year: t.year,
        empCount: t.employeeCount,
        completed: t.completedCount,
        completionRate: t.completionRate,
        reports: t.reportCount,
        abnormal: t.abnormalReportCount,
        abnormalRate: t.abnormalRate,
        budgetRate: t.budgetUsageRate,
        warning: t.warningCount,
        totalBudget: roundTo((t.totalBudget || 0) / 10000, 2),
        usedBudget: roundTo((t.usedBudget || 0) / 10000, 2),
      };
      ws.addRow(rowData);
      trendData.push(rowData);
    });

    const dataStartRow = 2;
    const dataEndRow = dataStartRow + trend.trends.length - 1;

    const labels = trendData.map((t) => String(t.year));
    const completionRates = trendData.map((t) => t.completionRate);
    const abnormalRates = trendData.map((t) => t.abnormalRate);
    const budgetRates = trendData.map((t) => t.budgetRate);
    const warningCounts = trendData.map((t) => t.warning);

    const chartConfigs = [
      {
        title: '体检完成率趋势(%)',
        type: 'line',
        yMax: 100,
        yLabel: '完成率(%)',
        data: {
          labels,
          datasets: [{
            label: '体检完成率(%)',
            data: completionRates,
            borderColor: '#4CAF50',
            backgroundColor: 'rgba(76, 175, 80, 0.1)',
            borderWidth: 2,
            fill: true,
            tension: 0.3,
            pointRadius: 6,
            pointBackgroundColor: '#4CAF50',
          }],
        },
        position: { col: 12, row: 1 },
      },
      {
        title: '异常报告率趋势(%)',
        type: 'line',
        yMax: 100,
        yLabel: '异常率(%)',
        data: {
          labels,
          datasets: [{
            label: '异常报告率(%)',
            data: abnormalRates,
            borderColor: '#FF9800',
            backgroundColor: 'rgba(255, 152, 0, 0.1)',
            borderWidth: 2,
            fill: true,
            tension: 0.3,
            pointRadius: 6,
            pointBackgroundColor: '#FF9800',
          }],
        },
        position: { col: 12, row: 22 },
      },
      {
        title: '预算使用率趋势(%)',
        type: 'bar',
        yMax: 100,
        yLabel: '预算使用率(%)',
        data: {
          labels,
          datasets: [{
            label: '预算使用率(%)',
            data: budgetRates,
            backgroundColor: 'rgba(33, 150, 243, 0.7)',
            borderColor: '#2196F3',
            borderWidth: 1,
          }],
        },
        position: { col: 12, row: 43 },
      },
      {
        title: '三大指标综合趋势对比(%)',
        type: 'line',
        yMax: 100,
        yLabel: '比率(%)',
        data: {
          labels,
          datasets: [
            {
              label: '体检完成率(%)',
              data: completionRates,
              borderColor: '#4CAF50',
              backgroundColor: 'rgba(76, 175, 80, 0.1)',
              borderWidth: 2,
              tension: 0.3,
              pointRadius: 4,
              pointBackgroundColor: '#4CAF50',
            },
            {
              label: '异常报告率(%)',
              data: abnormalRates,
              borderColor: '#FF9800',
              backgroundColor: 'rgba(255, 152, 0, 0.1)',
              borderWidth: 2,
              tension: 0.3,
              pointRadius: 4,
              pointBackgroundColor: '#FF9800',
            },
            {
              label: '预算使用率(%)',
              data: budgetRates,
              borderColor: '#2196F3',
              backgroundColor: 'rgba(33, 150, 243, 0.1)',
              borderWidth: 2,
              tension: 0.3,
              pointRadius: 4,
              pointBackgroundColor: '#2196F3',
            },
          ],
        },
        position: { col: 1, row: dataEndRow + 3 },
        wide: true,
      },
      {
        title: '预警工单数趋势',
        type: 'bar',
        yMax: Math.max(10, ...warningCounts) + 5,
        yLabel: '工单数',
        data: {
          labels,
          datasets: [{
            label: '预警工单数',
            data: warningCounts,
            backgroundColor: 'rgba(233, 30, 99, 0.7)',
            borderColor: '#E91E63',
            borderWidth: 1,
          }],
        },
        position: { col: 1, row: dataEndRow + 28 },
        wide: true,
      },
    ];

    logger.info(`开始生成 ${chartConfigs.length} 个Excel图表...`);

    for (let i = 0; i < chartConfigs.length; i++) {
      const cfg = chartConfigs[i];
      try {
        const imgBuffer = await this._generateChartImage(cfg);
        if (imgBuffer) {
          const imgId = workbook.addImage({
            buffer: imgBuffer,
            extension: 'png',
          });

          const width = cfg.wide ? 780 : 380;
          const height = cfg.wide ? 320 : 260;

          ws.addImage(imgId, {
            tl: { col: cfg.position.col - 1, row: cfg.position.row - 1 },
            ext: { width, height },
          });

          logger.info(`✓ 图表 ${i + 1} "${cfg.title}" 已生成并嵌入`);
        } else {
          logger.warn(`⚠️  图表 ${i + 1} "${cfg.title}" 生成失败，跳过`);
        }
      } catch (e) {
        logger.error(`生成图表 ${i + 1} 出错:`, e.message);
      }
    }

    logger.info('Excel趋势图生成完成');
  }

  async getReportHistory() {
    const reportDir = path.resolve(config.storage.reportPath);
    if (!fs.existsSync(reportDir)) {
      return [];
    }

    const files = fs.readdirSync(reportDir).filter((f) =>
      f.endsWith('.pdf') || f.endsWith('.xlsx')
    );

    return files
      .map((f) => {
        const fullPath = path.join(reportDir, f);
        const stat = fs.statSync(fullPath);
        return {
          fileName: f,
          url: `/reports/${f}`,
          size: stat.size,
          createdAt: stat.birthtime,
          type: f.endsWith('.pdf') ? 'pdf' : 'excel',
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }
}

module.exports = new StatisticsReportService();
module.exports.StatisticsReportService = StatisticsReportService;
