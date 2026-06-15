const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/database');

class CheckupOrder extends Model {}

CheckupOrder.init(
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
      comment: '体检单ID',
    },
    orderNo: {
      type: DataTypes.STRING(32),
      allowNull: false,
      unique: true,
      comment: '体检单号',
      field: 'order_no',
    },
    appointmentId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      comment: '预约ID',
      field: 'appointment_id',
    },
    appointmentOrderNo: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: '预约单号（冗余）',
      field: 'appointment_order_no',
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
    gender: {
      type: DataTypes.ENUM('male', 'female', 'unknown'),
      allowNull: false,
      comment: '性别（冗余）',
    },
    age: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: '年龄（冗余）',
    },
    deptId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      comment: '部门ID',
      field: 'dept_id',
    },
    hospitalId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      comment: '医院ID',
      field: 'hospital_id',
    },
    hospitalName: {
      type: DataTypes.STRING(200),
      allowNull: false,
      comment: '医院名称（冗余）',
      field: 'hospital_name',
    },
    checkupDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: '体检日期',
      field: 'checkup_date',
    },
    checkupTime: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: '体检时间段',
      field: 'checkup_time',
    },
    qrCode: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
      comment: '签到二维码内容',
      field: 'qr_code',
    },
    packageName: {
      type: DataTypes.STRING(200),
      allowNull: false,
      comment: '套餐名称',
      field: 'package_name',
    },
    totalAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
      comment: '总金额',
      field: 'total_amount',
    },
    checkupItems: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: '体检项目清单',
      field: 'checkup_items',
    },
    hospitalOrderNo: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: '医院侧订单号',
      field: 'hospital_order_no',
    },
    pushStatus: {
      type: DataTypes.ENUM('pending', 'pushing', 'success', 'failed'),
      allowNull: false,
      defaultValue: 'pending',
      comment: '推送医院状态',
      field: 'push_status',
    },
    pushTime: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: '推送时间',
      field: 'push_time',
    },
    pushRetryTimes: {
      type: DataTypes.TINYINT.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
      comment: '推送重试次数',
      field: 'push_retry_times',
    },
    pushError: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: '推送错误信息',
      field: 'push_error',
    },
    checkinTime: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: '到场签到时间',
      field: 'checkin_time',
    },
    status: {
      type: DataTypes.ENUM(
        'generated',
        'pushed',
        'scheduled',
        'checkin',
        'checking',
        'completed',
        'no_show',
        'cancelled'
      ),
      allowNull: false,
      defaultValue: 'generated',
      comment: '体检单状态',
    },
    generatedTime: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: '生成时间',
      field: 'generated_time',
    },
    completedTime: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: '体检完成时间',
      field: 'completed_time',
    },
  },
  {
    sequelize,
    modelName: 'CheckupOrder',
    tableName: 'biz_checkup_order',
    comment: '体检单表',
    indexes: [
      { fields: ['employee_id'] },
      { fields: ['dept_id'] },
      { fields: ['hospital_id'] },
      { fields: ['status'] },
      { fields: ['qr_code'] },
      { fields: ['checkup_date'] },
    ],
  }
);

module.exports = CheckupOrder;
