const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/database');

class Department extends Model {}

Department.init(
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
      comment: '部门ID',
    },
    parentId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: 0,
      comment: '上级部门ID',
      field: 'parent_id',
    },
    deptCode: {
      type: DataTypes.STRING(32),
      allowNull: false,
      unique: true,
      comment: '部门编码',
      field: 'dept_code',
    },
    deptName: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: '部门名称',
      field: 'dept_name',
    },
    managerId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: '部门主管ID',
      field: 'manager_id',
    },
    level: {
      type: DataTypes.TINYINT.UNSIGNED,
      allowNull: false,
      defaultValue: 1,
      comment: '层级',
    },
    sort: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
      comment: '排序',
    },
    status: {
      type: DataTypes.TINYINT.UNSIGNED,
      allowNull: false,
      defaultValue: 1,
      comment: '状态 0-禁用 1-启用',
    },
  },
  {
    sequelize,
    modelName: 'Department',
    tableName: 'sys_department',
    comment: '部门表',
  }
);

module.exports = Department;
