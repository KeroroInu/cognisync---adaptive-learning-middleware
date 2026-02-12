#!/bin/bash

# CogniSync 系统停止脚本
# 停止后端和前端服务

set -e

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🛑 停止 CogniSync 所有服务...${NC}"
echo ""

# 停止后端
if [ -f "/tmp/cognisync-backend.pid" ]; then
    BACKEND_PID=$(cat /tmp/cognisync-backend.pid)
    if ps -p $BACKEND_PID > /dev/null 2>&1; then
        echo -e "${YELLOW}⏹️  停止后端服务 (PID: $BACKEND_PID)...${NC}"
        kill $BACKEND_PID
        rm /tmp/cognisync-backend.pid
        echo -e "${GREEN}✅ 后端已停止${NC}"
    else
        echo -e "${YELLOW}⚠️  后端服务未运行${NC}"
        rm /tmp/cognisync-backend.pid
    fi
else
    echo -e "${YELLOW}⚠️  未找到后端 PID 文件${NC}"
fi

# 停止前端
if [ -f "/tmp/cognisync-frontend.pid" ]; then
    FRONTEND_PID=$(cat /tmp/cognisync-frontend.pid)
    if ps -p $FRONTEND_PID > /dev/null 2>&1; then
        echo -e "${YELLOW}⏹️  停止用户前端服务 (PID: $FRONTEND_PID)...${NC}"
        kill $FRONTEND_PID
        rm /tmp/cognisync-frontend.pid
        echo -e "${GREEN}✅ 用户前端已停止${NC}"
    else
        echo -e "${YELLOW}⚠️  用户前端服务未运行${NC}"
        rm /tmp/cognisync-frontend.pid
    fi
else
    echo -e "${YELLOW}⚠️  未找到用户前端 PID 文件${NC}"
fi

# 停止后台管理系统
if [ -f "/tmp/cognisync-admin.pid" ]; then
    ADMIN_PID=$(cat /tmp/cognisync-admin.pid)
    if ps -p $ADMIN_PID > /dev/null 2>&1; then
        echo -e "${YELLOW}⏹️  停止后台管理系统 (PID: $ADMIN_PID)...${NC}"
        kill $ADMIN_PID
        rm /tmp/cognisync-admin.pid
        echo -e "${GREEN}✅ 后台管理系统已停止${NC}"
    else
        echo -e "${YELLOW}⚠️  后台管理系统未运行${NC}"
        rm /tmp/cognisync-admin.pid
    fi
else
    echo -e "${YELLOW}⚠️  未找到后台管理系统 PID 文件${NC}"
fi

# 额外清理：确保所有相关进程都被终止
echo ""
echo -e "${YELLOW}🧹 清理残留进程...${NC}"

# 清理后端进程
BACKEND_PIDS=$(ps aux | grep '[u]vicorn app.main:app' | awk '{print $2}')
if [ ! -z "$BACKEND_PIDS" ]; then
    echo -e "${YELLOW}发现残留后端进程: $BACKEND_PIDS${NC}"
    kill $BACKEND_PIDS 2>/dev/null || true
fi

# 清理前端进程
FRONTEND_PIDS=$(ps aux | grep '[v]ite' | grep 'cognisync' | awk '{print $2}')
if [ ! -z "$FRONTEND_PIDS" ]; then
    echo -e "${YELLOW}发现残留前端进程: $FRONTEND_PIDS${NC}"
    kill $FRONTEND_PIDS 2>/dev/null || true
fi

echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   ✅ 所有服务已停止                    ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""
