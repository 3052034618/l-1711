const express = require('express');
const authRoutes = require('./auth');
const employeeRoutes = require('./employee');
const appointmentRoutes = require('./appointment');
const checkupRoutes = require('./checkup');
const reportRoutes = require('./report');
const warningRoutes = require('./warning');
const statisticsRoutes = require('./statistics');
const systemRoutes = require('./system');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    code: 0,
    message: 'Welcome to Health Management System API',
    version: require('../../package.json').version,
    endpoints: {
      auth: '/api/auth',
      employee: '/api/employee',
      appointment: '/api/appointment',
      checkup: '/api/checkup',
      report: '/api/report',
      warning: '/api/warning',
      statistics: '/api/statistics',
      system: '/api/system',
    },
  });
});

router.use('/auth', authRoutes);
router.use('/employee', employeeRoutes);
router.use('/appointment', appointmentRoutes);
router.use('/checkup', checkupRoutes);
router.use('/report', reportRoutes);
router.use('/warning', warningRoutes);
router.use('/statistics', statisticsRoutes);
router.use('/system', systemRoutes);

module.exports = router;
