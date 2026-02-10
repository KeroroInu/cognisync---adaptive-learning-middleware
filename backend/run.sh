#!/bin/bash
# 运行服务（使用虚拟环境）

set -e

cd "$(dirname "$0")"

echo "🚀 启动 CogniSync 后端..."
echo ""

# 检查虚拟环境
if [ ! -d "venv" ]; then
    echo "❌ 虚拟环境不存在"
    echo "请先运行: ./setup.sh"
    exit 1
fi

# 激活虚拟环境
source venv/bin/activate

# 检查 Docker
if ! docker ps &> /dev/null; then
    echo "⚠️  Docker 未运行"
    echo "请启动 Docker Desktop，然后运行:"
    echo "  docker-compose up -d"
    echo ""
fi

# 显示配置
LLM_PROVIDER=$(grep "^LLM_PROVIDER=" .env 2>/dev/null | cut -d'=' -f2 | awk '{print $1}' || echo "未知")
echo "📡 LLM Provider: $LLM_PROVIDER"
echo ""

# 启动服务
echo "🌟 启动 FastAPI 服务..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "访问地址:"
echo "  - API 文档: http://localhost:8000/docs"
echo "  - 健康检查: http://localhost:8000/health"
echo "  - 聊天接口: http://localhost:8000/api/chat"
echo ""
echo "按 Ctrl+C 停止服务"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

python3 -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
