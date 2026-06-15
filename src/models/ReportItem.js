const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/database');

class ReportItem extends Model {}

ReportItem.init(
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
      comment: '指标记录ID',
    },
    reportId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      comment: '报告ID',
      field: 'report_id',
    },
    employeeId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      comment: '员工ID',
      field: 'employee_id',
    },
    year: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      comment: '体检年份',
    },
    checkupDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: '体检日期',
      field: 'checkup_date',
    },
    itemCode: {
      type: DataTypes.STRING(64),
      allowNull: false,
      comment: '指标编码',
      field: 'item_code',
    },
    itemName: {
      type: DataTypes.STRING(200),
      allowNull: false,
      comment: '指标名称',
      field: 'item_name',
    },
    itemCategory: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: '指标分类（血常规/肝功能等）',
      field: 'item_category',
    },
    resultValue: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: '检测结果值',
      field: 'result_value',
    },
    numericValue: {
      type: DataTypes.DECIMAL(15, 4),
      allowNull: true,
      comment: '数值化结果',
      field: 'numeric_value',
    },
    unit: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: '单位',
    },
    refRangeMin: {
      type: DataTypes.DECIMAL(15, 4),
      allowNull: true,
      comment: '参考范围最小值',
      field: 'ref_range_min',
    },
    refRangeMax: {
      type: DataTypes.DECIMAL(15, 4),
      allowNull: true,
      comment: '参考范围最大值',
      field: 'ref_range_max',
    },
    refRange: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: '参考范围文本',
      field: 'ref_range',
    },
    abnormalLevel: {
      type: DataTypes.ENUM('normal', 'mild', 'moderate', 'severe', 'critical'),
      allowNull: false,
      defaultValue: 'normal',
      comment: '异常级别',
      field: 'abnormal_level',
    },
    isAbnormal: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: '是否异常',
      field: 'is_abnormal',
    },
    isHighRisk: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: '是否高危',
      field: 'is_high_risk',
    },
    trend: {
      type: DataTypes.ENUM('improved', 'stable', 'deteriorated', 'new'),
      allowNull: true,
      comment: '与上次相比趋势',
    },
    diffPercent: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      comment: '与上次相比变化百分比',
      field: 'diff_percent',
    },
    lastValue: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: '上次检查结果',
      field: 'last_value',
    },
    lastYear: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: '上次检查年份',
      field: 'last_year',
    },
    consecutiveAbnormalYears: {
      type: DataTypes.TINYINT.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
      comment: '连续异常年数',
      field: 'consecutive_abnormal_years',
    },
    doctorAdvice: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: '医生建议',
      field: 'doctor_advice',
    },
    remark: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: '备注',
    },
  },
  {
    sequelize,
    modelName: 'ReportItem',
    tableName: 'biz_report_item',
    comment: '报告指标明细表',
    indexes: [
      { fields: ['report_id'] },
      { fields: ['employee_id'] },
      { fields: ['item_code'] },
      { fields: ['year'] },
      { fields: ['is_abnormal'] },
      { fields: ['employee_id', 'item_code', 'year'] },
    ],
  }
);

module.exports = ReportItem;
