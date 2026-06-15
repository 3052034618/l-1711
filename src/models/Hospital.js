const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/database');

class Hospital extends Model {}

Hospital.init(
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
      comment: '医院ID',
    },
    hospitalCode: {
      type: DataTypes.STRING(32),
      allowNull: false,
      unique: true,
      comment: '医院编码',
      field: 'hospital_code',
    },
    hospitalName: {
      type: DataTypes.STRING(200),
      allowNull: false,
      comment: '医院名称',
      field: 'hospital_name',
    },
    hospitalLevel: {
      type: DataTypes.ENUM('level_3_a', 'level_3_b', 'level_2', 'level_1', 'other'),
      allowNull: true,
      comment: '医院等级',
      field: 'hospital_level',
    },
    contactPerson: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: '联系人',
      field: 'contact_person',
    },
    contactPhone: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: '联系电话',
      field: 'contact_phone',
    },
    address: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: '地址',
    },
    region: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: '所在区域',
    },
    apiEndpoint: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: 'API接口地址',
      field: 'api_endpoint',
    },
    apiKey: {
      type: DataTypes.STRING(200),
      allowNull: true,
      comment: 'API密钥',
      field: 'api_key',
    },
    apiSecret: {
      type: DataTypes.STRING(200),
      allowNull: true,
      comment: 'API密钥Secret',
      field: 'api_secret',
    },
    pushEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      comment: '是否启用推送',
      field: 'push_enabled',
    },
    fetchEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      comment: '是否启用报告抓取',
      field: 'fetch_enabled',
    },
    businessHours: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: '营业时间配置',
      field: 'business_hours',
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
      comment: '状态 0-停用 1-启用',
    },
  },
  {
    sequelize,
    modelName: 'Hospital',
    tableName: 'sys_hospital',
    comment: '合作医院表',
  }
);

module.exports = Hospital;
