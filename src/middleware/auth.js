const jwt = require('jsonwebtoken');
const { User, Employee } = require('../models');
const config = require('../config');
const { UnauthorizedError, ForbiddenError } = require('../utils/errorHandler');
const { systemService } = require('../services/SystemService');
const { v4: uuidv4 } = require('uuid');

const generateToken = (user) => {
  const payload = {
    id: user.id,
    username: user.username,
    role: user.role,
    employeeId: user.employeeId,
  };

  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });
};

const verifyToken = (token) => {
  try {
    return jwt.verify(token, config.jwt.secret);
  } catch (error) {
    throw error;
  }
};

const authRequired = async (req, res, next) => {
  try {
    const token =
      req.headers.authorization?.replace('Bearer ', '') ||
      req.query.token ||
      req.cookies?.token;

    if (!token) {
      throw new UnauthorizedError('未提供认证令牌');
    }

    const decoded = verifyToken(token);
    const user = await User.findByPk(decoded.id);

    if (!user || user.status !== 1) {
      throw new UnauthorizedError('用户不存在或已禁用');
    }

    req.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      employeeId: user.employeeId,
      realName: user.realName,
    };

    if (user.employeeId) {
      const emp = await Employee.findByPk(user.employeeId, {
        attributes: ['id', 'name', 'deptId', 'position', 'workType'],
      });
      if (emp) {
        req.user.employee = emp.toJSON();
        req.user.deptId = emp.deptId;
      }
    }

    next();
  } catch (error) {
    next(error);
  }
};

const roleRequired = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      throw new UnauthorizedError('未登录');
    }

    if (!roles.includes(req.user.role)) {
      throw new ForbiddenError(
        `需要角色: ${roles.join('/')}，当前角色: ${req.user.role}`
      );
    }

    next();
  };
};

const auditMiddleware = async (req, res, next) => {
  const startTime = Date.now();
  const traceId = uuidv4().replace(/-/g, '').substring(0, 32);
  req.traceId = traceId;

  const originalSend = res.send;
  let responseBody = null;

  res.send = function (body) {
    try {
      responseBody = typeof body === 'string' ? body : JSON.stringify(body).substring(0, 1000);
    } catch (e) {}
    return originalSend.apply(res, arguments);
  };

  res.on('finish', async () => {
    try {
      const duration = Date.now() - startTime;
      const userId = req.user?.id;
      const username = req.user?.username;
      const employeeId = req.user?.employeeId;

      const pathSegments = req.path.split('/').filter(Boolean);
      const module = pathSegments[0] || 'unknown';
      const resource = pathSegments.slice(1).join('/') || 'root';

      const actionMap = {
        GET: 'query',
        POST: 'create',
        PUT: 'update',
        PATCH: 'update',
        DELETE: 'delete',
      };

      let action = actionMap[req.method] || req.method.toLowerCase();

      if (pathSegments.includes('export')) action = 'export';
      if (pathSegments.includes('login')) action = 'login';
      if (pathSegments.includes('logout')) action = 'logout';
      if (pathSegments.includes('approve')) action = 'approve';
      if (pathSegments.includes('reject')) action = 'reject';
      if (pathSegments.includes('confirm')) action = 'confirm';
      if (pathSegments.includes('cancel')) action = 'cancel';
      if (pathSegments.includes('checkin')) action = 'checkin';
      if (pathSegments.includes('upload')) action = 'upload';

      const shouldLog =
        ['employee', 'appointment', 'checkup', 'report', 'warning', 'budget', 'system', 'upload'].includes(module) ||
        req.method !== 'GET' ||
        duration > 1000;

      if (shouldLog && userId) {
        let requestParams = {};
        if (req.method === 'GET') {
          requestParams = req.query;
        } else if (req.body && !pathSegments.includes('login')) {
          const body = { ...req.body };
          if (body.password) delete body.password;
          requestParams = body;
        }

        await systemService.log({
          userId,
          username,
          employeeId,
          module,
          action,
          resource,
          resourceId: pathSegments[pathSegments.length - 1],
          method: req.method,
          url: req.originalUrl,
          ip:
            req.headers['x-forwarded-for'] ||
            req.headers['x-real-ip'] ||
            req.socket.remoteAddress,
          userAgent: req.headers['user-agent'],
          requestParams,
          result: res.statusCode < 400 ? 'success' : 'fail',
          errorMsg: res.statusCode >= 400 ? `HTTP ${res.statusCode}` : null,
          duration,
          detail: { traceId },
        });
      }
    } catch (e) {
      console.error('audit middleware error:', e.message);
    }
  });

  next();
};

const rateLimit = require('express-rate-limit');

const createRateLimiter = (windowMs = 60000, max = 100) => {
  return rateLimit({
    windowMs,
    max,
    message: {
      code: 429,
      message: '请求过于频繁，请稍后再试',
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      return (
        req.headers['x-forwarded-for'] ||
        req.headers['x-real-ip'] ||
        req.socket.remoteAddress ||
        req.user?.id?.toString() ||
        'unknown'
      );
    },
  });
};

const uploadLimiter = createRateLimiter(60000, 20);
const apiLimiter = createRateLimiter(60000, 300);
const authLimiter = createRateLimiter(60000, 10);

module.exports = {
  generateToken,
  verifyToken,
  authRequired,
  roleRequired,
  auditMiddleware,
  createRateLimiter,
  uploadLimiter,
  apiLimiter,
  authLimiter,
};
