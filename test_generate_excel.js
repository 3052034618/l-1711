const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

async function generateTestExcel() {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('体检报告');

  worksheet.columns = [
    { header: '项目名称', key: 'name', width: 25 },
    { header: '结果', key: 'result', width: 15 },
    { header: '单位', key: 'unit', width: 10 },
    { header: '参考范围', key: 'refRange', width: 20 },
    { header: '异常标记', key: 'abnormal', width: 10 },
    { header: '分类', key: 'category', width: 15 },
  ];

  const testData = [
    { name: '白细胞计数(WBC)', result: '6.5', unit: '×10^9/L', refRange: '4.0-10.0', abnormal: '', category: '血常规' },
    { name: '红细胞计数(RBC)', result: '4.8', unit: '×10^12/L', refRange: '4.0-5.5', abnormal: '', category: '血常规' },
    { name: '血红蛋白(HGB)', result: '155', unit: 'g/L', refRange: '120-160', abnormal: '', category: '血常规' },
    { name: '血小板计数(PLT)', result: '220', unit: '×10^9/L', refRange: '100-300', abnormal: '', category: '血常规' },
    { name: '谷丙转氨酶(ALT)', result: '85', unit: 'U/L', refRange: '0-40', abnormal: '↑', category: '肝功能' },
    { name: '谷草转氨酶(AST)', result: '35', unit: 'U/L', refRange: '0-40', abnormal: '', category: '肝功能' },
    { name: '总胆红素(TBIL)', result: '18.5', unit: 'μmol/L', refRange: '3.4-17.1', abnormal: '↑', category: '肝功能' },
    { name: '尿素氮(BUN)', result: '5.2', unit: 'mmol/L', refRange: '2.9-8.2', abnormal: '', category: '肾功能' },
    { name: '肌酐(CRE)', result: '78', unit: 'μmol/L', refRange: '44-133', abnormal: '', category: '肾功能' },
    { name: '尿酸(UA)', result: '480', unit: 'μmol/L', refRange: '150-420', abnormal: '↑', category: '肾功能' },
    { name: '总胆固醇(TC)', result: '6.2', unit: 'mmol/L', refRange: '<5.2', abnormal: '↑', category: '血脂' },
    { name: '甘油三酯(TG)', result: '1.8', unit: 'mmol/L', refRange: '<1.7', abnormal: '↑', category: '血脂' },
    { name: '高密度脂蛋白(HDL)', result: '1.2', unit: 'mmol/L', refRange: '>1.0', abnormal: '', category: '血脂' },
    { name: '低密度脂蛋白(LDL)', result: '4.1', unit: 'mmol/L', refRange: '<3.4', abnormal: '↑', category: '血脂' },
    { name: '空腹血糖(GLU)', result: '7.8', unit: 'mmol/L', refRange: '3.9-6.1', abnormal: '↑', category: '血糖' },
    { name: '身高', result: '175', unit: 'cm', refRange: '', abnormal: '', category: '一般检查' },
    { name: '体重', result: '85', unit: 'kg', refRange: '', abnormal: '', category: '一般检查' },
    { name: 'BMI', result: '27.8', unit: '', refRange: '18.5-23.9', abnormal: '↑', category: '一般检查' },
    { name: '收缩压', result: '145', unit: 'mmHg', refRange: '90-140', abnormal: '↑', category: '血压' },
    { name: '舒张压', result: '95', unit: 'mmHg', refRange: '60-90', abnormal: '↑', category: '血压' },
  ];

  testData.forEach((row) => {
    worksheet.addRow(row);
  });

  worksheet.getRow(1).font = { bold: true, size: 12 };
  worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
  worksheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' },
  };

  worksheet.eachRow((row, rowNumber) => {
    row.alignment = { vertical: 'middle' };
    if (rowNumber > 1) {
      const abnormalCell = row.getCell('abnormal');
      if (abnormalCell.value === '↑' || abnormalCell.value === '↓') {
        row.font = { color: { argb: 'FFFF0000' } };
      }
    }
  });

  const testDir = path.join(__dirname, 'test_output');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  const filePath = path.join(testDir, 'test_checkup_report.xlsx');
  await workbook.xlsx.writeFile(filePath);
  console.log(`✅ 测试Excel文件已生成: ${filePath}`);
  console.log(`   包含 ${testData.length} 项体检指标`);
  
  return filePath;
}

if (require.main === module) {
  generateTestExcel().catch(console.error);
}

module.exports = generateTestExcel;
