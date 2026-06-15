const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/database');

class WarningTicket extends Model {}

WarningTicket.init(
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
      comment: '预警ID',
    },
    ticketNo: {
      type: DataTypes.STRING(32),
      allowNull: false,
      unique: true,
      comment: '工单号',
      field: 'ticket_no',
    },
    employeeId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      comment: '员工ID',
      field: 'employee_id',
    },
    employeeName: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: '员工姓名（冗余）',
      field: 'employee_name',
    },
    deptId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      comment: '部门ID',
      field: 'dept_id',
    },
    deptManagerId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: '部门主管ID',
      field: 'dept_manager_id',
    },
    reportId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: '关联报告ID',
      field: 'report_id',
    },
    reportItemIds: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: '关联异常指标ID数组',
      field: 'report_item_ids',
    },
    warningType: {
      type: DataTypes.ENUM(
        'consecutive_abnormal',
        'high_risk_value',
        'multiple_abnormal',
        'health_score_low',
        'custom'
      ),
      allowNull: false,
      comment: '预警类型',
      field: 'warning_type',
    },
    warningLevel: {
      type: DataTypes.ENUM('low', 'medium', 'high', 'critical'),
      allowNull: false,
      defaultValue: 'medium',
      comment: '预警级别',
      field: 'warning_level',
    },
    title: {
      type: DataTypes.STRING(200),
      allowNull: false,
      comment: '预警标题',
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: '预警详情描述',
    },
    abnormalItems: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: '异常指标详情 [{itemCode, itemName, value, level}]',
      field: 'abnormal_items',
    },
    suggestions: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: '处理建议',
    },
    status: {
      type: DataTypes.ENUM('pending', 'read', 'processing', 'resolved', 'closed', 'ignored'),
      allowNull: false,
      defaultValue: 'pending',
      comment: '状态',
    },
    readStatus: {
      type: DataTypes.ENUM('unread', 'employee_read', 'manager_read', 'all_read'),
      allowNull: false,
      defaultValue: 'unread',
      comment: '阅读状态',
      field: 'read_status',
    },
    firstReadTime: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: '首次阅读时间',
      field: 'first_read_time',
    },
    lastPushTime: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: '最后推送时间',
      field: 'last_push_time',
    },
    pushCount: {
      type: DataTypes.TINYINT.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
      comment: '推送次数',
      field: 'push_count',
    },
    pushStatus: {
      type: DataTypes.ENUM('pending', 'success', 'failed'),
      allowNull: false,
      defaultValue: 'pending',
      comment: '推送状态',
      field: 'push_status',
    },
    handlerId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: '处理人ID',
      field: 'handler_id',
    },
    handleTime: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: '处理时间',
      field: 'handle_time',
    },
    handleRemark: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: '处理备注',
      field: 'handle_remark',
    },
    assigneeId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: '指派人ID',
      field: 'assignee_id',
    },
    dueTime: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: '处理期限',
      field: 'due_time',
    },
    sourceType: {
      type: DataTypes.ENUM('auto', 'manual'),
      allowNull: false,
      defaultValue: 'auto',
      comment: '来源类型',
      field: 'source_type',
    },
    createdBy: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: '创建人ID（手动创建时）',
      field: 'created_by',
    },
  },
  {
    sequelize,
    modelName: 'WarningTicket',
    tableName: 'biz_warning_ticket',
    comment: '预警工单表',
    indexes: [
      { fields: ['employee_id'] },
      { fields: ['dept_id'] },
      { fields: ['status'] },
      { fields: ['warning_level'] },
      { fields: ['read_status'] },
      { fields: ['created_at'] },
    ],
  }
);

module.exports = WarningTicket;
