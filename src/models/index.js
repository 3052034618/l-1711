const Department = require('./Department');
const Employee = require('./Employee');
const User = require('./User');
const Budget = require('./Budget');
const CheckupPackage = require('./CheckupPackage');
const Appointment = require('./Appointment');
const ApprovalRecord = require('./ApprovalRecord');
const CheckupOrder = require('./CheckupOrder');
const Hospital = require('./Hospital');
const CheckupReport = require('./CheckupReport');
const ReportItem = require('./ReportItem');
const WarningTicket = require('./WarningTicket');
const AuditLog = require('./AuditLog');
const Notification = require('./Notification');

Department.belongsTo(Department, { as: 'parent', foreignKey: 'parentId' });
Department.hasMany(Department, { as: 'children', foreignKey: 'parentId' });

Department.hasMany(Employee, { foreignKey: 'deptId' });
Employee.belongsTo(Department, { as: 'department', foreignKey: 'deptId' });

Department.hasMany(Budget, { foreignKey: 'deptId' });
Budget.belongsTo(Department, { as: 'department', foreignKey: 'deptId' });

Employee.hasOne(User, { foreignKey: 'employeeId' });
User.belongsTo(Employee, { as: 'employee', foreignKey: 'employeeId' });

Employee.hasMany(Appointment, { foreignKey: 'employeeId' });
Appointment.belongsTo(Employee, { as: 'employee', foreignKey: 'employeeId' });
Appointment.belongsTo(Department, { as: 'department', foreignKey: 'deptId' });
Appointment.belongsTo(CheckupPackage, { as: 'package', foreignKey: 'packageId' });
Appointment.hasMany(ApprovalRecord, { foreignKey: 'appointmentId' });

ApprovalRecord.belongsTo(Appointment, { as: 'appointment', foreignKey: 'appointmentId' });

Appointment.hasOne(CheckupOrder, { foreignKey: 'appointmentId' });
CheckupOrder.belongsTo(Appointment, { as: 'appointment', foreignKey: 'appointmentId' });
CheckupOrder.belongsTo(Employee, { as: 'employee', foreignKey: 'employeeId' });
CheckupOrder.belongsTo(Department, { as: 'department', foreignKey: 'deptId' });
CheckupOrder.belongsTo(Hospital, { as: 'hospital', foreignKey: 'hospitalId' });

CheckupOrder.hasOne(CheckupReport, { foreignKey: 'checkupOrderId' });
CheckupReport.belongsTo(CheckupOrder, { as: 'checkupOrder', foreignKey: 'checkupOrderId' });
CheckupReport.belongsTo(Employee, { as: 'employee', foreignKey: 'employeeId' });
CheckupReport.belongsTo(Department, { as: 'department', foreignKey: 'deptId' });
CheckupReport.belongsTo(Hospital, { as: 'hospital', foreignKey: 'hospitalId' });

CheckupReport.hasMany(ReportItem, { foreignKey: 'reportId' });
ReportItem.belongsTo(CheckupReport, { as: 'report', foreignKey: 'reportId' });
ReportItem.belongsTo(Employee, { as: 'employee', foreignKey: 'employeeId' });

WarningTicket.belongsTo(Employee, { as: 'employee', foreignKey: 'employeeId' });
WarningTicket.belongsTo(Department, { as: 'department', foreignKey: 'deptId' });
WarningTicket.belongsTo(CheckupReport, { as: 'report', foreignKey: 'reportId' });

Notification.belongsTo(User, { as: 'receiver', foreignKey: 'receiverId' });

const models = {
  Department,
  Employee,
  User,
  Budget,
  CheckupPackage,
  Appointment,
  ApprovalRecord,
  CheckupOrder,
  Hospital,
  CheckupReport,
  ReportItem,
  WarningTicket,
  AuditLog,
  Notification,
};

module.exports = {
  ...models,
  sequelize: require('../config/database'),
};
