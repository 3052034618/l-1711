const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/database');

class Notification extends Model {}

Notification.init(
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
      comment: '通知ID',
    },
    type: {
      type: DataTypes.ENUM(
        'appointment_approval',
        'approval_result',
        'checkup_reminder',
        'report_ready',
        'warning',
        'system',
        'wecom_push',
        'dingtalk_push',
        'email_push',
        'sms_push'
      ),
      allowNull: false,
      comment: '通知类型',
    },
    channel: {
      type: DataTypes.ENUM('system', 'wecom', 'dingtalk', 'email', 'sms'),
      allowNull: false,
      defaultValue: 'system',
      comment: '推送渠道',
    },
    receiverId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: '接收人ID',
      field: 'receiver_id',
    },
    receiverType: {
      type: DataTypes.ENUM('employee', 'manager', 'user', 'group', 'all'),
      allowNull: false,
      defaultValue: 'employee',
      comment: '接收人类型',
      field: 'receiver_type',
    },
    deptId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: '接收部门ID（群通知时）',
      field: 'dept_id',
    },
    title: {
      type: DataTypes.STRING(200),
      allowNull: false,
      comment: '通知标题',
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: '通知内容',
    },
    templateCode: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: '模板编码',
      field: 'template_code',
    },
    templateParams: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: '模板参数',
      field: 'template_params',
    },
    relatedType: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: '关联业务类型',
      field: 'related_type',
    },
    relatedId: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: '关联业务ID',
      field: 'related_id',
    },
    payload: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: '附加数据',
    },
    status: {
      type: DataTypes.ENUM('pending', 'sending', 'success', 'failed'),
      allowNull: false,
      defaultValue: 'pending',
      comment: '发送状态',
    },
    readStatus: {
      type: DataTypes.ENUM('unread', 'read'),
      allowNull: false,
      defaultValue: 'unread',
      comment: '阅读状态（系统内通知）',
      field: 'read_status',
    },
    readTime: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: '阅读时间',
      field: 'read_time',
    },
    sendTime: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: '发送时间',
      field: 'send_time',
    },
    retryTimes: {
      type: DataTypes.TINYINT.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
      comment: '重试次数',
      field: 'retry_times',
    },
    errorMsg: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: '错误信息',
      field: 'error_msg',
    },
    priority: {
      type: DataTypes.TINYINT.UNSIGNED,
      allowNull: false,
      defaultValue: 5,
      comment: '优先级 1-10',
    },
  },
  {
    sequelize,
    modelName: 'Notification',
    tableName: 'sys_notification',
    comment: '消息通知表',
    indexes: [
      { fields: ['receiver_id'] },
      { fields: ['type'] },
      { fields: ['status'] },
      { fields: ['read_status'] },
      { fields: ['created_at'] },
    ],
  }
);

module.exports = Notification;
