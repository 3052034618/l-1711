class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message = '参数校验失败', errors = null) {
    super(message, 400, 'VALIDATION_ERROR');
    this.errors = errors;
  }
}

class UnauthorizedError extends AppError {
  constructor(message = '未授权访问') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

class ForbiddenError extends AppError {
  constructor(message = '无权限访问') {
    super(message, 403, 'FORBIDDEN');
  }
}

class NotFoundError extends AppError {
  constructor(message = '资源不存在') {
    super(message, 404, 'NOT_FOUND');
  }
}

class ConflictError extends AppError {
  constructor(message = '资源冲突') {
    super(message, 409, 'CONFLICT');
  }
}

const success = (res, data = null, message = '操作成功', statusCode = 200) => {
  res.status(statusCode).json({
    code: 0,
    message,
    data,
    timestamp: Date.now(),
  });
};

const pagedSuccess = (res, pagedResult, message = '获取成功') => {
  res.status(200).json({
    code: 0,
    message,
    ...pagedResult,
    timestamp: Date.now(),
  });
};

const errorHandler = (err, req, res, next) => {
  const { logger } = require('./logger');
  
  let statusCode = err.statusCode || 500;
  let code = err.code || 'INTERNAL_ERROR';
  let message = err.message || '服务器内部错误';

  if (err.name === 'SequelizeValidationError') {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    message = err.errors.map((e) => e.message).join('; ');
  }

  if (err.name === 'SequelizeUniqueConstraintError') {
    statusCode = 409;
    code = 'DUPLICATE_ERROR';
    message = '数据重复: ' + err.errors.map((e) => e.message).join('; ');
  }

  if (err.name === 'SequelizeForeignKeyConstraintError') {
    statusCode = 400;
    code = 'FK_CONSTRAINT_ERROR';
    message = '外键约束错误';
  }

  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    code = 'TOKEN_EXPIRED';
    message = '登录已过期';
  }

  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    code = 'INVALID_TOKEN';
    message = '无效的登录凭证';
  }

  if (err.code === 'LIMIT_FILE_SIZE') {
    statusCode = 400;
    code = 'FILE_TOO_LARGE';
    message = '文件大小超过限制';
  }

  if (!err.isOperational) {
    logger.error(`${err.stack || err}`);
  }

  res.status(statusCode).json({
    code: statusCode,
    error: code,
    message,
    ...(err.errors && { errors: err.errors }),
    timestamp: Date.now(),
  });
};

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  success,
  pagedSuccess,
  errorHandler,
  asyncHandler,
};
