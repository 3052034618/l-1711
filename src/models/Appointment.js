const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/database');

class Appointment extends Model {}

Appointment.init(
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
      comment: '预约ID',
    },
    orderNo: {
      type: DataTypes.STRING(32),
      allowNull: false,
      unique: true,
      comment: '预约单号',
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
    packageId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      comment: '套餐ID',
      field: 'package_id',
    },
    packageName: {
      type: DataTypes.STRING(200),
      allowNull: false,
      comment: '套餐名称（冗余）',
      field: 'package_name',
    },
    packagePrice: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
      comment: '套餐价格（冗余）',
      field: 'package_price',
    },
    extraItems: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: '加项项目 [{itemCode, itemName, price}]',
      field: 'extra_items',
    },
    extraAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
      comment: '加项金额',
      field: 'extra_amount',
    },
    totalAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
      comment: '总金额',
      field: 'total_amount',
    },
    hospitalId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: '医院ID',
      field: 'hospital_id',
    },
    preferredDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: '期望体检日期',
      field: 'preferred_date',
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
      comment: '半年 1-上半年 2-下半年',
    },
    checkupTimes: {
      type: DataTypes.TINYINT.UNSIGNED,
      allowNull: false,
      defaultValue: 1,
      comment: '本年第几次体检',
      field: 'checkup_times',
    },
    budgetSnapshot: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: '预算快照',
      field: 'budget_snapshot',
    },
    status: {
      type: DataTypes.ENUM(
        'draft',
        'pending_approval',
        'approved',
        'rejected',
        'cancelled',
        'confirmed',
        'in_progress',
        'completed'
      ),
      allowNull: false,
      defaultValue: 'draft',
      comment: '状态',
    },
    approvalStatus: {
      type: DataTypes.ENUM('none', 'pending', 'approved', 'rejected'),
      allowNull: false,
      defaultValue: 'none',
      comment: '审批状态',
      field: 'approval_status',
    },
    currentApproverId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: '当前审批人ID',
      field: 'current_approver_id',
    },
    approvalLevel: {
      type: DataTypes.TINYINT.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
      comment: '当前审批层级',
      field: 'approval_level',
    },
    rejectReason: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: '拒绝原因',
      field: 'reject_reason',
    },
    confirmTime: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: '员工确认时间',
      field: 'confirm_time',
    },
    applicantRemark: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: '申请备注',
      field: 'applicant_remark',
    },
    createdBy: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: '创建人',
      field: 'created_by',
    },
  },
  {
    sequelize,
    modelName: 'Appointment',
    tableName: 'biz_appointment',
    comment: '体检预约表',
    indexes: [
      { fields: ['employee_id'] },
      { fields: ['dept_id'] },
      { fields: ['status'] },
      { fields: ['year', 'half'] },
      { fields: ['order_no'] },
    ],
  }
);

module.exports = Appointment;
