#!/bin/bash

# CogniSync 系统启动脚本
# 同时启动后端（FastAPI）和前端（Vite）

set -e

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 项目根目录
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
ADMIN_DIR="$PROJECT_ROOT/admin-frontend"

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   CogniSync 系统启动脚本               ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# 1. 检查后端虚拟环境
echo -e "${YELLOW}[1/6] 检查后端环境...${NC}"
if [ ! -d "$BACKEND_DIR/venv" ]; then
    echo -e "${RED}❌ 后端虚拟环境不存在，正在创建...${NC}"
    cd "$BACKEND_DIR"
    python3 -m venv venv
    echo -e "${GREEN}✅ 虚拟环境创建成功${NC}"
fi

# 2. 检查后端依赖
echo -e "${YELLOW}[2/6] 检查后端依赖...${NC}"
cd "$BACKEND_DIR"
source venv/bin/activate

# 安装/更新依赖
if [ -f "requirements.txt" ]; then
    echo -e "${BLUE}📦 安装后端依赖...${NC}"
    pip install -q -r requirements.txt
    echo -e "${GREEN}✅ 后端依赖安装完成${NC}"
fi

# 3. 检查前端依赖
echo -e "${YELLOW}[3/6] 检查前端依赖...${NC}"
cd "$FRONTEND_DIR"
if [ ! -d "node_modules" ]; then
    echo -e "${BLUE}📦 安装前端依赖...${NC}"
    npm install
    echo -e "${GREEN}✅ 前端依赖安装完成${NC}"
else
    echo -e "${GREEN}✅ 前端依赖已安装${NC}"
fi

# 4. 检查后台管理系统依赖
echo -e "${YELLOW}[4/6] 检查后台管理系统依赖...${NC}"
cd "$ADMIN_DIR"
if [ ! -d "node_modules" ]; then
    echo -e "${BLUE}📦 安装后台管理系统依赖...${NC}"
    npm install
    echo -e "${GREEN}✅ 后台管理系统依赖安装完成${NC}"
else
    echo -e "${GREEN}✅ 后台管理系统依赖已安装${NC}"
fi

# 5. 启动后端
echo -e "${YELLOW}[5/6] 启动后端服务...${NC}"
cd "$BACKEND_DIR"
source venv/bin/activate

# 后台启动后端
echo -e "${BLUE}🚀 启动 FastAPI 后端 (http://localhost:8000)${NC}"
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 > /tmp/cognisync-backend.log 2>&1 &
BACKEND_PID=$!
echo $BACKEND_PID > /tmp/cognisync-backend.pid
echo -e "${GREEN}✅ 后端已启动 (PID: $BACKEND_PID)${NC}"
echo -e "${BLUE}   日志文件: /tmp/cognisync-backend.log${NC}"
echo -e "${BLUE}   API 文档: http://localhost:8000/docs${NC}"

# 等待后端启动
echo -e "${BLUE}⏳ 等待后端初始化...${NC}"
sleep 3

# 6. 启动前端服务
echo -e "${YELLOW}[6/6] 启动前端服务...${NC}"

# 6.1 启动用户前端
cd "$FRONTEND_DIR"
echo -e "${BLUE}🚀 启动用户前端 (http://localhost:3000)${NC}"
npm run dev > /tmp/cognisync-frontend.log 2>&1 &
FRONTEND_PID=$!
echo $FRONTEND_PID > /tmp/cognisync-frontend.pid
echo -e "${GREEN}✅ 用户前端已启动 (PID: $FRONTEND_PID)${NC}"
echo -e "${BLUE}   日志文件: /tmp/cognisync-frontend.log${NC}"

# 6.2 启动后台管理系统
cd "$ADMIN_DIR"
echo -e "${BLUE}🚀 启动后台管理系统 (http://localhost:3001)${NC}"
npm run dev > /tmp/cognisync-admin.log 2>&1 &
ADMIN_PID=$!
echo $ADMIN_PID > /tmp/cognisync-admin.pid
echo -e "${GREEN}✅ 后台管理系统已启动 (PID: $ADMIN_PID)${NC}"
echo -e "${BLUE}   日志文件: /tmp/cognisync-admin.log${NC}"

# 等待前端启动
echo -e "${BLUE}⏳ 等待前端服务初始化...${NC}"
sleep 3

# 启动完成
echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   🎉 所有系统启动成功！                ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}📊 系统信息：${NC}"
echo -e "${BLUE}   ├─ 后端 API:       ${GREEN}http://localhost:8000${NC}"
echo -e "${BLUE}   ├─ API 文档:       ${GREEN}http://localhost:8000/docs${NC}"
echo -e "${BLUE}   ├─ 用户前端:       ${GREEN}http://localhost:3000${NC}"
echo -e "${BLUE}   ├─ 后台管理系统:   ${GREEN}http://localhost:3001${NC}"
echo -e "${BLUE}   ├─ 后端 PID:       ${YELLOW}$BACKEND_PID${NC}"
echo -e "${BLUE}   ├─ 用户前端 PID:   ${YELLOW}$FRONTEND_PID${NC}"
echo -e "${BLUE}   └─ 管理系统 PID:   ${YELLOW}$ADMIN_PID${NC}"
echo ""
echo -e "${YELLOW}💡 使用说明：${NC}"
echo -e "${YELLOW}   - 查看后端日志: tail -f /tmp/cognisync-backend.log${NC}"
echo -e "${YELLOW}   - 查看前端日志: tail -f /tmp/cognisync-frontend.log${NC}"
echo -e "${YELLOW}   - 查看管理系统日志: tail -f /tmp/cognisync-admin.log${NC}"
echo -e "${YELLOW}   - 停止所有服务: ./stop-all.sh${NC}"
echo ""
echo -e "${BLUE}按 Ctrl+C 退出监控模式（服务将继续在后台运行）${NC}"
echo ""

# 监控日志（可选）
trap "echo -e '\n${YELLOW}服务仍在后台运行，使用 ./stop-all.sh 停止${NC}'; exit 0" INT

# 显示实时日志
echo -e "${BLUE}========== 实时日志 ==========${NC}"
tail -f /tmp/cognisync-backend.log -f /tmp/cognisync-frontend.log -f /tmp/cognisync-admin.log
