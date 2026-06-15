const { Op } = require('sequelize');
const { Notification, User, sequelize } = require('../models');
const config = require('../config');
const axios = require('axios');
const { logger } = require('../utils/logger');
const { paginate, formatPagedResult } = require('../utils/helpers');

class NotificationService {
  async create(data) {
    try {
      const notification = await Notification.create({
        ...data,
        status: 'pending',
        readStatus: 'unread',
      });

      setImmediate(() => {
        this._processNotification(notification).catch((e) => {
          logger.error('[非阻断] 处理通知失败', e.message);
        });
      });

      return { success: true, notification };
    } catch (error) {
      logger.error('[非阻断] 创建通知记录失败', error.message);
      return { success: false, error: error.message };
    }
  }

  async batchCreate(items) {
    try {
      const notifications = await Notification.bulkCreate(
        items.map((item) => ({
          ...item,
          status: 'pending',
          readStatus: 'unread',
        }))
      );

      notifications.forEach((n) => {
        setImmediate(() => {
          this._processNotification(n).catch((e) => {
            logger.error(`[非阻断] 处理通知失败: ${n.id}`, e.message);
          });
        });
      });

      return { success: true, notifications, count: notifications.length };
    } catch (error) {
      logger.error('[非阻断] 批量创建通知记录失败', error.message);
      return { success: false, error: error.message, count: 0 };
    }
  }

  async _processNotification(notification) {
    try {
      notification.status = 'sending';
      await notification.save();

      let sendResult = { success: true };

      switch (notification.channel) {
        case 'wecom':
          sendResult = await this._sendWecom(notification);
          break;
        case 'dingtalk':
          sendResult = await this._sendDingtalk(notification);
          break;
        case 'email':
          sendResult = await this._sendEmail(notification);
          break;
        case 'sms':
          sendResult = await this._sendSms(notification);
          break;
        case 'system':
        default:
          sendResult = { success: true };
          break;
      }

      if (sendResult.success) {
        notification.status = 'success';
        notification.sendTime = new Date();
        notification.errorMsg = null;
      } else {
        notification.status = 'failed';
        notification.errorMsg = sendResult.error || '发送失败';

        if (notification.retryTimes < 3) {
          notification.retryTimes = notification.retryTimes + 1;
          const retryDelay = 60000 * (notification.retryTimes + 1);
          logger.info(`[非阻断] 通知 ${notification.id} 将在 ${retryDelay / 60000} 分钟后第 ${notification.retryTimes} 次重试`);
          setTimeout(() => this._processNotification(notification), retryDelay);
        } else {
          logger.warn(`[非阻断] 通知 ${notification.id} 已达最大重试次数，不再重试`);
        }
      }
    } catch (error) {
      logger.error(`[非阻断] 处理通知异常: ${notification.id}`, error.message);
      notification.status = 'failed';
      notification.errorMsg = error.message;

      if (notification.retryTimes < 3) {
        notification.retryTimes = notification.retryTimes + 1;
        setTimeout(() => this._processNotification(notification), 60000 * (notification.retryTimes + 1));
      }
    }

    try {
      await notification.save();
    } catch (saveError) {
      logger.error('[非阻断] 保存通知状态失败', saveError.message);
    }

    return notification;
  }

  async _sendWecom(notification) {
    try {
      if (!config.push.wecomWebhook) {
        throw new Error('企业微信Webhook未配置');
      }

      const content = `${notification.title}\n\n${notification.content || ''}`;

      const payload = {
        msgtype: 'markdown',
        markdown: { content },
      };

      if (notification.receiverType === 'group') {
        payload.markdown.content = `【体检系统通知】\n${content}`;
      }

      const response = await axios.post(config.push.wecomWebhook, payload, {
        timeout: 10000,
      });

      if (response.data.errcode !== 0) {
        throw new Error(`企业微信推送失败: ${response.data.errmsg}`);
      }

      return { success: true };
    } catch (error) {
      logger.warn('[非阻断] 企业微信推送失败', error.message);
      return { success: false, error: error.message };
    }
  }

  async pushWarningToWecomGroup(warningTicket, receivers = []) {
    try {
      if (!config.push.wecomWebhook) {
        logger.warn('[非阻断] 企业微信Webhook未配置，跳过群推送');
        return { success: false, reason: 'webhook_not_configured' };
      }

      const levelColors = {
        low: 'info',
        medium: 'warning',
        high: 'warning',
        critical: 'warning',
      };

      const levelLabels = {
        low: '低',
        medium: '中',
        high: '高',
        critical: '严重',
      };

      const abnormalList = warningTicket.abnormalItems
        ? warningTicket.abnormalItems.map((i) => `- ${i.itemName}: ${i.value}`).join('\n')
        : '';

      const receiverText = receivers.length > 0 ? `\n\n**通知人员:**\n${receivers.map((r) => r.name).join('、')}` : '';

      const content = `
# 【健康预警通知】

> **预警级别**: <font color="${levelColors[warningTicket.warningLevel] || 'warning'}">${levelLabels[warningTicket.warningLevel] || ''}</font>
> **工单号**: ${warningTicket.ticketNo}
> **员工**: ${warningTicket.employeeName}
> **预警类型**: ${this._translateWarningType(warningTicket.warningType)}
> **生成时间**: ${new Date().toLocaleString('zh-CN')}

---

**预警内容:**
${warningTicket.title}

${warningTicket.description ? `**详细说明:**\n${warningTicket.description}` : ''}

${abnormalList ? `**异常指标:**\n${abnormalList}` : ''}

${warningTicket.suggestions ? `**处理建议:**\n${warningTicket.suggestions}` : ''}

---
<@all>${receiverText}`.trim();

      const response = await axios.post(
        config.push.wecomWebhook,
        {
          msgtype: 'markdown',
          markdown: { content },
        },
        { timeout: 10000 }
      );

      if (response.data.errcode !== 0) {
        throw new Error(`企业微信群推送失败: ${response.data.errmsg}`);
      }

      logger.info(`[非阻断] 预警工单${warningTicket.ticketNo}已推送到企业微信群`);
      return { success: true };
    } catch (error) {
      logger.error('[非阻断] 推送企业微信群失败', error.message);
      return { success: false, error: error.message };
    }
  }

  async _sendDingtalk(notification) {
    try {
      if (!config.push.dingtalkWebhook) {
        throw new Error('钉钉Webhook未配置');
      }

      const content = `# ${notification.title}\n\n${notification.content || ''}`;

      const response = await axios.post(
        config.push.dingtalkWebhook,
        {
          msgtype: 'markdown',
          markdown: {
            title: notification.title.substring(0, 32),
            text: content,
          },
        },
        { timeout: 10000 }
      );

      if (response.data.errcode !== 0) {
        throw new Error(`钉钉推送失败: ${response.data.errmsg}`);
      }

      return { success: true };
    } catch (error) {
      logger.warn('[非阻断] 钉钉推送失败', error.message);
      return { success: false, error: error.message };
    }
  }

  async _sendEmail(notification) {
    try {
      logger.info(`[非阻断] 模拟发送邮件: 收件人ID=${notification.receiverId}, 标题=${notification.title}`);
      return { success: true };
    } catch (error) {
      logger.warn('[非阻断] 邮件发送失败', error.message);
      return { success: false, error: error.message };
    }
  }

  async _sendSms(notification) {
    try {
      logger.info(`[非阻断] 模拟发送短信: 接收人ID=${notification.receiverId}, 内容=${notification.title}`);
      return { success: true };
    } catch (error) {
      logger.warn('[非阻断] 短信发送失败', error.message);
      return { success: false, error: error.message };
    }
  }

  async markAsRead(notificationIds, userId) {
    if (!Array.isArray(notificationIds) || notificationIds.length === 0) {
      return { updated: 0 };
    }

    const [updatedCount] = await Notification.update(
      {
        readStatus: 'read',
        readTime: new Date(),
      },
      {
        where: {
          id: { [Op.in]: notificationIds },
          receiverId: userId,
          readStatus: 'unread',
        },
      }
    );

    return { updated: updatedCount };
  }

  async markAllAsRead(userId) {
    const [updatedCount] = await Notification.update(
      {
        readStatus: 'read',
        readTime: new Date(),
      },
      {
        where: {
          receiverId: userId,
          receiverType: { [Op.in]: ['employee', 'user'] },
          readStatus: 'unread',
          channel: 'system',
        },
      }
    );

    return { updated: updatedCount };
  }

  async getUnreadCount(userId) {
    const count = await Notification.count({
      where: {
        receiverId: userId,
        receiverType: { [Op.in]: ['employee', 'user'] },
        readStatus: 'unread',
        channel: 'system',
      },
    });

    const warningUnreadCount = await Notification.count({
      where: {
        receiverId: userId,
        type: 'warning',
        readStatus: 'unread',
        createdAt: {
          [Op.lte]: new Date(Date.now() - config.app.warningUnreadHours * 60 * 60 * 1000),
        },
      },
    });

    return {
      total: count,
      warningUnread: warningUnreadCount,
      needPushToGroup: warningUnreadCount > 0,
    };
  }

  async getNotificationList(userId, filters = {}, options = {}) {
    const { page = 1, pageSize = 20 } = options;
    const { limit, offset } = paginate(page, pageSize);

    const where = {
      receiverId: userId,
      channel: 'system',
    };

    if (filters.type) where.type = filters.type;
    if (filters.readStatus) where.readStatus = filters.readStatus;
    if (filters.dateRange) {
      where.createdAt = {
        [Op.between]: [filters.dateRange.start, filters.dateRange.end],
      };
    }

    const { count, rows } = await Notification.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    return formatPagedResult(rows, count, page, pageSize);
  }

  async getOverdueUnreadWarnings(hours = 24) {
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);

    const notifications = await Notification.findAll({
      where: {
        type: 'warning',
        readStatus: 'unread',
        createdAt: { [Op.lte]: cutoffTime },
        status: 'success',
      },
      include: [
        {
          model: User,
          as: 'receiver',
          attributes: ['id', 'realName', 'wecomUserId'],
        },
      ],
      limit: 500,
    });

    return notifications;
  }

  _translateWarningType(type) {
    const map = {
      consecutive_abnormal: '连续异常指标',
      high_risk_value: '高危指标值',
      multiple_abnormal: '多项异常指标',
      health_score_low: '健康评分偏低',
      custom: '自定义预警',
    };
    return map[type] || type;
  }
}

module.exports = new NotificationService();
module.exports.NotificationService = NotificationService;
