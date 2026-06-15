require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');

const config = require('./config');
const { errorHandler, NotFoundError } = require('./utils/errorHandler');
const { logger } = require('./utils/logger');
const { auditMiddleware, apiLimiter } = require('./middleware/auth');
const routes = require('./routes');

const app = express();

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  maxAge: 86400,
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const uploadPath = path.resolve(config.storage.uploadPath);
const reportPath = path.resolve(config.storage.reportPath);
const logPath = path.resolve(config.logging.path);
[uploadPath, reportPath, logPath].forEach((p) => {
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
  }
});

app.use('/uploads', express.static(uploadPath, { maxAge: '7d' }));
app.use('/reports', express.static(reportPath, { maxAge: '7d' }));

app.set('trust proxy', 1);

app.use((req, res, next) => {
  const start = Date.now();
  req._startTime = start;

  res.on('finish', () => {
    const duration = Date.now() - start;
    const method = req.method;
    const url = req.originalUrl;
    const status = res.statusCode;
    const level = status >= 400 ? 'warn' : 'info';
    if (!url.startsWith('/uploads') && !url.startsWith('/reports')) {
      logger.log(level, `${method} ${url} ${status} ${duration}ms - ${req.ip}`);
    }
  });

  next();
});

app.use(auditMiddleware);

app.use('/api', apiLimiter, routes);

app.get('/health', (req, res) => {
  res.json({
    code: 0,
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: require('../package.json').version,
    env: config.env,
  });
});

app.use((req, res, next) => {
  if (!req.path.startsWith('/uploads') && !req.path.startsWith('/reports')) {
    next(new NotFoundError(`API endpoint not found: ${req.method} ${req.originalUrl}`));
  } else {
    next();
  }
});

app.use(errorHandler);

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const PORT = config.port;

async function bootstrap() {
  try {
    const sequelize = require('./config/database');

    await sequelize.authenticate();
    logger.info('数据库连接成功');

    await sequelize.sync({ alter: true });
    logger.info('数据库模型同步完成');

    app.listen(PORT, () => {
      logger.info(`\n========================================`);
      logger.info(`🏥 企业员工体检管理系统启动成功`);
      logger.info(`📡 服务器地址: http://localhost:${PORT}`);
      logger.info(`🔗 API根路径: http://localhost:${PORT}/api`);
      logger.info(`🩺 健康检查: http://localhost:${PORT}/health`);
      logger.info(`📦 环境: ${config.env}`);
      logger.info(`========================================\n`);
    });
  } catch (error) {
    logger.error('系统启动失败:', error);
    process.exit(1);
  }
}

bootstrap();

module.exports = app;
