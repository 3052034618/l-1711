const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/database');

class CheckupPackage extends Model {}

CheckupPackage.init(
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
      comment: '套餐ID',
    },
    pkgCode: {
      type: DataTypes.STRING(32),
      allowNull: false,
      unique: true,
      comment: '套餐编码',
      field: 'pkg_code',
    },
    pkgName: {
      type: DataTypes.STRING(200),
      allowNull: false,
      comment: '套餐名称',
      field: 'pkg_name',
    },
    pkgType: {
      type: DataTypes.ENUM('basic', 'standard', 'premium', 'female', 'male', 'high_risk', 'custom'),
      allowNull: false,
      defaultValue: 'standard',
      comment: '套餐类型',
      field: 'pkg_type',
    },
    applyGender: {
      type: DataTypes.ENUM('male', 'female', 'all'),
      allowNull: false,
      defaultValue: 'all',
      comment: '适用性别',
      field: 'apply_gender',
    },
    applyAgeMin: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: 18,
      comment: '适用最小年龄',
      field: 'apply_age_min',
    },
    applyAgeMax: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: 70,
      comment: '适用最大年龄',
      field: 'apply_age_max',
    },
    applyWorkTypes: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: '适用工作类型数组',
      field: 'apply_work_types',
    },
    applyPositions: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: '适用岗位数组',
      field: 'apply_positions',
    },
    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
      comment: '价格',
    },
    originalPrice: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      comment: '原价',
      field: 'original_price',
    },
    hospitalId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: '关联医院ID',
      field: 'hospital_id',
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: '套餐描述',
    },
    notice: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: '体检注意事项',
    },
    items: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: '套餐项目列表 [{itemCode, itemName, price}]',
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
      comment: '状态 0-下架 1-上架',
    },
  },
  {
    sequelize,
    modelName: 'CheckupPackage',
    tableName: 'biz_checkup_package',
    comment: '体检套餐表',
  }
);

module.exports = CheckupPackage;
