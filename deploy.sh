#!/bin/bash
# ================================================
# CogniSync 服务器部署脚本
# 购买服务器后执行此脚本完成部署
# ================================================

set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

echo -e "${BLUE}╔══════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   CogniSync 部署脚本                 ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════╝${NC}"

# ── 1. 检查必要环境变量 ────────────────────────────────────
echo -e "\n${YELLOW}[1/5] 检查配置...${NC}"

if [ ! -f "backend/.env" ]; then
    echo -e "${RED}❌ 缺少 backend/.env，请先创建（参考 backend/.env.example）${NC}"
    exit 1
fi

# 检查关键变量
check_env() {
    local key=$1
    local value=$(grep "^${key}=" backend/.env | cut -d'=' -f2-)
    if [ -z "$value" ] || [ "$value" = "changeme" ]; then
        echo -e "${RED}❌ backend/.env 中 ${key} 未设置或使用了默认值${NC}"
        exit 1
    fi
}

check_env "JWT_SECRET"
check_env "POSTGRES_PASSWORD"
check_env "ADMIN_KEY"
echo -e "${GREEN}✅ 配置检查通过${NC}"

# ── 2. 更新前端 API 地址 ───────────────────────────────────
echo -e "\n${YELLOW}[2/5] 设置前端 API 地址...${NC}"

SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || echo "")
if [ -z "$SERVER_IP" ]; then
    read -p "请输入服务器 IP 或域名: " SERVER_IP
fi

echo "VITE_API_BASE_URL=http://${SERVER_IP}:8000" > frontend/.env
echo "VITE_API_BASE_URL=http://${SERVER_IP}:8000/api" > admin-frontend/.env
echo -e "${GREEN}✅ 前端 API 地址设置为: http://${SERVER_IP}:8000${NC}"

# ── 3. 更新 CORS 配置 ──────────────────────────────────────
echo -e "\n${YELLOW}[3/5] 更新 CORS 配置...${NC}"
sed -i "s|CORS_ORIGINS=.*|CORS_ORIGINS=http://${SERVER_IP}:3000,http://${SERVER_IP}:3001|" backend/.env
sed -i "s|DEBUG=true|DEBUG=false|" backend/.env
echo -e "${GREEN}✅ CORS 和 DEBUG 已更新${NC}"

# ── 4. 构建并启动 Docker 容器 ──────────────────────────────
echo -e "\n${YELLOW}[4/5] 构建 Docker 镜像...${NC}"
docker compose build --no-cache
echo -e "\n${YELLOW}启动所有服务...${NC}"
docker compose up -d

# ── 5. 创建第一个管理员账号 ────────────────────────────────
echo -e "\n${YELLOW}[5/5] 等待服务就绪...${NC}"
sleep 10

ADMIN_KEY=$(grep "^ADMIN_KEY=" backend/.env | cut -d'=' -f2-)
echo -e "\n${BLUE}创建管理员账号（如果还没有）...${NC}"
curl -s -X POST http://localhost:8000/api/admin/auth/create-admin \
    -H "X-ADMIN-KEY: ${ADMIN_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"student_id":"admin","password":"请修改此密码","name":"管理员"}' | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    if d.get('success'):
        print('✅ 管理员账号创建成功')
    else:
        print('ℹ️', d)
except: pass
" 2>/dev/null || true

# ── 完成 ──────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   🎉 部署完成！                      ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}访问地址：${NC}"
echo -e "  用户前端:  ${GREEN}http://${SERVER_IP}:3000${NC}"
echo -e "  管理后台:  ${GREEN}http://${SERVER_IP}:3001${NC}"
echo -e "  后端 API:  ${GREEN}http://${SERVER_IP}:8000${NC}"
echo ""
echo -e "${YELLOW}⚠️  请立即登录管理后台修改默认密码！${NC}"
