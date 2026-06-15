const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/database');

class AuditLog extends Model {}

AuditLog.init(
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
      comment: '日志ID',
    },
    traceId: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: '追踪ID',
      field: 'trace_id',
    },
    userId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: '操作用户ID',
      field: 'user_id',
    },
    username: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: '用户名（冗余）',
    },
    employeeId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: '关联员工ID',
      field: 'employee_id',
    },
    module: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: '模块名称',
    },
    action: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: '操作类型',
    },
    resource: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: '操作资源',
    },
    resourceId: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: '资源ID',
      field: 'resource_id',
    },
    method: {
      type: DataTypes.STRING(16),
      allowNull: true,
      comment: 'HTTP方法',
    },
    url: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: '请求URL',
    },
    ip: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: '操作IP',
    },
    userAgent: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: '客户端信息',
      field: 'user_agent',
    },
    requestParams: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: '请求参数',
      field: 'request_params',
    },
    oldValue: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: '修改前数据',
      field: 'old_value',
    },
    newValue: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: '修改后数据',
      field: 'new_value',
    },
    result: {
      type: DataTypes.ENUM('success', 'fail'),
      allowNull: false,
      defaultValue: 'success',
      comment: '操作结果',
    },
    errorMsg: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: '错误信息',
      field: 'error_msg',
    },
    duration: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: '耗时（毫秒）',
    },
    detail: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: '其他详情',
    },
  },
  {
    sequelize,
    modelName: 'AuditLog',
    tableName: 'sys_audit_log',
    comment: '操作日志表',
    timestamps: true,
    updatedAt: false,
    indexes: [
      { fields: ['user_id'] },
      { fields: ['module', 'action'] },
      { fields: ['created_at'] },
      { fields: ['trace_id'] },
    ],
  }
);

module.exports = AuditLog;
