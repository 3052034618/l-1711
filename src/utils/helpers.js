const dayjs = require('dayjs');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const generateOrderNo = () => {
  const prefix = 'HE';
  const date = dayjs().format('YYYYMMDDHHmmss');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `${prefix}${date}${random}`;
};

const generateQrCode = () => {
  return uuidv4().replace(/-/g, '');
};

const generateWorkOrderNo = () => {
  const prefix = 'WO';
  const date = dayjs().format('YYYYMMDD');
  const random = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
  return `${prefix}${date}${random}`;
};

const hashPassword = (password) => {
  return crypto.createHash('md5').update(password).digest('hex');
};

const verifyPassword = (password, hash) => {
  return hashPassword(password) === hash;
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const retry = async (fn, retries = 3, delayMs = 1000) => {
  try {
    return await fn();
  } catch (error) {
    if (retries <= 0) throw error;
    await delay(delayMs);
    return retry(fn, retries - 1, delayMs * 2);
  }
};

const paginate = (page = 1, pageSize = 20) => {
  const currentPage = Math.max(1, parseInt(page));
  const limit = Math.max(1, Math.min(100, parseInt(pageSize)));
  const offset = (currentPage - 1) * limit;
  return { limit, offset, page: currentPage, pageSize: limit };
};

const formatPagedResult = (rows, count, page, pageSize) => ({
  list: rows,
  total: count,
  page: parseInt(page),
  pageSize: parseInt(pageSize),
  totalPages: Math.ceil(count / pageSize),
});

const calculateAge = (birthday) => {
  if (!birthday) return 0;
  const birth = dayjs(birthday);
  const now = dayjs();
  return now.diff(birth, 'year');
};

const getCurrentYear = () => dayjs().year();

const getYearRange = (year) => {
  const start = dayjs(`${year}-01-01`).startOf('year').toDate();
  const end = dayjs(`${year}-12-31`).endOf('year').toDate();
  return { start, end };
};

const maskIdCard = (idCard) => {
  if (!idCard || idCard.length < 10) return idCard;
  return idCard.slice(0, 4) + '********' + idCard.slice(-4);
};

const maskPhone = (phone) => {
  if (!phone || phone.length < 11) return phone;
  return phone.slice(0, 3) + '****' + phone.slice(-4);
};

const uniqueArray = (arr, key) => {
  const seen = new Set();
  return arr.filter((item) => {
    const k = key ? item[key] : item;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

const roundTo = (num, precision = 2) => {
  const factor = Math.pow(10, precision);
  return Math.round(num * factor) / factor;
};

module.exports = {
  generateOrderNo,
  generateQrCode,
  generateWorkOrderNo,
  hashPassword,
  verifyPassword,
  delay,
  retry,
  paginate,
  formatPagedResult,
  calculateAge,
  getCurrentYear,
  getYearRange,
  maskIdCard,
  maskPhone,
  uniqueArray,
  roundTo,
};
