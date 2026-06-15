const winston = require('winston');
const path = require('path');
const fs = require('fs');
const config = require('../config');

const logsDir = path.resolve(config.logging.path);
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const logger = winston.createLogger({
  level: config.logging.level,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'health-management-system' },
  transports: [
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 5242880,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 5242880,
      maxFiles: 10,
    }),
    new winston.transports.File({
      filename: path.join(logsDir, 'audit.log'),
      level: 'audit',
      maxsize: 5242880,
      maxFiles: 10,
    }),
  ],
});

if (config.env !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(
          ({ timestamp, level, message, ...meta }) =>
            `${timestamp} [${level}]: ${message} ${
              Object.keys(meta).length ? JSON.stringify(meta) : ''
            }`
        )
      ),
    })
  );
}

logger.stream = {
  write: (message) => {
    logger.info(message.trim());
  },
};

const audit = (userId, action, resource, detail = {}, ip = '') => {
  logger.log('audit', `${action} on ${resource}`, {
    userId,
    action,
    resource,
    detail,
    ip,
    timestamp: new Date().toISOString(),
  });
};

module.exports = { logger, audit };
