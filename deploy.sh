#!/bin/bash
# ============================================================
# CogniSync 打包脚本 —— 在本机运行，生成上传到服务器的压缩包
# 用法：bash deploy.sh
# ============================================================
set -e

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_NAME="cognisync-deploy"
OUTPUT="$PROJECT_ROOT/$PACKAGE_NAME.tar.gz"

echo "==> 打包目录: $PROJECT_ROOT"
echo "==> 输出文件: $OUTPUT"

tar -czf "$OUTPUT" \
  -C "$PROJECT_ROOT" \
  --exclude=".git" \
  --exclude="node_modules" \
  --exclude="*/node_modules" \
  --exclude="backend/venv" \
  --exclude="*/__pycache__" \
  --exclude="*.pyc" \
  --exclude="frontend/dist" \
  --exclude="admin-frontend/dist" \
  --exclude="$PACKAGE_NAME.tar.gz" \
  .

echo ""
echo "==> 打包完成！文件大小: $(du -sh "$OUTPUT" | cut -f1)"
echo ""
echo "==== 上传到服务器 ===="
echo "  scp $OUTPUT user@YOUR_SERVER_IP:/opt/cognisync/"
echo ""
echo "==== 服务器端操作 ===="
echo "  mkdir -p /opt/cognisync && cd /opt/cognisync"
echo "  tar -xzf cognisync-deploy.tar.gz"
echo "  docker compose up -d --build"
echo "  docker compose logs -f --tail=50"
echo ""
echo "==== 访问地址 ===="
echo "  用户前端:  http://YOUR_SERVER_IP:8002/"
echo "  管理后台:  http://YOUR_SERVER_IP:8002/admin/"
echo "  API 文档:  http://YOUR_SERVER_IP:8002/docs"
echo ""
echo "==== 默认管理员账号 ===="
echo "  账号: admin"
echo "  密码: Admin@2024"
echo "  (首次启动后请及时登录修改密码)"

