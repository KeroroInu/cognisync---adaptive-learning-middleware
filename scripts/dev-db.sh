#!/bin/bash
# 开发环境启动脚本 - 数据库
#
# 本项目没有 Redis。此前这里写的是 `docker-compose up -d postgres redis`，
# 而 docker-compose.yml 里从来没有 redis 服务，照着跑必然报
# "no such service: redis"。实际需要的两个库是 PostgreSQL 和 Neo4j。

set -e

echo "🚀 Starting databases (PostgreSQL + Neo4j)..."
docker compose up -d postgres neo4j

echo "⏳ Waiting for health checks..."
docker compose ps postgres neo4j

echo "✅ Databases started"
echo "📊 PostgreSQL: localhost:5432"
echo "📊 Neo4j:      localhost:7474 (browser) / localhost:7687 (bolt)"
