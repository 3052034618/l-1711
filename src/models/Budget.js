const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/database');

class Budget extends Model {}

Budget.init(
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
      comment: '预算ID',
    },
    deptId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      comment: '部门ID',
      field: 'dept_id',
    },
    year: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      comment: '年份',
    },
    half: {
      type: DataTypes.ENUM('1', '2', 'all'),
      allowNull: false,
      defaultValue: 'all',
      comment: '半年 1-上半年 2-下半年 all-全年',
    },
    totalAmount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
      comment: '预算总额',
      field: 'total_amount',
    },
    usedAmount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
      comment: '已使用金额',
      field: 'used_amount',
    },
    approvedAmount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
      comment: '审批中金额',
      field: 'approved_amount',
    },
    overBudgetApprovedAmount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
      comment: '超预算审批中金额',
      field: 'over_budget_approved_amount',
    },
    overBudgetUsedAmount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
      comment: '超预算已使用金额（审批通过的超预算占用）',
      field: 'over_budget_used_amount',
    },
    perPersonLimit: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      comment: '人均限额',
      field: 'per_person_limit',
    },
    approverIds: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: '多级审批人ID数组',
      field: 'approver_ids',
    },
    remark: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: '备注',
    },
  },
  {
    sequelize,
    modelName: 'Budget',
    tableName: 'biz_budget',
    comment: '部门预算表',
    uniqueKeys: {
      unique_dept_year: {
        fields: ['dept_id', 'year', 'half'],
      },
    },
  }
);

Budget.prototype.availableAmount = function () {
  const total = parseFloat(this.totalAmount) || 0;
  const used = parseFloat(this.usedAmount) || 0;
  const approved = parseFloat(this.approvedAmount) || 0;
  const overBudgetApproved = parseFloat(this.overBudgetApprovedAmount) || 0;
  const overBudgetUsed = parseFloat(this.overBudgetUsedAmount) || 0;
  return {
    normalAvailable: total - used - approved,
    overBudgetPending: overBudgetApproved + overBudgetUsed,
    totalUsed: used + overBudgetUsed,
    totalApproved: approved + overBudgetApproved,
  };
};

Budget.prototype.getNormalAvailable = function () {
  const total = parseFloat(this.totalAmount) || 0;
  const used = parseFloat(this.usedAmount) || 0;
  const approved = parseFloat(this.approvedAmount) || 0;
  return total - used - approved;
};

module.exports = Budget;
