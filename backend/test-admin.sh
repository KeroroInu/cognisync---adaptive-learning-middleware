#!/bin/bash
# Admin API 测试运行脚本

echo "🧪 Running Admin API Tests..."
echo ""

# 激活虚拟环境（如果存在）
if [ -d "venv" ]; then
    source venv/bin/activate
fi

# 检查是否安装了开发依赖
if ! python -c "import pytest" 2>/dev/null; then
    echo "⚠️  pytest not found. Installing dev dependencies..."
    pip install -r requirements-dev.txt
    echo ""
fi

# 运行测试
pytest tests/test_admin_endpoints.py -v -s

echo ""
echo "✅ Tests completed!"
