# 企业员工体检全生命周期管理系统

## 🏥 系统概述

企业级员工体检管理系统，覆盖员工体检**预约申请 → 套餐推荐 → 预算审批 → 电子体检单 → 医院对接 → 报告OCR → 健康分析 → 预警推送 → 统计报表**全流程闭环管理。

系统专为数千员工每年两次体检的高并发场景设计，支持稳定应对大流量数据处理。

---

## ✨ 核心功能模块

### 1. 📋 预约管理模块
| 功能 | 说明 |
|------|------|
| 个性化套餐推荐 | 基于年龄/性别/岗位/级别多维评分算法，TOP5智能匹配 |
| 预算校验 | 实时校验部门预算余额，不足时自动触发多级审批 |
| 多级审批流 | 支持3级审批（主管→HR→财务/总经理）、转审、驳回 |
| 批量处理 | 批量生成体检单、批量审批 |

### 2. 📄 体检单管理模块
| 功能 | 说明 |
|------|------|
| 电子体检单 | 自动生成带二维码的电子体检单 |
| 签到核销 | 凭二维码现场扫码签到 |
| 医院API推送 | 对接医院系统，推送订单信息（带重试机制） |
| 爽约标记 | 自动标记超过1天未签到的订单 |

### 3. 📑 报告管理模块
| 功能 | 说明 |
|------|------|
| 医院接口抓取 | 定时轮询医院接口获取体检报告 |
| OCR文字识别 | 自动解析PDF/图片格式报告（中英双语） |
| 历史数据比对 | 与历年数据对比，标注趋势（改善/稳定/恶化） |
| 健康趋势图 | 各指标历年变化趋势可视化数据 |
| 连续异常检测 | 自动统计指标连续异常年数 |

### 4. ⚠️ 预警管理模块
| 功能 | 说明 |
|------|------|
| 连续异常预警 | 连续≥2年异常指标自动触发预警 |
| 高危值预警 | 严重/危急值自动生成高危预警工单 |
| 多渠道推送 | 员工+主管+企业微信群三级通知 |
| 超时重推 | 超24小时未读自动推送至企业群（每日4次） |
| 工单处理 | 阅读→处理→解决→关闭 完整流程 |

### 5. 📤 外部报告上传
| 功能 | 说明 |
|------|------|
| 格式校验 | 仅支持PDF/JPG/PNG/Excel，限20MB |
| 自动OCR | 上传后自动执行OCR识别提取指标 |
| 指标编辑 | 支持手动修正/补充指标数据 |
| 归档存储 | 永久归档，纳入趋势分析 |

### 6. 📊 统计报表模块
| 功能 | 说明 |
|------|------|
| 凌晨自动统计 | 每日1:30自动生成部门统计报表 |
| 体检完成率 | 各部门/整体体检完成率统计 |
| 异常发现率 | 各部门异常报告占比、TOP异常指标排行 |
| 预算使用率 | 预算使用情况实时追踪 |
| PDF/Excel导出 | 多sheet专业报表，含趋势数据 |
| 历年趋势分析 | 近5年关键指标变化趋势 |

### 7. 🔍 查询导出模块
| 功能 | 说明 |
|------|------|
| 组合条件查询 | 部门/项目/时间段/指标 多维组合 |
| 全生命周期记录 | 员工从预约到报告完整记录 |
| 批量导出明细 | Excel批量导出完整数据 |
| 指标明细导出 | 按指标筛选异常记录导出 |

### 8. 🔧 系统管理模块
| 功能 | 说明 |
|------|------|
| 操作日志 | 全量操作审计日志，支持追溯 |
| 企业群推送 | 超时未读预警自动推送到企业微信群 |
| 并发控制 | 分布式锁 + 信号量 限流 |
| 角色权限 | 5种角色权限隔离（管理员/HR/医务/主管/员工） |

---

## 🏗️ 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                      前端 / 移动端                        │
└─────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────┐
│  Nginx 反向代理 + 负载均衡  (HTTPS / 限流 / 静态资源)     │
└─────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────┐
│  Express API 服务层  (PORT: 3000)                        │
│  ├── 认证中间件 (JWT + 限流 + CORS)                      │
│  ├── 审计中间件 (全量操作日志)                            │
│  ├── 8大路由模块                                          │
│  └── 13个业务Service                                      │
└─────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
┌─────────────────┐  ┌────────────────┐  ┌─────────────────┐
│   MySQL 5.7+    │  │  Redis 6.0+    │  │  Bull 队列集群   │
│  - 13张核心表   │  │  - 会话缓存    │  │  - 报告抓取     │
│  - 索引优化     │  │  - 限流计数    │  │  - OCR处理      │
│  - 事务支持     │  │  - 分布式锁    │  │  - 预警推送     │
└─────────────────┘  └────────────────┘  │  - 医院推送     │
                                          │  - 通知发送     │
                                          └─────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────┐
│  定时任务服务 (node-cron + 时区 Asia/Shanghai)            │
│  - 00:10  标记爽约订单                                    │
│  - 每30分 抓取医院报告                                    │
│  - 01:30  生成每日报表(PDF+Excel)                         │
│  - 9/12/15/18点  未读预警推送到群                         │
│  - 每周日/每月1号  周/月报表                              │
└─────────────────────────────────────────────────────────┘
```

---

## 🚀 快速开始

### 环境要求

| 软件 | 最低版本 | 推荐版本 |
|------|----------|----------|
| Node.js | 16.0 | 18.0 LTS |
| MySQL | 5.7 | 8.0 |
| Redis | 5.0 | 7.0 |
| npm | 8.0 | 最新稳定版 |

### 安装部署

#### 1. 克隆并安装依赖

```bash
# 进入项目目录
cd health-management-system

# 安装依赖（使用国内镜像加速）
npm install --registry=https://registry.npmmirror.com
```

#### 2. 配置环境变量

```bash
# 复制示例配置
cp .env.example .env

# 编辑配置文件，修改数据库连接等信息
# Windows用户可直接编辑 .env 文件
```

关键配置项说明：
```env
# 数据库连接
DB_HOST=localhost
DB_PORT=3306
DB_NAME=health_management
DB_USER=root
DB_PASSWORD=你的密码

# Redis连接（队列/缓存/限流必需）
REDIS_HOST=localhost
REDIS_PORT=6379

# 企业微信机器人Webhook（用于群推送）
WECOM_WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=你的key
```

#### 3. 启动MySQL数据库

确保MySQL服务已启动，创建数据库：
```sql
CREATE DATABASE health_management DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

#### 4. 启动Redis服务

确保Redis服务已启动。Windows用户可使用Redis for Windows。

#### 5. 一键启动

**Windows用户：**
```bash
start.bat
```

**Linux/Mac用户：**
```bash
# 同步数据库结构并启动API服务
npm start
```

#### 6. 初始化示例数据（可选）

```bash
node src/seed/initSampleData.js
```

初始化后可使用以下账号登录：

| 用户名 | 密码 | 角色 | 说明 |
|--------|------|------|------|
| admin | 123456 | 系统管理员 | 全部权限 |
| hr01 | 123456 | HR专员 | 人事管理权限 |
| doctor01 | 123456 | 医务 | 报告/预警管理 |

### 启动其他服务

```bash
# 启动定时任务（生成报表、发送预警等）
npm run cron

# 启动Worker队列（OCR、报告抓取、通知等异步任务）
npm run worker

# 开发模式（带热重载）
npm run dev
```

---

## 📡 API 接口总览

### 认证模块 `/api/auth`

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| POST | `/api/auth/login` | 登录获取Token | 公开 |
| POST | `/api/auth/logout` | 登出 | 已登录 |
| GET | `/api/auth/me` | 获取当前用户信息 | 已登录 |
| PUT | `/api/auth/password` | 修改密码 | 已登录 |

### 员工模块 `/api/employee`

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/employee` | 员工列表 | HR+/管理员 |
| GET | `/api/employee/:id` | 员工详情 | 本人/HR+/管理员 |
| GET | `/api/employee/:id/full-record` | 完整体检记录 | 本人/HR+/管理员 |
| GET | `/api/employee/:id/health-trend` | 健康趋势分析 | 本人/HR+/管理员 |
| GET | `/api/employee/departments/tree` | 部门树 | 全部 |
| POST | `/api/employee` | 新增员工 | HR/管理员 |
| PUT | `/api/employee/:id` | 修改员工 | HR/管理员 |

### 预约模块 `/api/appointment`

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/appointment/packages/recommend` | 获取推荐套餐 | 已登录 |
| POST | `/api/appointment/preview` | 创建预约预览 | 已登录 |
| POST | `/api/appointment` | 提交预约申请 | 已登录 |
| GET | `/api/appointment` | 预约列表 | 已登录 |
| GET | `/api/appointment/pending-approvals` | 待审批列表 | 审批人 |
| GET | `/api/appointment/:id` | 预约详情 | 本人/HR+/管理员 |
| POST | `/api/appointment/:id/confirm` | 员工确认预约 | 本人 |
| POST | `/api/appointment/:id/cancel` | 取消预约 | 本人/HR+/管理员 |
| POST | `/api/appointment/:id/approve` | 审批通过 | 审批人 |
| POST | `/api/appointment/:id/reject` | 审批驳回 | 审批人 |
| POST | `/api/appointment/:id/transfer` | 转审 | 审批人 |
| POST | `/api/appointment/:id/generate-order` | 生成体检单 | HR/医务/管理员 |
| POST | `/api/appointment/batch/generate-orders` | 批量生成体检单 | HR/医务/管理员 |
| GET | `/api/appointment/budget/:deptId/:year/:half` | 查询部门预算 | 已登录 |
| POST | `/api/appointment/budget` | 设置部门预算 | HR/主管/管理员 |

### 体检单模块 `/api/checkup`

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/checkup` | 体检单列表 | 已登录 |
| GET | `/api/checkup/:id` | 体检单详情(含二维码) | 本人/HR+/管理员 |
| GET | `/api/checkup/qr/:qrCode` | 扫码获取体检单 | HR/医务/管理员 |
| POST | `/api/checkup/checkin` | 扫码签到 | HR/医务/管理员 |
| PUT | `/api/checkup/:id/status` | 更新体检单状态 | HR/医务/管理员 |
| POST | `/api/checkup/:id/retry-push` | 重试推送医院 | HR/医务/管理员 |
| POST | `/api/checkup/:id/fetch-report` | 手动抓取报告 | HR/医务/管理员 |
| POST | `/api/checkup/hospital/callback` | 医院回调接口 | 医院IP白名单 |

### 报告模块 `/api/report`

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/report` | 报告列表 | 已登录 |
| GET | `/api/report/:id` | 报告详情 | 本人/HR+/管理员 |
| GET | `/api/report/:id/items` | 报告指标明细 | 本人/HR+/管理员 |
| POST | `/api/report/upload` | 上传外部报告 | 员工/HR/医务 |
| PUT | `/api/report/:id/items` | 编辑报告指标 | HR/医务/管理员 |
| DELETE | `/api/report/:id` | 删除上传报告 | HR/医务/管理员 |
| POST | `/api/report/:id/retry-ocr` | 重试OCR识别 | HR/医务/管理员 |
| POST | `/api/report/export-items` | 导出指标明细 | HR/医务/管理员 |

### 预警模块 `/api/warning`

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/warning/stats` | 预警统计面板 | 已登录 |
| GET | `/api/warning` | 预警工单列表 | 已登录 |
| GET | `/api/warning/:id` | 工单详情 | 本人/主管/HR+/管理员 |
| POST | `/api/warning/:id/read` | 标记已读 | 本人/主管 |
| POST | `/api/warning/batch-read` | 批量标记已读 | 本人/主管 |
| POST | `/api/warning/:id/handle` | 处理工单 | HR/医务/管理员/主管 |
| POST | `/api/warning/batch-handle` | 批量处理 | HR/医务/管理员/主管 |
| POST | `/api/warning` | 手动创建工单 | HR/医务/管理员 |
| POST | `/api/warning/analyze-report/:reportId` | 分析报告生成预警 | HR/医务/管理员 |

### 统计报表模块 `/api/statistics`

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/statistics/dept-daily` | 部门日报统计 | 已登录 |
| GET | `/api/statistics/abnormal-ranking` | 异常指标TOP排行 | 已登录 |
| GET | `/api/statistics/trend` | 历年趋势分析 | 已登录 |
| POST | `/api/statistics/generate/pdf` | 生成PDF报表 | HR/医务/管理员 |
| POST | `/api/statistics/generate/excel` | 生成Excel报表 | HR/医务/管理员 |
| GET | `/api/statistics/report-history` | 报表历史 | HR/医务/管理员 |
| POST | `/api/statistics/query/lifecycle` | 组合查询员工全记录 | 已登录 |
| POST | `/api/statistics/export/lifecycle` | 批量导出全记录 | HR/医务/管理员 |

### 系统管理模块 `/api/system`

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/system/stats` | 系统运行统计 | HR+/管理员 |
| GET | `/api/system/logs` | 操作日志查询 | HR/管理员 |
| POST | `/api/system/push-unread-warnings` | 手动触发群推送 | HR/管理员 |
| POST | `/api/system/announcement` | 发布系统公告 | HR/管理员 |
| GET | `/api/system/notifications` | 通知列表 | 已登录 |
| GET | `/api/system/notifications/unread-count` | 未读统计 | 已登录 |
| POST | `/api/system/notifications/read` | 标记通知已读 | 已登录 |
| POST | `/api/system/notifications/read-all` | 全部标为已读 | 已登录 |
| POST | `/api/system/database/sync` | 同步数据库结构 | 管理员 |
| POST | `/api/system/init/sample-data` | 初始化示例数据 | 管理员 |
| GET | `/api/system/health` | 健康检查 | 公开 |

---

## 📊 数据库设计（13张核心表）

| 表名 | 说明 | 关键字段 |
|------|------|----------|
| `sys_department` | 部门表 | 部门编码、名称、层级、主管ID |
| `sys_employee` | 员工表 | 工号、姓名、性别、岗位、工作类型、病史 |
| `sys_user` | 系统用户表 | 账号、密码、角色、关联员工 |
| `sys_hospital` | 合作医院表 | 医院信息、API配置 |
| `sys_audit_log` | 操作日志表 | 全量审计、耗时、IP |
| `sys_notification` | 消息通知表 | 多渠道推送状态 |
| `biz_budget` | 部门预算表 | 年度/半年度预算、多级审批人 |
| `biz_checkup_package` | 体检套餐表 | 套餐属性、适用人群、项目清单 |
| `biz_appointment` | 体检预约表 | 订单、套餐、金额、审批状态 |
| `biz_approval_record` | 审批记录表 | 审批流程记录 |
| `biz_checkup_order` | 体检单表 | 电子体检单、二维码、推送状态 |
| `biz_checkup_report` | 体检报告表 | 报告、评分、异常统计 |
| `biz_report_item` | 指标明细表 | 单项指标、对比历史、连续异常年数 |
| `biz_warning_ticket` | 预警工单表 | 预警级别、处理状态、推送记录 |

---

## 🔐 角色权限矩阵

| 功能模块 | 员工 | 部门主管 | HR | 医务 | 管理员 |
|----------|:----:|:--------:|:---:|:----:|:------:|
| 提交预约申请 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 查看本人记录 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 查看本部门记录 | ❌ | ✅ | ✅ | ✅ | ✅ |
| 查看全部记录 | ❌ | ❌ | ✅ | ✅ | ✅ |
| 审批预约 | ❌ | ✅(本部门) | ✅ | ❌ | ✅ |
| 生成体检单 | ❌ | ❌ | ✅ | ✅ | ✅ |
| 扫码签到 | ❌ | ❌ | ✅ | ✅ | ✅ |
| 上传外部报告 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 编辑报告指标 | ❌ | ❌ | ✅ | ✅ | ✅ |
| 处理预警工单 | ❌ | ✅(本部门) | ✅ | ✅ | ✅ |
| 生成统计报表 | ❌ | ✅(本部门) | ✅ | ✅ | ✅ |
| 批量导出数据 | ❌ | ❌ | ✅ | ✅ | ✅ |
| 系统配置 | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## ⚡ 高并发处理方案

### 应对数千员工每年两次体检

1. **数据库层面**
   - 连接池配置：最大50连接
   - 关键字段加索引（员工ID、部门ID、年份、状态等）
   - 读写分离建议（生产环境）
   - 事务隔离级别RC

2. **缓存层面（Redis）**
   - 用户会话缓存
   - 预算查询缓存（5分钟TTL）
   - 分布式锁（防止重复提交）
   - 限流计数器

3. **异步处理（Bull队列）**
   - 报告抓取：并发10个Worker
   - OCR识别：并发3个Worker（CPU密集）
   - 通知推送：并发20个Worker
   - 医院推送：并发10个Worker
   - 失败自动重试3次（指数退避）

4. **限流策略**
   - API接口：每分钟300次/IP
   - 登录接口：每分钟10次/IP（防爆破）
   - 文件上传：每分钟20次/用户
   - 信号量控制同时处理请求数

5. **前端建议**
   - 预约高峰期页面错峰引导
   - 列表数据懒加载/分页
   - 大文件分片上传

---

## 🔔 企业微信群推送配置

### 1. 获取Webhook
- 打开企业微信群 → 群设置 → 群机器人 → 添加机器人 → 复制Webhook地址
- 将URL填入 `.env` 文件 `WECOM_WEBHOOK_URL`

### 2. 推送场景
- **实时推送**：高危/严重预警立即推送到群
- **定时推送**：每天9/12/15/18点推送超24小时未读的预警
- **触发条件**：连续≥2年异常、高危值、健康分<60分

### 3. 消息效果
预警消息为Markdown格式，包含预警级别、员工姓名、异常指标、建议措施，并@相关人员。

---

## 🛠️ 常见问题

**Q: 启动报错数据库连接失败？**
A: 检查MySQL是否启动，.env中DB配置是否正确，数据库是否已创建。

**Q: 启动后无法登录？**
A: 请先运行 `node src/seed/initSampleData.js` 初始化用户数据，使用 admin/123456 登录。

**Q: 报告上传后OCR识别不准确？**
A: 建议上传300DPI以上的清晰扫描件；支持手动编辑修正指标。

**Q: 预警消息没有推送到企业微信群？**
A: 检查 `.env` 中 `WECOM_WEBHOOK_URL` 是否配置正确，可调用 `/api/system/notifications/test-wecom` 测试。

**Q: 如何接入真实医院接口？**
A: 修改 `sys_hospital` 表的 apiEndpoint 和 apiKey 字段，启用 pushEnabled 和 fetchEnabled。

---

## 📝 更新日志

### v1.0.0 (2024-06-16)
- ✅ 完成13个核心数据模型设计
- ✅ 完成8大业务模块
- ✅ 完成个性化套餐推荐算法
- ✅ 完成多级审批流程引擎
- ✅ 完成医院API对接框架
- ✅ 完成OCR报告识别集成
- ✅ 完成4类预警规则引擎
- ✅ 完成企业微信三级推送
- ✅ 完成PDF/Excel报表生成
- ✅ 完成Bull异步队列处理
- ✅ 完成定时任务调度
- ✅ 完成RBAC权限体系
- ✅ 完成高并发处理方案

---

## 📄 License

MIT License

---

**🏥 企业员工体检管理系统 - 为每一位员工的健康保驾护航！**
