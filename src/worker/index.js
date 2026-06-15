require('dotenv').config();

const Bull = require('bull');
const { logger } = require('../utils/logger');
const config = require('../config');
const sequelize = require('../config/database');
const ReportService = require('../services/ReportService');
const WarningService = require('../services/WarningService');
const NotificationService = require('../services/NotificationService');
const { systemService } = require('../services/SystemService');
const CheckupOrderService = require('../services/CheckupOrderService');

const redisOptions = {
  host: config.redis.host,
  port: config.redis.port,
  ...(config.redis.password ? { password: config.redis.password } : {}),
};

const queues = {
  reportFetch: new Bull('report-fetch-queue', { redis: redisOptions }),
  reportAnalyze: new Bull('report-analyze-queue', { redis: redisOptions }),
  notification: new Bull('notification-queue', { redis: redisOptions }),
  warningPush: new Bull('warning-push-queue', { redis: redisOptions }),
  ocrProcess: new Bull('ocr-process-queue', { redis: redisOptions }),
  hospitalPush: new Bull('hospital-push-queue', { redis: redisOptions }),
};

queues.reportFetch.process(10, async (job) => {
  const { checkupOrderId } = job.data;
  logger.info(`[报告抓取队列] 处理: ${checkupOrderId}`);
  try {
    return await ReportService.fetchReportFromHospital(checkupOrderId, 0);
  } catch (error) {
    logger.error(`[报告抓取队列] 失败 ${checkupOrderId}:`, error);
    throw error;
  }
});

queues.reportFetch.on('failed', (job, err) => {
  logger.error(`[报告抓取队列] Job ${job.id} 失败:`, err.message);
});

queues.reportAnalyze.process(5, async (job) => {
  const { reportId } = job.data;
  logger.info(`[报告分析队列] 处理: ${reportId}`);
  try {
    return await WarningService.analyzeReportAndGenerateWarnings(reportId);
  } catch (error) {
    logger.error(`[报告分析队列] 失败 ${reportId}:`, error);
    throw error;
  }
});

queues.notification.process(20, async (job) => {
  const payload = job.data;
  logger.info(`[通知队列] 处理: ${payload.type || 'notification'}`);
  try {
    return await NotificationService.create(payload);
  } catch (error) {
    logger.error('[通知队列] 失败:', error);
    throw error;
  }
});

queues.warningPush.process(5, async (job) => {
  logger.info('[预警推送队列] 执行未读预警推送');
  try {
    return await WarningService.processUnreadWarningsPush();
  } catch (error) {
    logger.error('[预警推送队列] 失败:', error);
    throw error;
  }
});

queues.ocrProcess.process(3, async (job) => {
  const { reportId, filePath } = job.data;
  logger.info(`[OCR队列] 处理报告: ${reportId}`);
  try {
    return await ReportService.processOcrForReport(reportId, filePath, 0);
  } catch (error) {
    logger.error(`[OCR队列] 失败 ${reportId}:`, error);
    throw error;
  }
});

queues.hospitalPush.process(10, async (job) => {
  const { orderId } = job.data;
  logger.info(`[医院推送队列] 处理: ${orderId}`);
  try {
    return await CheckupOrderService.retryPushOrder(orderId, 0);
  } catch (error) {
    logger.error(`[医院推送队列] 失败 ${orderId}:`, error);
    throw error;
  }
});

Object.entries(queues).forEach(([name, queue]) => {
  queue.on('completed', (job, result) => {
    logger.debug(`[${name}] Job ${job.id} 完成`);
  });
});

const stats = {};
setInterval(async () => {
  const statsData = {};
  for (const [name, queue] of Object.entries(queues)) {
    const qStats = await queue.getJobCounts();
    stats[name] = qStats;
  }
  Object.assign(stats, statsData);
}, 30000);

async function bootstrap() {
  try {
    await sequelize.authenticate();
    logger.info('Worker服务 - 数据库连接成功');

    logger.info('\n========================================');
    logger.info('⚡ 任务队列Worker服务启动成功');
    logger.info(`📋 已注册 ${Object.keys(queues).length} 个队列:`);
    Object.keys(queues).forEach((name) => {
      logger.info(`   - ${name}`);
    });
    logger.info('========================================\n');
  } catch (error) {
    logger.error('Worker服务启动失败:', error);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  logger.info('收到终止信号，正在关闭Worker...');
  for (const [name, queue] of Object.entries(queues)) {
    try {
      await queue.close();
      logger.info(`已关闭队列: ${name}`);
    } catch (e) {}
  }
  process.exit(0);
});

module.exports = {
  queues,
  addJob: async (queueName, data, options = {}) => {
    if (!queues[queueName]) {
      throw new Error(`队列不存在: ${queueName}`);
    }
    return queues[queueName].add(data, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: true,
      removeOnFail: 500,
      ...options,
    });
  },
  getStats: () => stats,
};

bootstrap();
