#!/bin/bash

# CogniSync 系统状态检查脚本

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   CogniSync 系统状态检查               ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# 检查后端
echo -e "${YELLOW}[1] 检查后端服务...${NC}"
if [ -f "/tmp/cognisync-backend.pid" ]; then
    BACKEND_PID=$(cat /tmp/cognisync-backend.pid)
    if ps -p $BACKEND_PID > /dev/null 2>&1; then
        echo -e "${GREEN}✅ 后端运行中 (PID: $BACKEND_PID)${NC}"
        echo -e "${BLUE}   URL: http://localhost:8000${NC}"
        echo -e "${BLUE}   文档: http://localhost:8000/docs${NC}"

        # 测试后端连接
        if curl -s http://localhost:8000/docs > /dev/null; then
            echo -e "${GREEN}   ✓ API 可访问${NC}"
        else
            echo -e "${RED}   ✗ API 无法访问${NC}"
        fi
    else
        echo -e "${RED}❌ 后端未运行${NC}"
    fi
else
    echo -e "${RED}❌ 后端未启动（未找到 PID 文件）${NC}"
fi

echo ""

# 检查前端
echo -e "${YELLOW}[2] 检查用户前端服务...${NC}"
if [ -f "/tmp/cognisync-frontend.pid" ]; then
    FRONTEND_PID=$(cat /tmp/cognisync-frontend.pid)
    if ps -p $FRONTEND_PID > /dev/null 2>&1; then
        echo -e "${GREEN}✅ 用户前端运行中 (PID: $FRONTEND_PID)${NC}"

        # 检查前端端口
        if lsof -i:3000 > /dev/null 2>&1; then
            echo -e "${BLUE}   URL: http://localhost:3000${NC}"

            # 测试前端连接
            if curl -s http://localhost:3000 > /dev/null; then
                echo -e "${GREEN}   ✓ 用户前端可访问${NC}"
            else
                echo -e "${RED}   ✗ 用户前端无法访问${NC}"
            fi
        else
            echo -e "${RED}   ✗ 端口 3000 未开放${NC}"
        fi
    else
        echo -e "${RED}❌ 用户前端未运行${NC}"
    fi
else
    echo -e "${RED}❌ 用户前端未启动（未找到 PID 文件）${NC}"
fi

echo ""

# 检查后台管理系统
echo -e "${YELLOW}[3] 检查后台管理系统...${NC}"
if [ -f "/tmp/cognisync-admin.pid" ]; then
    ADMIN_PID=$(cat /tmp/cognisync-admin.pid)
    if ps -p $ADMIN_PID > /dev/null 2>&1; then
        echo -e "${GREEN}✅ 后台管理系统运行中 (PID: $ADMIN_PID)${NC}"

        # 检查后台管理系统端口
        if lsof -i:3001 > /dev/null 2>&1; then
            echo -e "${BLUE}   URL: http://localhost:3001${NC}"

            # 测试后台管理系统连接
            if curl -s http://localhost:3001 > /dev/null; then
                echo -e "${GREEN}   ✓ 后台管理系统可访问${NC}"
            else
                echo -e "${RED}   ✗ 后台管理系统无法访问${NC}"
            fi
        else
            echo -e "${RED}   ✗ 端口 3001 未开放${NC}"
        fi
    else
        echo -e "${RED}❌ 后台管理系统未运行${NC}"
    fi
else
    echo -e "${RED}❌ 后台管理系统未启动（未找到 PID 文件）${NC}"
fi

echo ""

# 检查端口占用
echo -e "${YELLOW}[4] 端口占用情况...${NC}"
echo -e "${BLUE}端口 8000 (后端):${NC}"
lsof -i:8000 | grep LISTEN || echo -e "${YELLOW}   未被占用${NC}"

echo -e "${BLUE}端口 3000 (用户前端):${NC}"
lsof -i:3000 | grep LISTEN || echo -e "${YELLOW}   未被占用${NC}"

echo -e "${BLUE}端口 3001 (后台管理系统):${NC}"
lsof -i:3001 | grep LISTEN || echo -e "${YELLOW}   未被占用${NC}"

echo ""

# 检查日志文件
echo -e "${YELLOW}[5] 日志文件...${NC}"
if [ -f "/tmp/cognisync-backend.log" ]; then
    BACKEND_LOG_SIZE=$(du -h /tmp/cognisync-backend.log | cut -f1)
    echo -e "${GREEN}✓ 后端日志: /tmp/cognisync-backend.log (${BACKEND_LOG_SIZE})${NC}"
else
    echo -e "${YELLOW}⚠ 后端日志文件不存在${NC}"
fi

if [ -f "/tmp/cognisync-frontend.log" ]; then
    FRONTEND_LOG_SIZE=$(du -h /tmp/cognisync-frontend.log | cut -f1)
    echo -e "${GREEN}✓ 用户前端日志: /tmp/cognisync-frontend.log (${FRONTEND_LOG_SIZE})${NC}"
else
    echo -e "${YELLOW}⚠ 用户前端日志文件不存在${NC}"
fi

if [ -f "/tmp/cognisync-admin.log" ]; then
    ADMIN_LOG_SIZE=$(du -h /tmp/cognisync-admin.log | cut -f1)
    echo -e "${GREEN}✓ 后台管理系统日志: /tmp/cognisync-admin.log (${ADMIN_LOG_SIZE})${NC}"
else
    echo -e "${YELLOW}⚠ 后台管理系统日志文件不存在${NC}"
fi

echo ""

# 最近的错误
echo -e "${YELLOW}[6] 最近的错误（如果有）...${NC}"
if [ -f "/tmp/cognisync-backend.log" ]; then
    ERRORS=$(grep -i "error" /tmp/cognisync-backend.log | tail -3)
    if [ ! -z "$ERRORS" ]; then
        echo -e "${RED}后端错误:${NC}"
        echo "$ERRORS"
    else
        echo -e "${GREEN}✓ 后端无错误${NC}"
    fi
fi

echo ""
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${YELLOW}💡 提示：${NC}"
echo -e "${YELLOW}   - 查看实时日志: tail -f /tmp/cognisync-backend.log${NC}"
echo -e "${YELLOW}   - 停止所有服务: ./stop-all.sh${NC}"
echo -e "${YELLOW}   - 重启服务: ./stop-all.sh && ./start-all.sh${NC}"
echo ""
