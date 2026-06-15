const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/database');

class CheckupReport extends Model {}

CheckupReport.init(
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
      comment: '报告ID',
    },
    reportNo: {
      type: DataTypes.STRING(32),
      allowNull: false,
      unique: true,
      comment: '报告编号',
      field: 'report_no',
    },
    checkupOrderId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: '体检单ID',
      field: 'checkup_order_id',
    },
    orderNo: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: '体检单号（冗余）',
      field: 'order_no',
    },
    employeeId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      comment: '员工ID',
      field: 'employee_id',
    },
    deptId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      comment: '部门ID',
      field: 'dept_id',
    },
    hospitalId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: '医院ID',
      field: 'hospital_id',
    },
    hospitalName: {
      type: DataTypes.STRING(200),
      allowNull: true,
      comment: '医院名称（冗余）',
      field: 'hospital_name',
    },
    checkupDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: '体检日期',
      field: 'checkup_date',
    },
    reportDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: '出报告日期',
      field: 'report_date',
    },
    year: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      comment: '体检年份',
    },
    half: {
      type: DataTypes.ENUM('1', '2'),
      allowNull: false,
      defaultValue: '1',
      comment: '半年',
    },
    source: {
      type: DataTypes.ENUM('hospital', 'manual_upload', 'ocr'),
      allowNull: false,
      defaultValue: 'hospital',
      comment: '报告来源',
    },
    fileUrl: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: '原始文件URL',
      field: 'file_url',
    },
    fileType: {
      type: DataTypes.ENUM('pdf', 'image', 'excel', 'json'),
      allowNull: true,
      comment: '文件类型',
      field: 'file_type',
    },
    totalScore: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      comment: '健康总分',
      field: 'total_score',
    },
    summary: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: '总结/结论',
    },
    suggestions: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: '医生建议',
    },
    abnormalCount: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
      comment: '异常指标数量',
      field: 'abnormal_count',
    },
    highRiskCount: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
      comment: '高危指标数量',
      field: 'high_risk_count',
    },
    items: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: '所有指标项（完整JSON）',
    },
    fetchStatus: {
      type: DataTypes.ENUM('pending', 'fetching', 'success', 'failed', 'no_data'),
      allowNull: false,
      defaultValue: 'success',
      comment: '抓取状态',
      field: 'fetch_status',
    },
    ocrStatus: {
      type: DataTypes.ENUM('not_needed', 'pending', 'processing', 'success', 'failed'),
      allowNull: false,
      defaultValue: 'not_needed',
      comment: 'OCR识别状态',
      field: 'ocr_status',
    },
    uploaderId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: '上传人ID（手动上传时）',
      field: 'uploader_id',
    },
    status: {
      type: DataTypes.TINYINT.UNSIGNED,
      allowNull: false,
      defaultValue: 1,
      comment: '状态 0-无效 1-有效',
    },
  },
  {
    sequelize,
    modelName: 'CheckupReport',
    tableName: 'biz_checkup_report',
    comment: '体检报告表',
    indexes: [
      { fields: ['employee_id'] },
      { fields: ['dept_id'] },
      { fields: ['year', 'half'] },
      { fields: ['checkup_date'] },
      { fields: ['status'] },
    ],
  }
);

module.exports = CheckupReport;
