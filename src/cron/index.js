require('dotenv').config();

const cron = require('node-cron');
const { logger } = require('../utils/logger');
const sequelize = require('../config/database');
const ReportService = require('../services/ReportService');
const CheckupOrderService = require('../services/CheckupOrderService');
const WarningService = require('../services/WarningService');
const { systemService } = require('../services/SystemService');
const StatisticsReportService = require('../services/StatisticsReportService');

const tasks = [];

const createTask = (name, schedule, handler) => {
  const task = cron.schedule(
    schedule,
    async () => {
      logger.info(`[定时任务] 开始执行: ${name}`);
      const startTime = Date.now();
      try {
        await handler();
        const duration = Date.now() - startTime;
        logger.info(`[定时任务] 执行完成: ${name} (耗时 ${duration}ms)`);
      } catch (error) {
        logger.error(`[定时任务] 执行失败: ${name}`, error);
      }
    },
    {
      scheduled: false,
      timezone: 'Asia/Shanghai',
    }
  );

  tasks.push({ name, schedule, task });
  return task;
};

createTask('标记爽约体检单', '0 10 0 * * *', async () => {
  await CheckupOrderService.markNoShowOrders();
});

createTask('抓取医院体检报告', '0 */30 * * * *', async () => {
  await ReportService.processReportFetchQueue(100);
});

createTask('预警工单未读推送企业群', '0 0 9,12,15,18 * * *', async () => {
  await WarningService.processUnreadWarningsPush();
  await systemService.pushUnreadWarningsToGroup();
});

createTask('每日凌晨自动统计报表', '0 30 1 * * *', async () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const half = month <= 6 ? '1' : '2';

  logger.info(`[每日统计] ${year}年${half === '1' ? '上' : '下'}半年报表生成中...`);

  try {
    await StatisticsReportService.generatePDFReport(year, half);
  } catch (e) {
    logger.error('生成PDF日报失败', e);
  }

  try {
    await StatisticsReportService.generateExcelReport(year, half);
  } catch (e) {
    logger.error('生成Excel日报失败', e);
  }

  await systemService.pushUnreadWarningsToGroup();
});

createTask('每周日0点周报统计', '0 0 0 * * 0', async () => {
  const now = new Date();
  const year = now.getFullYear();
  try {
    await StatisticsReportService.generateExcelReport(year, 'all');
    logger.info('[周报] 生成成功');
  } catch (e) {
    logger.error('生成周报失败', e);
  }
});

createTask('每月1号生成月报', '0 15 2 1 * *', async () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  logger.info(`[月报] ${year}年${month}月报表生成中...`);
  try {
    await StatisticsReportService.generatePDFReport(year, 'all');
    await StatisticsReportService.generateExcelReport(year, 'all');
  } catch (e) {
    logger.error('生成月报失败', e);
  }
});

createTask('每小时健康检查', '0 0 * * * *', async () => {
  try {
    await sequelize.authenticate();
  } catch (e) {
    logger.error('数据库连接异常', e);
  }
});

async function bootstrap() {
  try {
    await sequelize.authenticate();
    logger.info('定时任务服务 - 数据库连接成功');

    tasks.forEach(({ name, schedule, task }) => {
      task.start();
      logger.info(`[定时任务] 已注册: ${name} (${schedule})`);
    });

    logger.info('\n========================================');
    logger.info('⏰ 定时任务服务启动成功');
    logger.info(`📋 已注册 ${tasks.length} 个定时任务:`);
    tasks.forEach(({ name, schedule }) => {
      logger.info(`   - ${name}: ${schedule}`);
    });
    logger.info('========================================\n');
  } catch (error) {
    logger.error('定时任务服务启动失败:', error);
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  logger.info('收到终止信号，正在停止定时任务...');
  tasks.forEach(({ name, task }) => {
    try {
      task.stop();
      logger.info(`已停止: ${name}`);
    } catch (e) {}
  });
  process.exit(0);
});

bootstrap();
