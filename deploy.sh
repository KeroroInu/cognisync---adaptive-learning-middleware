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
echo "  用户前端:  http://YOUR_SERVER_IP:8003/"
echo "  管理后台:  http://YOUR_SERVER_IP:8003/admin/"
echo "  API 文档:  http://YOUR_SERVER_IP:8003/docs"
echo ""
echo "提示：系统不再创建 admin/admin 默认账号，请使用部署时设置的安全管理员凭据。"
