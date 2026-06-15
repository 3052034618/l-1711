require('dotenv').config();

const {
  sequelize,
  Department,
  Employee,
  User,
  Hospital,
  CheckupPackage,
  Budget,
} = require('../models');
const { hashPassword } = require('../utils/helpers');
const { logger } = require('../utils/logger');

async function initSampleData() {
  await sequelize.sync({ alter: true });

  logger.info('开始初始化示例数据...');

  const departments = await Department.bulkCreate([
    { deptCode: 'HQ', deptName: '总公司', parentId: 0, level: 1, sort: 1, status: 1 },
    { deptCode: 'HR', deptName: '人力资源部', parentId: 1, level: 2, sort: 1, managerId: null, status: 1 },
    { deptCode: 'TECH', deptName: '技术研发部', parentId: 1, level: 2, sort: 2, managerId: null, status: 1 },
    { deptCode: 'FIN', deptName: '财务部', parentId: 1, level: 2, sort: 3, managerId: null, status: 1 },
    { deptCode: 'OPS', deptName: '运营部', parentId: 1, level: 2, sort: 4, managerId: null, status: 1 },
    { deptCode: 'MFG', deptName: '生产制造部', parentId: 1, level: 2, sort: 5, managerId: null, status: 1 },
    { deptCode: 'SLS', deptName: '销售部', parentId: 1, level: 2, sort: 6, managerId: null, status: 1 },
    { deptCode: 'MED', deptName: '医务室', parentId: 1, level: 2, sort: 7, managerId: null, status: 1 },
  ]);

  logger.info(`创建了 ${departments.length} 个部门`);

  const hospitals = await Hospital.bulkCreate([
    {
      hospitalCode: 'HOSP001',
      hospitalName: '市第一人民医院',
      hospitalLevel: 'level_3_a',
      contactPerson: '张主任',
      contactPhone: '0755-88888888',
      address: '深圳市福田区福华路1号',
      region: '福田区',
      apiEndpoint: 'https://api.hospital1.com/v1',
      apiKey: 'hosp1_key_demo',
      pushEnabled: false,
      fetchEnabled: false,
      sort: 1,
      status: 1,
    },
    {
      hospitalCode: 'HOSP002',
      hospitalName: '中山大学附属第八医院',
      hospitalLevel: 'level_3_a',
      contactPerson: '李主任',
      contactPhone: '0755-66666666',
      address: '深圳市福田区深南中路3025号',
      region: '福田区',
      apiEndpoint: 'https://api.hospital2.com/v1',
      apiKey: 'hosp2_key_demo',
      pushEnabled: false,
      fetchEnabled: false,
      sort: 2,
      status: 1,
    },
    {
      hospitalCode: 'HOSP003',
      hospitalName: '北大深圳医院',
      hospitalLevel: 'level_3_a',
      contactPerson: '王主任',
      contactPhone: '0755-77777777',
      address: '深圳市福田区莲花路1120号',
      region: '福田区',
      apiEndpoint: 'https://api.hospital3.com/v1',
      apiKey: 'hosp3_key_demo',
      pushEnabled: false,
      fetchEnabled: false,
      sort: 3,
      status: 1,
    },
  ]);

  logger.info(`创建了 ${hospitals.length} 个医院`);

  const baseItems = [
    { itemCode: 'height', itemName: '身高', price: 0 },
    { itemCode: 'weight', itemName: '体重', price: 0 },
    { itemCode: 'bmi', itemName: 'BMI体重指数', price: 0 },
    { itemCode: 'bp', itemName: '血压测量', price: 10 },
    { itemCode: 'vision', itemName: '视力检查', price: 15 },
    { itemCode: 'hearing', itemName: '听力检查', price: 20 },
    { itemCode: 'blood_routine', itemName: '血常规', price: 60 },
    { itemCode: 'liver_function', itemName: '肝功能五项', price: 80 },
    { itemCode: 'kidney_function', itemName: '肾功能三项', price: 60 },
    { itemCode: 'blood_fat', itemName: '血脂四项', price: 120 },
    { itemCode: 'blood_sugar', itemName: '空腹血糖', price: 30 },
    { itemCode: 'uric_acid', itemName: '尿酸', price: 25 },
    { itemCode: 'chest_xray', itemName: '胸部X光', price: 80 },
    { itemCode: 'ecg', itemName: '心电图', price: 50 },
  ];

  const packages = await CheckupPackage.bulkCreate([
    {
      pkgCode: 'PKG_BASIC',
      pkgName: '基础体检套餐',
      pkgType: 'basic',
      applyGender: 'all',
      applyAgeMin: 18,
      applyAgeMax: 65,
      applyWorkTypes: ['office'],
      price: 388,
      originalPrice: 488,
      hospitalId: 1,
      description: '适合年轻职场人员的基础健康检查套餐',
      notice: '体检前一晚10点后禁食禁水，需空腹',
      items: baseItems,
      sort: 1,
      status: 1,
    },
    {
      pkgCode: 'PKG_STANDARD',
      pkgName: '标准体检套餐',
      pkgType: 'standard',
      applyGender: 'all',
      applyAgeMin: 22,
      applyAgeMax: 70,
      applyWorkTypes: ['office', 'field', 'other'],
      price: 688,
      originalPrice: 888,
      hospitalId: 1,
      description: '包含心脏、腹部B超等全面检查',
      notice: '体检前3天避免饮酒和高脂肪饮食',
      items: [
        ...baseItems,
        { itemCode: 'abdomen_us', itemName: '腹部彩超', price: 180 },
        { itemCode: 'urine', itemName: '尿常规', price: 30 },
        { itemCode: 'stool', itemName: '便常规', price: 25 },
        { itemCode: 'cardiac_us', itemName: '心脏彩超', price: 260 },
        { itemCode: 'thyroid_us', itemName: '甲状腺彩超', price: 150 },
        { itemCode: 'hp', itemName: '幽门螺杆菌检测', price: 120 },
      ],
      sort: 2,
      status: 1,
    },
    {
      pkgCode: 'PKG_PREMIUM',
      pkgName: '尊享深度体检套餐',
      pkgType: 'premium',
      applyGender: 'all',
      applyAgeMin: 35,
      applyAgeMax: 80,
      applyWorkTypes: ['office'],
      price: 1588,
      originalPrice: 2088,
      hospitalId: 2,
      description: '针对40岁以上中年人群，包含肿瘤标志物、脑部检查',
      notice: '建议体检前1周清淡饮食，保证充足睡眠',
      items: [
        ...baseItems,
        { itemCode: 'abdomen_us', itemName: '腹部彩超', price: 180 },
        { itemCode: 'cardiac_us', itemName: '心脏彩超', price: 260 },
        { itemCode: 'thyroid_us', itemName: '甲状腺彩超', price: 150 },
        { itemCode: 'carotid_us', itemName: '颈动脉彩超', price: 180 },
        { itemCode: 'prostate_us', itemName: '前列腺彩超', price: 120 },
        { itemCode: 'mammary_us', itemName: '乳腺彩超', price: 150 },
        { itemCode: 'chest_ct', itemName: '胸部CT平扫', price: 480 },
        { itemCode: 'head_ct', itemName: '头部CT平扫', price: 480 },
        { itemCode: 'tumor_markers', itemName: '肿瘤标志物(12项)', price: 580 },
        { itemCode: 'hpv', itemName: 'HPV检测', price: 320 },
        { itemCode: 'tct', itemName: 'TCT液基细胞学', price: 180 },
        { itemCode: 'bone_density', itemName: '骨密度检测', price: 180 },
        { itemCode: 'hba1c', itemName: '糖化血红蛋白', price: 80 },
      ],
      sort: 3,
      status: 1,
    },
    {
      pkgCode: 'PKG_FEMALE',
      pkgName: '女性专项体检套餐',
      pkgType: 'female',
      applyGender: 'female',
      applyAgeMin: 20,
      applyAgeMax: 70,
      price: 888,
      originalPrice: 1188,
      hospitalId: 1,
      description: '专为女性设计，含乳腺、妇科专项检查',
      notice: '避开经期，月经结束后3-7天最佳',
      items: [
        ...baseItems,
        { itemCode: 'gynecology', itemName: '妇科常规检查', price: 80 },
        { itemCode: 'mammary_us', itemName: '乳腺彩超', price: 150 },
        { itemCode: 'abdomen_us', itemName: '腹部彩超', price: 180 },
        { itemCode: 'thyroid_us', itemName: '甲状腺彩超', price: 150 },
        { itemCode: 'hpv', itemName: 'HPV检测', price: 320 },
        { itemCode: 'tct', itemName: 'TCT液基细胞学', price: 180 },
        { itemCode: 'sex_hormone', itemName: '性激素六项', price: 360 },
      ],
      sort: 4,
      status: 1,
    },
    {
      pkgCode: 'PKG_MALE',
      pkgName: '男性专项体检套餐',
      pkgType: 'male',
      applyGender: 'male',
      applyAgeMin: 22,
      applyAgeMax: 75,
      price: 788,
      originalPrice: 988,
      hospitalId: 1,
      description: '专为男性设计，含前列腺专项检查',
      notice: '体检前2天避免同房',
      items: [
        ...baseItems,
        { itemCode: 'prostate_us', itemName: '前列腺彩超', price: 120 },
        { itemCode: 'abdomen_us', itemName: '腹部彩超', price: 180 },
        { itemCode: 'thyroid_us', itemName: '甲状腺彩超', price: 150 },
        { itemCode: 'psa', itemName: '前列腺特异性抗原', price: 180 },
        { itemCode: 'liver_us', itemName: '肝脏弹性检测', price: 280 },
      ],
      sort: 5,
      status: 1,
    },
    {
      pkgCode: 'PKG_HIGHRISK',
      pkgName: '高危职业体检套餐',
      pkgType: 'high_risk',
      applyGender: 'all',
      applyAgeMin: 18,
      applyAgeMax: 60,
      applyWorkTypes: ['high_risk', 'factory'],
      price: 988,
      originalPrice: 1288,
      hospitalId: 3,
      description: '针对工厂、外勤、高危作业人员的职业健康检查',
      notice: '需携带身份证、职业史资料',
      items: [
        ...baseItems,
        { itemCode: 'chest_ct', itemName: '胸部CT', price: 480 },
        { itemCode: 'lung_function', itemName: '肺功能检查', price: 200 },
        { itemCode: 'hearing_test', itemName: '电测听', price: 150 },
        { itemCode: 'ecg', itemName: '心电图', price: 50 },
        { itemCode: 'abdomen_us', itemName: '腹部彩超', price: 180 },
        { itemCode: 'blood_lead', itemName: '血铅检测', price: 120 },
        { itemCode: 'liver_us', itemName: '肝脏彩超', price: 120 },
      ],
      sort: 6,
      status: 1,
    },
  ]);

  logger.info(`创建了 ${packages.length} 个体检套餐`);

  const commonPositions = ['职员', '主管', '经理', '总监', '工程师', '专员', '助理'];
  const commonNames = [
    '张伟', '王芳', '李娜', '刘洋', '陈静', '杨帆', '赵磊', '黄敏', '周强', '吴莉',
    '徐明', '孙洁', '朱军', '马超', '胡雪', '林涛', '郭颖', '何飞', '高明', '罗梅',
    '宋涛', '谢红', '唐亮', '韩珊', '曹阳', '许萍', '邓勇', '冯娟', '程鹏', '萧燕',
    '卢俊', '田甜', '董斌', '袁媛', '潘震', '于青', '蒋磊', '蔡芳', '余昊', '杜雯',
    '叶峰', '程晨', '苏瑞', '魏巍', '吕明', '丁宁', '沈浩', '任芳', '姚刚', '钟灵',
  ];

  const genders = ['male', 'female'];
  const workTypes = ['office', 'factory', 'field', 'high_risk'];

  const employees = [];
  for (let i = 1; i <= 50; i++) {
    const isMale = i % 2 === 1;
    const gender = isMale ? 'male' : 'female';
    const deptIndex = ((i - 1) % 7) + 2;
    const birthYear = 1975 + (i % 30);
    const birthMonth = String((i % 12) + 1).padStart(2, '0');
    const birthDay = String((i % 27) + 1).padStart(2, '0');
    const wType = workTypes[i % 4];

    employees.push({
      empNo: `EMP${String(20200000 + i)}`,
      name: commonNames[(i - 1) % commonNames.length] + (i > commonNames.length ? i : ''),
      gender,
      birthday: `${birthYear}-${birthMonth}-${birthDay}`,
      idCard: `440301${birthYear}${birthMonth}${birthDay}${String(1000 + i).padStart(4, '0')}`,
      phone: `138${String(10000000 + i * 137).padStart(8, '0')}`,
      email: `employee${i}@company.com`,
      deptId: deptIndex,
      position: commonPositions[(i - 1) % commonPositions.length],
      positionLevel: i % 7 === 0 ? '高级' : i % 5 === 0 ? '中级' : '初级',
      entryDate: `${2010 + (i % 14)}-${birthMonth}-${birthDay}`,
      workType: wType,
      bloodType: ['A', 'B', 'AB', 'O', 'unknown'][i % 5],
      status: 1,
    });
  }

  await Employee.bulkCreate(employees);
  logger.info(`创建了 ${employees.length} 名员工`);

  const users = [];
  users.push({
    username: 'admin',
    password: hashPassword('123456'),
    employeeId: null,
    realName: '系统管理员',
    role: 'admin',
    phone: '13800000000',
    email: 'admin@company.com',
    status: 1,
  });

  users.push({
    username: 'hr01',
    password: hashPassword('123456'),
    employeeId: 1,
    realName: employees[0].name,
    role: 'hr',
    phone: employees[0].phone,
    email: `hr01@company.com`,
    status: 1,
  });

  users.push({
    username: 'doctor01',
    password: hashPassword('123456'),
    employeeId: null,
    realName: '陈医生',
    role: 'medical',
    phone: '13800000001',
    email: `doctor01@company.com`,
    status: 1,
  });

  const managerDeptIds = [2, 3, 4, 5, 6, 7, 8];
  for (let i = 0; i < managerDeptIds.length; i++) {
    const empIndex = i * 6 + 2;
    if (employees[empIndex]) {
      users.push({
        username: `mgr_${employees[empIndex].empNo.toLowerCase()}`,
        password: hashPassword('123456'),
        employeeId: employees[empIndex].id,
        realName: employees[empIndex].name,
        role: 'manager',
        phone: employees[empIndex].phone,
        email: `mgr_${empIndex}@company.com`,
        status: 1,
      });

      await Department.update(
        { managerId: employees[empIndex].id },
        { where: { id: managerDeptIds[i] } }
      );
    }
  }

  for (let i = 10; i < 20; i++) {
    if (employees[i]) {
      users.push({
        username: `emp_${employees[i].empNo.toLowerCase()}`,
        password: hashPassword('123456'),
        employeeId: employees[i].id,
        realName: employees[i].name,
        role: 'employee',
        phone: employees[i].phone,
        email: `emp_${i}@company.com`,
        status: 1,
      });
    }
  }

  await User.bulkCreate(users);
  logger.info(`创建了 ${users.length} 个系统用户`);

  const budgets = [];
  const currentYear = new Date().getFullYear();
  for (let deptId = 1; deptId <= 8; deptId++) {
    const empCount = employees.filter((e) => e.deptId === deptId).length;
    const total = Math.max(50000, empCount * 1000 * (1 + Math.random()));
    budgets.push({
      deptId,
      year: currentYear,
      half: '1',
      totalAmount: Math.round(total / 2),
      usedAmount: 0,
      approvedAmount: 0,
      perPersonLimit: 1500,
    });
    budgets.push({
      deptId,
      year: currentYear,
      half: '2',
      totalAmount: Math.round(total / 2),
      usedAmount: 0,
      approvedAmount: 0,
      perPersonLimit: 1500,
    });
    budgets.push({
      deptId,
      year: currentYear,
      half: 'all',
      totalAmount: Math.round(total),
      usedAmount: 0,
      approvedAmount: 0,
      perPersonLimit: 1500,
    });
  }

  await Budget.bulkCreate(budgets);
  logger.info(`创建了 ${budgets.length} 条预算记录`);

  return {
    departments: departments.length,
    hospitals: hospitals.length,
    packages: packages.length,
    employees: employees.length,
    users: users.length,
    budgets: budgets.length,
    defaultAccounts: [
      { username: 'admin', password: '123456', role: '系统管理员' },
      { username: 'hr01', password: '123456', role: 'HR专员' },
      { username: 'doctor01', password: '123456', role: '医务' },
    ],
  };
}

module.exports = initSampleData;

if (require.main === module) {
  initSampleData()
    .then((result) => {
      logger.info('\n========================================');
      logger.info('✅ 示例数据初始化完成!');
      logger.info('========================================');
      console.table(result.defaultAccounts);
      logger.info(`部门: ${result.departments}`);
      logger.info(`医院: ${result.hospitals}`);
      logger.info(`套餐: ${result.packages}`);
      logger.info(`员工: ${result.employees}`);
      logger.info(`用户: ${result.users}`);
      logger.info(`预算: ${result.budgets}`);
      process.exit(0);
    })
    .catch((e) => {
      logger.error('初始化失败:', e);
      process.exit(1);
    });
}
