const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/database');

class ApprovalRecord extends Model {}

ApprovalRecord.init(
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
      comment: '审批记录ID',
    },
    appointmentId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      comment: '预约ID',
      field: 'appointment_id',
    },
    orderNo: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: '预约单号（冗余）',
      field: 'order_no',
    },
    approverId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      comment: '审批人ID',
      field: 'approver_id',
    },
    approverName: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: '审批人姓名（冗余）',
      field: 'approver_name',
    },
    approvalLevel: {
      type: DataTypes.TINYINT.UNSIGNED,
      allowNull: false,
      defaultValue: 1,
      comment: '审批层级',
      field: 'approval_level',
    },
    status: {
      type: DataTypes.ENUM('pending', 'approved', 'rejected', 'transferred'),
      allowNull: false,
      defaultValue: 'pending',
      comment: '审批结果',
    },
    reason: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: '审批意见/拒绝原因',
    },
    approvalTime: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: '审批时间',
      field: 'approval_time',
    },
    nextApproverId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: '转审给下一个审批人ID',
      field: 'next_approver_id',
    },
  },
  {
    sequelize,
    modelName: 'ApprovalRecord',
    tableName: 'biz_approval_record',
    comment: '审批记录表',
    indexes: [
      { fields: ['appointment_id'] },
      { fields: ['approver_id'] },
      { fields: ['status'] },
    ],
  }
);

module.exports = ApprovalRecord;
