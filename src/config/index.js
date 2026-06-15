require('dotenv').config();

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT) || 3000,
  
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    name: process.env.DB_NAME || 'health_management',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
  },
  
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || null,
  },
  
  jwt: {
    secret: process.env.JWT_SECRET || 'default-secret-key',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },
  
  hospital: {
    apiBase: process.env.HOSPITAL_API_BASE || 'https://api.hospital.com/v1',
    apiKey: process.env.HOSPITAL_API_KEY || '',
  },
  
  push: {
    wecomWebhook: process.env.WECOM_WEBHOOK_URL || '',
    dingtalkWebhook: process.env.DINGTALK_WEBHOOK_URL || '',
  },
  
  storage: {
    uploadPath: process.env.UPLOAD_PATH || './uploads',
    reportPath: process.env.REPORT_PATH || './reports',
  },
  
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    path: process.env.LOG_PATH || './logs',
  },
  
  app: {
    pagesize: 20,
    concurrentLimit: 100,
    warningUnreadHours: 24,
    annualCheckupTimes: 2,
  },
};

module.exports = config;
