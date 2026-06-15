const { Op } = require('sequelize');
const { Notification, User, sequelize } = require('../models');
const config = require('../config');
const axios = require('axios');
const { logger } = require('../utils/logger');
const { paginate, formatPagedResult } = require('../utils/helpers');

class NotificationService {
  async create(data) {
    const notification = await Notification.create({
      ...data,
      status: 'pending',
      readStatus: 'unread',
    });

    this._processNotification(notification).catch((e) => {
      logger.error('处理通知失败', e);
    });

    return notification;
  }

  async batchCreate(items) {
    const notifications = await Notification.bulkCreate(
      items.map((item) => ({
        ...item,
        status: 'pending',
        readStatus: 'unread',
      }))
    );

    notifications.forEach((n) => {
      this._processNotification(n).catch((e) => {
        logger.error(`处理通知失败: ${n.id}`, e);
      });
    });

    return notifications;
  }

  async _processNotification(notification) {
    try {
      notification.status = 'sending';
      await notification.save();

      switch (notification.channel) {
        case 'wecom':
          await this._sendWecom(notification);
          break;
        case 'dingtalk':
          await this._sendDingtalk(notification);
          break;
        case 'email':
          await this._sendEmail(notification);
          break;
        case 'sms':
          await this._sendSms(notification);
          break;
        case 'system':
        default:
          notification.status = 'success';
          break;
      }

      notification.status = 'success';
      notification.sendTime = new Date();
    } catch (error) {
      logger.error(`推送通知失败: ${notification.id}`, error);
      notification.status = 'failed';
      notification.errorMsg = error.message;

      if (notification.retryTimes < 3) {
        notification.retryTimes = notification.retryTimes + 1;
        setTimeout(() => this._processNotification(notification), 60000 * (notification.retryTimes + 1));
      }
    }

    await notification.save();
    return notification;
  }

  async _sendWecom(notification) {
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

    return true;
  }

  async pushWarningToWecomGroup(warningTicket, receivers = []) {
    if (!config.push.wecomWebhook) {
      logger.warn('企业微信Webhook未配置，跳过群推送');
      return false;
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

    try {
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

      logger.info(`预警工单${warningTicket.ticketNo}已推送到企业微信群`);
      return true;
    } catch (error) {
      logger.error('推送企业微信群失败', error);
      throw error;
    }
  }

  async _sendDingtalk(notification) {
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

    return true;
  }

  async _sendEmail(notification) {
    logger.info(`模拟发送邮件: 收件人ID=${notification.receiverId}, 标题=${notification.title}`);
    return true;
  }

  async _sendSms(notification) {
    logger.info(`模拟发送短信: 接收人ID=${notification.receiverId}, 内容=${notification.title}`);
    return true;
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
