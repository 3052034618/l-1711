@echo off
chcp 65001 >nul
title 企业员工体检管理系统 - 启动脚本
color 0A

echo ========================================
echo   企业员工体检管理系统 启动脚本
echo ========================================
echo.

echo [1/4] 检查 Node.js 环境...
node --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js 18+
    pause
    exit /b 1
)
echo       Node.js 版本: 
node --version
echo.

echo [2/4] 安装项目依赖...
if not exist "node_modules" (
    echo       首次启动，正在安装依赖，请稍候...
    call npm install --registry=https://registry.npmmirror.com
    if errorlevel 1 (
        echo [错误] 依赖安装失败
        pause
        exit /b 1
    )
) else (
    echo       依赖已存在，跳过安装
)
echo.

echo [3/4] 同步数据库结构...
node -e "require('./src/config/database').sync({alter: true}).then(() => {console.log('数据库同步完成'); process.exit(0)}).catch(e => {console.error('数据库同步失败:', e.message); process.exit(1)})"
echo.

echo [4/4] 启动 Web 服务 (端口 3000)...
echo.
echo ========================================
echo   服务启动信息:
echo   - API地址: http://localhost:3000/api
echo   - 健康检查: http://localhost:3000/health
echo   - 文档: README.md
echo ========================================
echo.
echo 提示: 按 Ctrl+C 可停止服务
echo.

call npm run start
pause
