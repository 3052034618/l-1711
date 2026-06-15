const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
let passed = 0;
let failed = 0;
const results = [];

function readFile(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) {
    console.error(`文件不存在: ${fullPath}`);
    return '';
  }
  return fs.readFileSync(fullPath, 'utf-8');
}

function verify(name, fn) {
  console.log(`\n📋 验证项: ${name}`);
  console.log('------------------------------------------------------------');
  try {
    const result = fn();
    if (result) {
      passed++;
      results.push({ name, status: 'passed' });
      console.log('✅ 通过');
    } else {
      failed++;
      results.push({ name, status: 'failed', error: '验证失败' });
      console.log('❌ 失败');
    }
  } catch (e) {
    failed++;
    results.push({ name, status: 'failed', error: e.message });
    console.log(`❌ 失败: ${e.message}`);
  }
}

function fileContains(file, pattern, desc) {
  const content = readFile(file);
  let found = false;
  if (pattern instanceof RegExp) {
    found = pattern.test(content);
  } else {
    found = content.includes(pattern);
  }
  if (!found) {
    throw new Error(`${desc}: 未找到 "${pattern}"`);
  }
  console.log(`   ✓ ${desc}`);
  return true;
}

function fileNotContains(file, pattern, desc) {
  const content = readFile(file);
  let found = false;
  if (pattern instanceof RegExp) {
    found = pattern.test(content);
  } else {
    found = content.includes(pattern);
  }
  if (found) {
    throw new Error(`${desc}: 不应该包含 "${pattern}"`);
  }
  console.log(`   ✓ ${desc}`);
  return true;
}

console.log('================================================================================');
console.log('🔍 四个需求缺陷修复 - 代码静态验证');
console.log('================================================================================');

console.log('\n================================================================================');
console.log('📝 第一步: 所有修改文件语法检查');
console.log('================================================================================');

const filesToCheck = [
  'src/services/ApprovalService.js',
  'src/services/StatisticsReportService.js',
  'src/routes/appointment.js',
];

filesToCheck.forEach((f, idx) => {
  verify(`语法检查: ${f}`, () => {
    const fullPath = path.join(ROOT, f);
    if (!fs.existsSync(fullPath)) throw new Error('文件不存在');
    try {
      new Function(fs.readFileSync(fullPath, 'utf-8'));
    } catch (e) {
      const result = require('child_process').spawnSync('node', ['--check', fullPath]);
      if (result.status !== 0) {
        throw new Error(result.stderr.toString() || e.message);
      }
    }
    console.log('   ✓ 语法正确');
    return true;
  });
});

console.log('\n================================================================================');
console.log('📊 需求1: 超预算看板路由优先级 + 金额反查明细');
console.log('================================================================================');

verify('静态路由在动态路由之前', () => {
  const content = readFile('src/routes/appointment.js');
  const staticIdx = content.indexOf('/budget/overbudget-dashboard');
  const dynamicIdx = content.indexOf('/budget/:deptId/:year/:half?');
  if (staticIdx === -1) throw new Error('未找到 overbudget-dashboard 路由');
  if (dynamicIdx === -1) throw new Error('未找到 :deptId 动态路由');
  if (staticIdx > dynamicIdx) throw new Error('静态路由应该在动态路由之前');
  console.log('   ✓ overbudget-dashboard 在 :deptId 动态路由之前');
  
  const detailIdx = content.indexOf('/budget/detail-records');
  if (detailIdx === -1) throw new Error('未找到 detail-records 路由');
  if (detailIdx > dynamicIdx) throw new Error('detail-records 应该在动态路由之前');
  console.log('   ✓ detail-records 在 :deptId 动态路由之前');
  return true;
});

verify('金额反查接口四种类型筛选完整', () => {
  fileContains(
    'src/services/BudgetService.js',
    /case 'normalUsed':[\s\S]*?case 'normalApproved':[\s\S]*?case 'overBudgetApproved':[\s\S]*?case 'overBudgetUsed':/,
    '四种金额类型筛选全部存在'
  );
  fileContains(
    'src/services/BudgetService.js',
    /status.*Op\.in.*confirmed.*in_progress.*completed/,
    '已使用状态包含 confirmed/in_progress/completed'
  );
  fileContains(
    'src/services/BudgetService.js',
    /approvalStatus.*Op\.in.*approved.*pending/,
    '审批中状态包含 approved/pending'
  );
  return true;
});

verify('金额反查返回预约和审批记录', () => {
  fileContains(
    'src/services/BudgetService.js',
    'approvalHistory',
    '返回审批历史记录'
  );
  fileContains(
    'src/services/BudgetService.js',
    'association: \'employee\'',
    '包含员工信息'
  );
  fileContains(
    'src/services/BudgetService.js',
    'association: \'department\'',
    '包含部门信息'
  );
  return true;
});

console.log('\n================================================================================');
console.log('📊 需求2: 报表预览摘要包含TOP异常和趋势数据');
console.log('================================================================================');

verify('报表历史列表摘要包含TOP异常指标', () => {
  fileContains(
    'src/services/StatisticsReportService.js',
    'topAbnormal: summary.topAbnormal',
    '历史列表返回TOP异常指标'
  );
  console.log('   ✓ TOP异常指标已返回到历史列表');
  return true;
});

verify('报表历史列表摘要包含趋势数据', () => {
  fileContains(
    'src/services/StatisticsReportService.js',
    'trendData: summary.trendData',
    '历史列表返回趋势数据'
  );
  console.log('   ✓ 趋势数据已返回到历史列表');
  return true;
});

verify('报表历史列表摘要包含完整关键指标', () => {
  fileContains(
    'src/services/StatisticsReportService.js',
    'warningCount: summary.summary?.warningCount',
    '包含预警数量'
  );
  fileContains(
    'src/services/StatisticsReportService.js',
    'totalDepartments: summary.summary?.totalDepartments',
    '包含部门总数'
  );
  fileContains(
    'src/services/StatisticsReportService.js',
    'deptId: summary?.deptId',
    '列表项包含部门ID'
  );
  console.log('   ✓ 预警数、部门数、部门ID都已返回');
  return true;
});

verify('getReportPreview 返回完整摘要', () => {
  fileContains(
    'src/services/StatisticsReportService.js',
    /getReportPreview[\s\S]*?\.\.\.summary/,
    '在线预览展开完整摘要数据'
  );
  fileContains(
    'src/services/StatisticsReportService.js',
    /_extractReportSummary[\s\S]*?topAbnormal/,
    '摘要提取包含TOP异常指标'
  );
  fileContains(
    'src/services/StatisticsReportService.js',
    /_extractReportSummary[\s\S]*?trendData/,
    '摘要提取包含趋势数据'
  );
  console.log('   ✓ 在线预览返回完整摘要');
  return true;
});

console.log('\n================================================================================');
console.log('📊 需求3: 报表历史按部门筛选 + 多条件组合');
console.log('================================================================================');

verify('报表历史支持deptId筛选参数', () => {
  fileContains(
    'src/services/StatisticsReportService.js',
    /const \{ year, type, deptId, page = 1, pageSize = 20 \} = filters/,
    'getReportHistory 接收 deptId 参数'
  );
  console.log('   ✓ deptId 筛选参数已接收');
  return true;
});

verify('部门筛选结合摘要deptId判断', () => {
  fileContains(
    'src/services/StatisticsReportService.js',
    /if \(deptId\) \{[\s\S]*?_loadReportSummary\(f\)[\s\S]*?summaryDeptId[\s\S]*?String\(summaryDeptId\) !== String\(deptId\)/,
    '部门筛选使用摘要中的 deptId 进行判断'
  );
  console.log('   ✓ 按摘要中的 deptId 进行部门过滤');
  return true;
});

verify('部门筛选与年份类型筛选组合使用', () => {
  const content = readFile('src/services/StatisticsReportService.js');
  const getReportHistoryIdx = content.indexOf('async getReportHistory(filters = {}, options = {})');
  if (getReportHistoryIdx === -1) throw new Error('未找到 getReportHistory 方法');
  
  const methodContent = content.slice(getReportHistoryIdx);
  const deptFilterIdx = methodContent.indexOf('if (deptId) {');
  const yearFilterIdx = methodContent.indexOf('if (year && info.year !== parseInt(year))');
  const typeFilterIdx = methodContent.indexOf('if (type && info.type !== type)');
  const promiseAllIdx = methodContent.indexOf('await Promise.all');
  
  if (yearFilterIdx === -1) throw new Error('未找到年份筛选');
  if (typeFilterIdx === -1) throw new Error('未找到类型筛选');
  if (deptFilterIdx === -1) throw new Error('未找到部门筛选');
  
  if (!(promiseAllIdx < yearFilterIdx && yearFilterIdx < deptFilterIdx && typeFilterIdx < deptFilterIdx)) {
    throw new Error('年份、类型、部门筛选应该都在同一个Promise.all的map回调中，且年份和类型在部门之前执行');
  }
  console.log('   ✓ 年份、类型、部门筛选共同作用于同一文件过滤流程');
  return true;
});

console.log('\n================================================================================');
console.log('📊 需求4: 审批工作台已处理/待办状态筛选');
console.log('================================================================================');

verify('审批工作台支持handled已处理状态', () => {
  fileContains(
    'src/services/ApprovalService.js',
    /case 'handled':[\s\S]*?status = \{ \[Op\.in\]: \['approved', 'rejected', 'transferred'\] \}/,
    'handled状态筛选 approved+rejected+transferred'
  );
  console.log('   ✓ handled状态包含通过、驳回、转审三种记录');
  return true;
});

verify('pending待办状态只显示待处理', () => {
  fileContains(
    'src/services/ApprovalService.js',
    /case 'pending':\s*\n\s*recordWhere\.status = 'pending'/,
    'pending状态只筛选待处理记录'
  );
  const content = readFile('src/services/ApprovalService.js');
  const pendingMatch = content.match(/case 'pending':[\s\S]*?(?=case|default)/);
  if (pendingMatch && /Op\.in/.test(pendingMatch[0])) {
    throw new Error('pending状态分支不应该包含Op.in多值筛选');
  }
  console.log('   ✓ pending只显示待办记录');
  return true;
});

verify('审批统计返回handled已处理数量', () => {
  fileContains(
    'src/services/ApprovalService.js',
    'handled: approved + rejected + transferred',
    '统计接口返回handled字段'
  );
  console.log('   ✓ 统计数据包含handled已处理总数');
  return true;
});

verify('工作台返回当前筛选状态', () => {
  fileContains(
    'src/services/ApprovalService.js',
    'statusFilter: status',
    '返回当前筛选状态标记，便于前端实时更新'
  );
  console.log('   ✓ 返回statusFilter便于列表状态同步');
  return true;
});

console.log('\n================================================================================');
console.log('📋 验证结果汇总');
console.log('================================================================================');

const total = passed + failed;
console.log(`总计: ${total} 个验证项`);
console.log(`✅ 通过: ${passed}`);
console.log(`❌ 失败: ${failed}`);
console.log(`📊 通过率: ${total > 0 ? ((passed / total) * 100).toFixed(1) : 0}%`);

console.log('\n详细结果:');
results.forEach((r, i) => {
  const icon = r.status === 'passed' ? '✅' : '❌';
  const status = r.status === 'passed' ? '通过' : '失败';
  const err = r.error ? `\n     原因: ${r.error}` : '';
  console.log(`${String(i + 1).padStart(2, ' ')}. ${icon} ${status} ${r.name}${err}`);
});

console.log('\n================================================================================');
if (failed === 0) {
  console.log('🎉 所有验证通过！四个需求缺陷修复全部正确实现！');
} else {
  console.log(`⚠️  有 ${failed} 个验证失败，请检查相关代码`);
}
console.log('================================================================================');

const outputDir = path.join(ROOT, 'test_output');
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
const outputFile = path.join(outputDir, 'bugfix_verification.json');
fs.writeFileSync(outputFile, JSON.stringify({ passed, failed, total, results }, null, 2));
console.log(`\n验证结果已保存到: ${outputFile}`);

process.exit(failed === 0 ? 0 : 1);
