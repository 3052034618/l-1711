const { Op, QueryTypes } = require('sequelize');
const {
  CheckupOrder,
  Appointment,
  Employee,
  Department,
  Hospital,
  CheckupPackage,
  sequelize,
} = require('../models');
const BudgetService = require('./BudgetService');
const NotificationService = require('./NotificationService');
const { generateOrderNo, generateQrCode, paginate, formatPagedResult, calculateAge } = require('../utils/helpers');
const { logger, audit } = require('../utils/logger');
const { NotFoundError, ConflictError, ValidationError } = require('../utils/errorHandler');
const QRCode = require('qrcode');
const axios = require('axios');
const config = require('../config');

class CheckupOrderService {
  async generateCheckupOrder(appointmentId, operatorId) {
    const result = await sequelize.transaction(async (t) => {
      const appointment = await Appointment.findByPk(appointmentId, {
        lock: true,
        transaction: t,
      });

      if (!appointment) {
        throw new NotFoundError('预约不存在');
      }

      if (appointment.status !== 'confirmed') {
        throw new ValidationError('预约未确认，无法生成体检单');
      }

      const existingOrder = await CheckupOrder.findOne({
        where: { appointmentId },
        transaction: t,
      });

      if (existingOrder) {
        throw new ConflictError('体检单已存在');
      }

      const employee = await Employee.findByPk(appointment.employeeId, { transaction: t });
      const hospital = await Hospital.findByPk(
        appointment.hospitalId || 1,
        { transaction: t }
      );
      const pkg = await CheckupPackage.findByPk(appointment.packageId, { transaction: t });

      if (!employee || !hospital) {
        throw new ValidationError('员工或医院数据不完整');
      }

      const age = calculateAge(employee.birthday);
      const qrCode = generateQrCode();

      const checkupItems = this._mergeCheckupItems(pkg, appointment.extraItems);

      const checkupDate = appointment.preferredDate || this._getDefaultCheckupDate();
      const checkupTime = this._getDefaultCheckupTime();

      const order = await CheckupOrder.create(
        {
          orderNo: generateOrderNo(),
          appointmentId,
          appointmentOrderNo: appointment.orderNo,
          employeeId: appointment.employeeId,
          employeeName: employee.name,
          gender: employee.gender,
          age,
          deptId: appointment.deptId,
          hospitalId: hospital.id,
          hospitalName: hospital.hospitalName,
          checkupDate,
          checkupTime,
          qrCode,
          packageName: appointment.packageName,
          totalAmount: appointment.totalAmount,
          checkupItems,
          status: 'generated',
          pushStatus: 'pending',
          generatedTime: new Date(),
        },
        { transaction: t }
      );

      appointment.status = 'in_progress';
      await appointment.save({ transaction: t });

      await BudgetService.consumeBudget(
        appointment.deptId,
        appointment.year,
        appointment.half,
        appointment.totalAmount,
        t,
        !!appointment.isOverBudget
      );

      return {
        order,
        employee,
        hospital,
        qrCode,
      };
    });

    audit(operatorId, 'generate', 'checkup_order', {
      id: result.order.id,
      orderNo: result.order.orderNo,
      appointmentId,
    });

    this._pushToHospital(result.order).catch((e) => {
      logger.error(`推送医院失败: ${result.order.orderNo}`, e);
    });

    this._notifyEmployeeCheckupReady(result.order, result.employee).catch((e) => {
      logger.error('发送体检就绪通知失败', e);
    });

    logger.info(`生成体检单成功: ${result.order.orderNo}`);
    return result;
  }

  async batchGenerateOrders(appointmentIds, operatorId) {
    const results = {
      success: [],
      failed: [],
    };

    for (const appointmentId of appointmentIds) {
      try {
        const result = await this.generateCheckupOrder(appointmentId, operatorId);
        results.success.push({
          appointmentId,
          orderNo: result.order.orderNo,
        });
      } catch (error) {
        results.failed.push({
          appointmentId,
          error: error.message,
        });
      }
    }

    return results;
  }

  async getOrderDetail(orderId) {
    const order = await CheckupOrder.findByPk(orderId, {
      include: [
        { association: 'employee', attributes: ['id', 'name', 'empNo', 'gender', 'birthday', 'phone', 'idCard'] },
        { association: 'department', attributes: ['id', 'deptName'] },
        { association: 'hospital', attributes: ['id', 'hospitalName', 'address', 'contactPhone', 'businessHours'] },
        { association: 'appointment' },
      ],
    });

    if (!order) {
      throw new NotFoundError('体检单不存在');
    }

    const qrCodeDataUrl = await QRCode.toDataURL(order.qrCode, {
      width: 256,
      margin: 2,
    });

    return {
      ...order.toJSON(),
      qrCodeDataUrl,
    };
  }

  async getOrderByQrCode(qrCode) {
    const order = await CheckupOrder.findOne({
      where: { qrCode },
      include: [
        { association: 'employee' },
        { association: 'hospital' },
      ],
    });

    if (!order) {
      throw new NotFoundError('无效的二维码');
    }

    return order;
  }

  async checkinOrder(qrCode, operatorId) {
    const order = await CheckupOrder.findOne({
      where: { qrCode },
    });

    if (!order) {
      throw new NotFoundError('体检单不存在');
    }

    if (order.status === 'checkin' || order.status === 'checking' || order.status === 'completed') {
      throw new ConflictError('已签到，请勿重复操作');
    }

    if (order.status === 'cancelled' || order.status === 'no_show') {
      throw new ConflictError('体检单已失效');
    }

    order.status = 'checkin';
    order.checkinTime = new Date();
    await order.save();

    audit(operatorId, 'checkin', 'checkup_order', {
      id: order.id,
      orderNo: order.orderNo,
      employeeId: order.employeeId,
    });

    logger.info(`体检签到: ${order.orderNo}`);
    return order;
  }

  async updateOrderStatus(orderId, status, data = {}, operatorId) {
    const order = await CheckupOrder.findByPk(orderId);
    if (!order) {
      throw new NotFoundError('体检单不存在');
    }

    order.status = status;

    if (status === 'completed' && !order.completedTime) {
      order.completedTime = new Date();
    }

    if (data.hospitalOrderNo) {
      order.hospitalOrderNo = data.hospitalOrderNo;
    }
    if (data.checkupDate) {
      order.checkupDate = data.checkupDate;
    }
    if (data.checkupTime) {
      order.checkupTime = data.checkupTime;
    }

    await order.save();

    audit(operatorId, 'update_status', 'checkup_order', {
      id: orderId,
      status,
    });

    return order;
  }

  async _pushToHospital(order) {
    const hospital = await Hospital.findByPk(order.hospitalId);
    if (!hospital || !hospital.pushEnabled) {
      logger.info(`医院未启用推送，跳过: 订单${order.orderNo}`);
      return { skipped: true };
    }

    order.pushStatus = 'pushing';
    await order.save();

    try {
      const payload = this._buildHospitalPayload(order, hospital);
      const endpoint = hospital.apiEndpoint || config.hospital.apiBase;
      const apiKey = hospital.apiKey || config.hospital.apiKey;

      const response = await axios.post(
        `${endpoint}/checkup/orders`,
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': apiKey,
          },
          timeout: 30000,
        }
      );

      if (response.data && response.data.orderNo) {
        order.hospitalOrderNo = response.data.orderNo;
      }

      order.pushStatus = 'success';
      order.pushTime = new Date();
      order.status = 'pushed';

      if (!order.checkupDate) {
        order.checkupDate = response.data.checkupDate || null;
        order.checkupTime = response.data.checkupTime || null;
      }

      await order.save();

      logger.info(`推送医院成功: ${order.orderNo} -> ${order.hospitalOrderNo}`);
      return { success: true, hospitalOrderNo: order.hospitalOrderNo };
    } catch (error) {
      order.pushStatus = 'failed';
      order.pushError = error.message;
      order.pushRetryTimes = (order.pushRetryTimes || 0) + 1;
      await order.save();

      logger.error(`推送医院失败: ${order.orderNo}, 重试次数: ${order.pushRetryTimes}`, error);

      if (order.pushRetryTimes < 3) {
        const delayMs = order.pushRetryTimes * 60000;
        setTimeout(() => this._pushToHospital(order), delayMs);
      }

      throw error;
    }
  }

  async retryPushOrder(orderId, operatorId) {
    const order = await CheckupOrder.findByPk(orderId);
    if (!order) {
      throw new NotFoundError('体检单不存在');
    }

    if (order.pushStatus === 'success') {
      throw new ConflictError('该订单已推送成功');
    }

    order.pushRetryTimes = 0;
    order.pushStatus = 'pending';
    order.pushError = null;
    await order.save();

    this._pushToHospital(order).catch((e) => {
      logger.error(`重试推送失败: ${order.orderNo}`, e);
    });

    audit(operatorId, 'retry_push', 'checkup_order', { id: orderId });
    return { message: '已提交重试' };
  }

  async getOrderList(filters = {}, options = {}) {
    const { page = 1, pageSize = 20 } = options;
    const { limit, offset } = paginate(page, pageSize);

    const where = {};

    if (filters.orderNo) where.orderNo = { [Op.like]: `%${filters.orderNo}%` };
    if (filters.employeeId) where.employeeId = filters.employeeId;
    if (filters.deptId) where.deptId = filters.deptId;
    if (filters.hospitalId) where.hospitalId = filters.hospitalId;
    if (filters.status) where.status = filters.status;
    if (filters.pushStatus) where.pushStatus = filters.pushStatus;
    if (filters.hospitalOrderNo) where.hospitalOrderNo = filters.hospitalOrderNo;

    if (filters.checkupDateRange) {
      where.checkupDate = {
        [Op.between]: [filters.checkupDateRange.start, filters.checkupDateRange.end],
      };
    }

    const { count, rows } = await CheckupOrder.findAndCountAll({
      where,
      include: [
        { association: 'employee', attributes: ['id', 'name', 'empNo'] },
        { association: 'department', attributes: ['id', 'deptName'] },
        { association: 'hospital', attributes: ['id', 'hospitalName'] },
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    return formatPagedResult(rows, count, page, pageSize);
  }

  async getEmployeeOrders(employeeId, options = {}) {
    return this.getOrderList({ employeeId }, options);
  }

  async getOrdersReadyForReportFetch(limit = 100) {
    const orders = await CheckupOrder.findAll({
      where: {
        status: 'completed',
        completedTime: {
          [Op.lte]: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      },
      include: [{ association: 'hospital' }],
      order: [['completedTime', 'ASC']],
      limit,
    });

    return orders;
  }

  async markNoShowOrders() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 1);

    const [affectedCount] = await CheckupOrder.update(
      { status: 'no_show' },
      {
        where: {
          status: { [Op.in]: ['generated', 'pushed', 'scheduled'] },
          checkupDate: { [Op.lt]: cutoffDate },
          checkinTime: null,
        },
      }
    );

    logger.info(`标记爽约体检单: ${affectedCount}条`);
    return { affectedCount };
  }

  _mergeCheckupItems(pkg, extraItems) {
    const baseItems = pkg && pkg.items ? [...pkg.items] : [];
    const additionalItems = Array.isArray(extraItems) ? extraItems : [];
    return [...baseItems, ...additionalItems];
  }

  _getDefaultCheckupDate() {
    const date = new Date();
    date.setDate(date.getDate() + 7);
    return date.toISOString().split('T')[0];
  }

  _getDefaultCheckupTime() {
    return '08:00-09:00';
  }

  _buildHospitalPayload(order, hospital) {
    return {
      systemOrderNo: order.orderNo,
      appointmentOrderNo: order.appointmentOrderNo,
      patient: {
        name: order.employeeName,
        gender: order.gender,
        age: order.age,
      },
      packageName: order.packageName,
      totalAmount: order.totalAmount,
      checkupItems: order.checkupItems,
      scheduledDate: order.checkupDate,
      scheduledTime: order.checkupTime,
      qrCode: order.qrCode,
      callbackUrl: `${config.hospital.apiBase}/callback/report`,
      notify: true,
    };
  }

  async _notifyEmployeeCheckupReady(order, employee) {
    if (!employee || !employee.phone) {
      return;
    }

    await NotificationService.create({
      type: 'checkup_reminder',
      channel: 'system',
      receiverId: employee.id,
      receiverType: 'employee',
      title: '体检单已生成，凭码到场体检',
      content: `您的体检单已生成，医院：${order.hospitalName}，体检日期：${order.checkupDate} ${order.checkupTime}，请携带身份证到场，扫码签到。`,
      relatedType: 'checkup_order',
      relatedId: order.id.toString(),
      payload: {
        orderNo: order.orderNo,
        hospitalName: order.hospitalName,
        checkupDate: order.checkupDate,
        checkupTime: order.checkupTime,
      },
    });

    if (employee.phone) {
      await NotificationService.create({
        type: 'checkup_reminder',
        channel: 'wecom',
        receiverId: employee.id,
        receiverType: 'employee',
        title: '体检通知',
        content: `【体检提醒】${order.employeeName}您好，您的体检已安排：\n医院：${order.hospitalName}\n日期：${order.checkupDate} ${order.checkupTime}\n请携带身份证准时到场。`,
      });
    }
  }
}

module.exports = new CheckupOrderService();
