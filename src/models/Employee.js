const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/database');

class Employee extends Model {}

Employee.init(
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
      comment: '员工ID',
    },
    empNo: {
      type: DataTypes.STRING(32),
      allowNull: false,
      unique: true,
      comment: '工号',
      field: 'emp_no',
    },
    name: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: '姓名',
    },
    gender: {
      type: DataTypes.ENUM('male', 'female', 'unknown'),
      allowNull: false,
      defaultValue: 'unknown',
      comment: '性别',
    },
    birthday: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: '出生日期',
    },
    idCard: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: '身份证号',
      field: 'id_card',
    },
    phone: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: '手机号',
    },
    email: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: '邮箱',
    },
    deptId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      comment: '部门ID',
      field: 'dept_id',
    },
    position: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: '岗位',
    },
    positionLevel: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: '岗位级别',
      field: 'position_level',
    },
    entryDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: '入职日期',
      field: 'entry_date',
    },
    workType: {
      type: DataTypes.ENUM('office', 'factory', 'field', 'high_risk', 'other'),
      allowNull: false,
      defaultValue: 'office',
      comment: '工作类型 办公室/工厂/外勤/高危/其他',
      field: 'work_type',
    },
    bloodType: {
      type: DataTypes.ENUM('A', 'B', 'AB', 'O', 'unknown'),
      allowNull: false,
      defaultValue: 'unknown',
      comment: '血型',
      field: 'blood_type',
    },
    allergyHistory: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: '过敏史',
      field: 'allergy_history',
    },
    chronicDisease: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: '慢性病',
      field: 'chronic_disease',
    },
    status: {
      type: DataTypes.TINYINT.UNSIGNED,
      allowNull: false,
      defaultValue: 1,
      comment: '状态 0-离职 1-在职',
    },
  },
  {
    sequelize,
    modelName: 'Employee',
    tableName: 'sys_employee',
    comment: '员工表',
    indexes: [
      { fields: ['dept_id'] },
      { fields: ['emp_no'] },
      { fields: ['status'] },
    ],
  }
);

module.exports = Employee;
