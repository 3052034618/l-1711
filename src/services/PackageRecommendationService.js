const { Op } = require('sequelize');
const { CheckupPackage, Employee } = require('../models');
const { calculateAge } = require('../utils/helpers');
const { logger } = require('../utils/logger');

class PackageRecommendationService {
  async recommendPackages(employeeId, options = {}) {
    const employee = await Employee.findByPk(employeeId);
    if (!employee) {
      throw new Error('员工不存在');
    }

    const age = calculateAge(employee.birthday);
    const gender = employee.gender;
    const workType = employee.workType;
    const positionLevel = employee.positionLevel;

    logger.info(`开始推荐套餐: 员工${employeeId}, 年龄${age}, 性别${gender}, 工作类型${workType}`);

    const basePackages = await CheckupPackage.findAll({
      where: { status: 1 },
      raw: true,
    });

    const scoredPackages = basePackages.map((pkg) => ({
      ...pkg,
      score: 0,
      matchReasons: [],
    }));

    scoredPackages.forEach((pkg) => {
      this._calculateGenderScore(pkg, gender);
      this._calculateAgeScore(pkg, age);
      this._calculateWorkTypeScore(pkg, workType);
      this._calculatePositionScore(pkg, positionLevel, options);
      this._calculateBaseTypeScore(pkg, gender, age);
    });

    scoredPackages.sort((a, b) => b.score - a.score);

    const topPackages = scoredPackages.slice(0, 5).map((pkg) => ({
      id: pkg.id,
      pkgCode: pkg.pkgCode,
      pkgName: pkg.pkgName,
      pkgType: pkg.pkgType,
      price: pkg.price,
      description: pkg.description,
      notice: pkg.notice,
      items: pkg.items,
      matchScore: pkg.score,
      matchReasons: pkg.matchReasons,
      recommendLevel: pkg.score >= 80 ? 'strong' : pkg.score >= 60 ? 'normal' : 'optional',
    }));

    return {
      employee: {
        id: employee.id,
        name: employee.name,
        gender,
        age,
        workType,
        position: employee.position,
      },
      recommendedPackages: topPackages,
      allPackages: scoredPackages.map((p) => ({
        id: p.id,
        pkgName: p.pkgName,
        price: p.price,
        score: p.score,
      })),
    };
  }

  _calculateGenderScore(pkg, gender) {
    if (pkg.applyGender === 'all') {
      pkg.score += 10;
      pkg.matchReasons.push('适用于所有性别');
    } else if (pkg.applyGender === gender) {
      pkg.score += 25;
      pkg.matchReasons.push(gender === 'male' ? '男性专属' : '女性专属');
      if (pkg.pkgType === 'female' && gender === 'female') {
        pkg.score += 10;
      }
      if (pkg.pkgType === 'male' && gender === 'male') {
        pkg.score += 10;
      }
    } else {
      pkg.score -= 20;
    }
  }

  _calculateAgeScore(pkg, age) {
    const ageMin = pkg.applyAgeMin || 0;
    const ageMax = pkg.applyAgeMax || 150;

    if (age >= ageMin && age <= ageMax) {
      pkg.score += 20;
      pkg.matchReasons.push(`符合年龄范围${ageMin}-${ageMax}岁`);

      if (age >= 40 && (pkg.pkgType === 'premium' || pkg.pkgType === 'standard')) {
        pkg.score += 15;
        pkg.matchReasons.push('40岁以上推荐加强检查');
      }
      if (age >= 50 && pkg.pkgType === 'premium') {
        pkg.score += 10;
        pkg.matchReasons.push('50岁以上推荐深度检查');
      }
    } else {
      pkg.score -= 10;
    }
  }

  _calculateWorkTypeScore(pkg, workType) {
    if (pkg.applyWorkTypes && Array.isArray(pkg.applyWorkTypes)) {
      if (pkg.applyWorkTypes.includes(workType)) {
        pkg.score += 25;
        pkg.matchReasons.push(`适用于${this._translateWorkType(workType)}人员`);
      } else {
        pkg.score -= 5;
      }
    }

    if (workType === 'high_risk' && pkg.pkgType === 'high_risk') {
      pkg.score += 30;
      pkg.matchReasons.push('高危岗位专项检查');
    }
    if (workType === 'factory' && (pkg.pkgType === 'high_risk' || pkg.pkgType === 'standard')) {
      pkg.score += 10;
      pkg.matchReasons.push('工厂作业人员推荐');
    }
    if (workType === 'field' && pkg.pkgType === 'standard') {
      pkg.score += 5;
      pkg.matchReasons.push('外勤人员推荐');
    }
    if (workType === 'office' && pkg.pkgType === 'basic') {
      pkg.score += 5;
    }
  }

  _calculatePositionScore(pkg, positionLevel, options) {
    if (options.historyAbnormal && pkg.pkgType !== 'basic') {
      pkg.score += 10;
      pkg.matchReasons.push('根据历史异常记录推荐加强检查');
    }

    if (positionLevel && ['高级', 'P7', 'M3', '总监', '副总', '总经理'].some((l) => positionLevel.includes(l))) {
      if (pkg.pkgType === 'premium') {
        pkg.score += 15;
        pkg.matchReasons.push('高管级别推荐尊享套餐');
      }
    }

    if (positionLevel && ['中级', 'P5', 'P6', 'M1', 'M2', '经理'].some((l) => positionLevel.includes(l))) {
      if (pkg.pkgType === 'standard') {
        pkg.score += 10;
        pkg.matchReasons.push('中级管理/技术岗推荐标准套餐');
      }
    }
  }

  _calculateBaseTypeScore(pkg, gender, age) {
    switch (pkg.pkgType) {
      case 'basic':
        pkg.score += 20;
        break;
      case 'standard':
        pkg.score += 30;
        break;
      case 'premium':
        pkg.score += 15;
        if (age >= 45) pkg.score += 10;
        break;
      case 'custom':
        pkg.score += 10;
        break;
    }
  }

  _translateWorkType(type) {
    const map = {
      office: '办公室',
      factory: '工厂',
      field: '外勤',
      high_risk: '高危',
      other: '其他',
    };
    return map[type] || type;
  }
}

module.exports = new PackageRecommendationService();
