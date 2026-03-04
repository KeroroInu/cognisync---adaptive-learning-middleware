#!/bin/bash
# ================================================
# CogniSync 服务器部署脚本
# 使用方法：chmod +x deploy.sh && ./deploy.sh
# ================================================

set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

echo -e "${BLUE}╔══════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   CogniSync 部署脚本                 ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════╝${NC}"

# ── 1. 自动生成 backend/.env ────────────────────────────────
echo -e "\n${YELLOW}[1/5] 检查配置文件...${NC}"

if [ ! -f "backend/.env" ]; then
    echo -e "${YELLOW}backend/.env 不存在，自动生成...${NC}"

    # 生成随机密钥
    PG_PASS=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24)
    NEO4J_PASS=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24)
    JWT_SECRET=$(openssl rand -hex 32)
    ADMIN_KEY=$(openssl rand -hex 20)

    echo ""
    echo -e "${BLUE}请选择 AI 提供商：${NC}"
    echo "  1) DeepSeek（推荐，性价比高）"
    echo "  2) OpenAI"
    echo "  3) 暂时跳过（功能受限）"
    read -p "请输入选项 [1/2/3]: " LLM_CHOICE

    LLM_PROVIDER="mock"
    DEEPSEEK_KEY=""
    OPENAI_KEY=""

    case $LLM_CHOICE in
        1)
            LLM_PROVIDER="deepseek"
            read -p "请输入 DeepSeek API Key (sk-...): " DEEPSEEK_KEY
            ;;
        2)
            LLM_PROVIDER="openai"
            read -p "请输入 OpenAI API Key (sk-...): " OPENAI_KEY
            ;;
        *)
            LLM_PROVIDER="mock"
            echo -e "${YELLOW}⚠️  AI 功能将使用 mock 模式，可部署后在 backend/.env 中修改${NC}"
            ;;
    esac

    cat > backend/.env <<EOF
# ===================================
# CogniSync 生产环境配置（自动生成）
# 生成时间：$(date)
# ===================================

APP_ENV=production
DEBUG=false
LOG_LEVEL=INFO
LOG_FORMAT=text

# PostgreSQL（Docker 内网通信用 postgres 主机名）
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_USER=cognisync
POSTGRES_PASSWORD=${PG_PASS}
POSTGRES_DB=cognisync_db
DATABASE_URL=postgresql+asyncpg://cognisync:${PG_PASS}@postgres:5432/cognisync_db

# Neo4j
NEO4J_URI=bolt://neo4j:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=${NEO4J_PASS}
ENABLE_NEO4J_VECTOR_INDEX=false
EMBED_DIM=1536

# LLM 提供商
LLM_PROVIDER=${LLM_PROVIDER}
DEEPSEEK_API_KEY=${DEEPSEEK_KEY}
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat
OPENAI_API_KEY=${OPENAI_KEY}
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini

# 管理员密钥
ADMIN_KEY=${ADMIN_KEY}

# JWT 认证
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=1440

# CORS（部署时自动更新）
CORS_ORIGINS=http://localhost:3000,http://localhost:3001
EOF

    echo -e "${GREEN}✅ backend/.env 已生成${NC}"
    echo ""
    echo -e "${BLUE}━━━━ 自动生成的密钥（请保存好）━━━━${NC}"
    echo -e "  数据库密码:   ${GREEN}${PG_PASS}${NC}"
    echo -e "  Neo4j 密码:   ${GREEN}${NEO4J_PASS}${NC}"
    echo -e "  JWT 密钥:     ${GREEN}${JWT_SECRET}${NC}"
    echo -e "  管理员 Key:   ${GREEN}${ADMIN_KEY}${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
else
    echo -e "${GREEN}✅ 已存在 backend/.env${NC}"

    # 检查关键变量
    check_env() {
        local key=$1
        local value=$(grep "^${key}=" backend/.env | cut -d'=' -f2-)
        if [ -z "$value" ] || [[ "$value" == *"changeme"* ]] || [[ "$value" == *"your-"* ]]; then
            echo -e "${RED}❌ backend/.env 中 ${key} 未设置或仍为示例值${NC}"
            exit 1
        fi
    }

    check_env "JWT_SECRET"
    check_env "POSTGRES_PASSWORD"
    check_env "ADMIN_KEY"
    echo -e "${GREEN}✅ 配置检查通过${NC}"
fi

# ── 2. 获取服务器 IP 并更新前端配置 ────────────────────────
echo -e "\n${YELLOW}[2/5] 设置访问地址...${NC}"

SERVER_IP=$(curl -s --connect-timeout 5 ifconfig.me 2>/dev/null || \
            curl -s --connect-timeout 5 icanhazip.com 2>/dev/null || \
            hostname -I | awk '{print $1}')

if [ -z "$SERVER_IP" ]; then
    read -p "无法自动获取 IP，请手动输入服务器 IP 或域名: " SERVER_IP
fi

echo -e "  检测到服务器地址: ${GREEN}${SERVER_IP}${NC}"

# 更新前端 .env
echo "VITE_API_BASE_URL=http://${SERVER_IP}:18090" > frontend/.env
echo "VITE_API_BASE_URL=http://${SERVER_IP}:18090/api" > admin-frontend/.env

# 更新后端 CORS
sed -i "s|CORS_ORIGINS=.*|CORS_ORIGINS=http://${SERVER_IP}:18080,http://${SERVER_IP}:18081|" backend/.env

echo -e "${GREEN}✅ 访问地址已设置${NC}"

# ── 3. 同步 docker-compose 的 Neo4j 密码 ──────────────────
echo -e "\n${YELLOW}[3/5] 同步数据库密码...${NC}"

NEO4J_PASS=$(grep "^NEO4J_PASSWORD=" backend/.env | cut -d'=' -f2-)
PG_PASS=$(grep "^POSTGRES_PASSWORD=" backend/.env | cut -d'=' -f2-)

# 导出为环境变量供 docker-compose 使用
export POSTGRES_PASSWORD="${PG_PASS}"
export NEO4J_PASSWORD="${NEO4J_PASS}"

echo -e "${GREEN}✅ 数据库密码已同步${NC}"

# ── 4. 构建并启动 Docker 容器 ──────────────────────────────
echo -e "\n${YELLOW}[4/5] 构建 Docker 镜像（首次需要几分钟）...${NC}"
docker compose build --no-cache
echo -e "\n启动所有服务..."
docker compose up -d

# ── 5. 创建第一个管理员账号 ────────────────────────────────
echo -e "\n${YELLOW}[5/5] 等待服务就绪（约 15 秒）...${NC}"
sleep 15

ADMIN_KEY_VAL=$(grep "^ADMIN_KEY=" backend/.env | cut -d'=' -f2-)

echo -e "${BLUE}初始化管理员账号...${NC}"
RESULT=$(curl -s -X POST "http://localhost:18090/api/admin/auth/create-admin" \
    -H "X-ADMIN-KEY: ${ADMIN_KEY_VAL}" \
    -H "Content-Type: application/json" \
    -d '{"student_id":"admin","password":"Admin@2024!","name":"管理员"}' 2>/dev/null || echo "{}")

if echo "$RESULT" | grep -q '"success"'; then
    echo -e "${GREEN}✅ 管理员账号已创建${NC}"
    echo -e "   账号: ${GREEN}admin${NC}"
    echo -e "   密码: ${YELLOW}Admin@2024!${NC}  ← 请登录后立即修改！"
else
    echo -e "${YELLOW}ℹ️  管理员账号可能已存在，跳过创建${NC}"
fi

# ── 完成 ──────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   🎉 部署完成！                              ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}外网访问地址：${NC}"
echo -e "  用户前端:  ${GREEN}http://${SERVER_IP}:18080${NC}"
echo -e "  管理后台:  ${GREEN}http://${SERVER_IP}:18081${NC}"
echo -e "  后端 API:  ${GREEN}http://${SERVER_IP}:18090${NC}"
echo ""
echo -e "${YELLOW}⚠️  服务器防火墙需放开端口：18080、18081、18090${NC}"
echo -e "${YELLOW}⚠️  请立即登录管理后台修改默认密码！${NC}"
echo ""
echo -e "${BLUE}常用命令：${NC}"
echo -e "  查看日志:   docker compose logs -f backend"
echo -e "  重启服务:   docker compose restart"
echo -e "  停止服务:   docker compose down"
echo ""
