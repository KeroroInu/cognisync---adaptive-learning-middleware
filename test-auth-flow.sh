#!/bin/bash

# CogniSync 完整注册流程测试脚本

echo "======================================"
echo "  CogniSync 注册流程测试"
echo "======================================"
echo ""

API_BASE="http://localhost:8000"
EMAIL="test-$(date +%s)@example.com"
PASSWORD="test123abc"
NAME="Test User"

echo "测试配置:"
echo "  Email: $EMAIL"
echo "  Password: $PASSWORD"
echo "  Name: $NAME"
echo ""

# Step 1: 注册用户（量表模式）
echo "[步骤 1/3] 注册新用户（量表模式）..."
REGISTER_RESPONSE=$(curl -s -X POST "$API_BASE/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"name\":\"$NAME\",\"mode\":\"scale\"}")

echo "注册响应:"
echo "$REGISTER_RESPONSE" | python3 -m json.tool || echo "$REGISTER_RESPONSE"
echo ""

# 提取token
TOKEN=$(echo "$REGISTER_RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('token', ''))" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  echo "❌ 注册失败：无法获取token"
  exit 1
fi

echo "✅ 注册成功，获得token: ${TOKEN:0:30}..."
echo ""

# Step 2: 使用token访问量表API
echo "[步骤 2/3] 使用token访问量表API..."
FORMS_RESPONSE=$(curl -s -X GET "$API_BASE/api/forms/active" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json")

echo "量表API响应:"
echo "$FORMS_RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(f\"模板名称: {data.get('name', 'N/A')}\"); print(f\"问题数量: {len(data.get('schema_json', {}).get('items', []))}\"); print(f\"版本: {data.get('version', 'N/A')}\")" 2>/dev/null || echo "$FORMS_RESPONSE"
echo ""

if echo "$FORMS_RESPONSE" | grep -q "detail"; then
  echo "❌ 量表API访问失败"
  echo "$FORMS_RESPONSE"
  exit 1
fi

echo "✅ 量表API访问成功"
echo ""

# Step 3: 注册另一个用户（AI模式）并测试
EMAIL_AI="test-ai-$(date +%s)@example.com"
echo "[步骤 3/3] 注册新用户（AI模式）..."

REGISTER_AI_RESPONSE=$(curl -s -X POST "$API_BASE/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL_AI\",\"password\":\"$PASSWORD\",\"name\":\"$NAME\",\"mode\":\"ai\"}")

TOKEN_AI=$(echo "$REGISTER_AI_RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('token', ''))" 2>/dev/null)

if [ -z "$TOKEN_AI" ]; then
  echo "❌ AI模式注册失败"
  exit 1
fi

echo "✅ AI模式注册成功"
echo ""

# 测试AI引导API
echo "测试AI引导API..."
AI_START_RESPONSE=$(curl -s -X POST "$API_BASE/api/onboarding/ai/start" \
  -H "Authorization: Bearer $TOKEN_AI" \
  -H "Content-Type: application/json")

echo "AI引导API响应:"
echo "$AI_START_RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(f\"Session ID: {data.get('sessionId', 'N/A')}\"); print(f\"第一个问题: {data.get('question', 'N/A')}\")" 2>/dev/null || echo "$AI_START_RESPONSE"
echo ""

if echo "$AI_START_RESPONSE" | grep -q "detail"; then
  echo "❌ AI引导API访问失败"
  echo "$AI_START_RESPONSE"
  exit 1
fi

echo "✅ AI引导API访问成功"
echo ""

echo "======================================"
echo "  ✅ 所有测试通过！"
echo "======================================"
echo ""
echo "测试总结:"
echo "  ✓ 用户注册（量表模式）"
echo "  ✓ Token生成和存储"
echo "  ✓ 量表API认证"
echo "  ✓ 用户注册（AI模式）"
echo "  ✓ AI引导API认证"
echo ""
echo "后端API工作正常！"
echo ""
echo "如果前端仍然401，请："
echo "1. 在浏览器中按 Cmd+Shift+R 强制刷新"
echo "2. F12 → Application → Storage → Clear storage"
echo "3. 重新注册并检查 Network 标签"
