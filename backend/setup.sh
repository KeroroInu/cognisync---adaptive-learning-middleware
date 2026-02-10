#!/bin/bash
# 一键安装所有依赖

set -e

echo "🔧 安装 CogniSync 后端依赖..."
echo ""

cd "$(dirname "$0")"

# 检查 Python
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 未安装"
    exit 1
fi

echo "✅ Python 版本: $(python3 --version)"
echo ""

# 创建虚拟环境
if [ ! -d "venv" ]; then
    echo "📦 创建虚拟环境..."
    python3 -m venv venv
else
    echo "✅ 虚拟环境已存在"
fi

# 激活虚拟环境
echo "🔌 激活虚拟环境..."
source venv/bin/activate

# 升级 pip
echo "⬆️  升级 pip..."
pip install --upgrade pip -q

# 安装依赖
echo "📥 安装依赖包..."
pip install -q \
  fastapi \
  "uvicorn[standard]" \
  "sqlalchemy[asyncio]" \
  asyncpg \
  neo4j \
  pydantic \
  pydantic-settings \
  httpx \
  python-dotenv \
  email-validator

echo ""
echo "✅ 依赖安装完成！"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "下一步："
echo ""
echo "1️⃣  启动 Docker Desktop（手动打开应用）"
echo ""
echo "2️⃣  启动数据库："
echo "   docker-compose up -d"
echo ""
echo "3️⃣  启动服务："
echo "   source venv/bin/activate"
echo "   python3 -m uvicorn main:app --reload"
echo ""
echo "或直接运行："
echo "   ./run.sh"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
