#!/bin/bash
# 开发环境启动脚本 - 数据库

echo "🚀 Starting Databases (PostgreSQL + Redis)..."
docker-compose up -d postgres redis
echo "✅ Databases started successfully"
echo "📊 PostgreSQL: localhost:5432"
echo "📊 Redis: localhost:6379"
