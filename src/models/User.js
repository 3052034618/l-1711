const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/database');

class User extends Model {}

User.init(
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
      comment: '用户ID',
    },
    username: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
      comment: '用户名',
    },
    password: {
      type: DataTypes.STRING(128),
      allowNull: false,
      comment: '密码',
    },
    employeeId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      unique: true,
      comment: '关联员工ID',
      field: 'employee_id',
    },
    realName: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: '真实姓名',
      field: 'real_name',
    },
    role: {
      type: DataTypes.ENUM('admin', 'hr', 'medical', 'manager', 'employee'),
      allowNull: false,
      defaultValue: 'employee',
      comment: '角色 管理员/HR/医务/主管/员工',
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
    wecomUserId: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: '企业微信用户ID',
      field: 'wecom_user_id',
    },
    lastLoginAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: '最后登录时间',
      field: 'last_login_at',
    },
    lastLoginIp: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: '最后登录IP',
      field: 'last_login_ip',
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
    modelName: 'User',
    tableName: 'sys_user',
    comment: '系统用户表',
  }
);

module.exports = User;
