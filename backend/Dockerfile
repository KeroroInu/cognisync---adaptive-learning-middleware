# ===================================
# CogniSync Backend - Python/FastAPI
# ===================================
FROM python:3.13-slim

WORKDIR /app

# 可选的镜像源。默认留空即走官方源，保持镜像在任何环境都能构建。
#
# 为什么需要这个：国内服务器访问 deb.debian.org 与 pypi.org 常常只有
# 100–200 KB/s，apt-get update 单是索引就要几分钟甚至挂住，构建根本走不完。
# 实测腾讯云内网镜像约 930 KB/s（快 6 倍且不计流量费）。
# 用法：
#   docker compose build \
#     --build-arg APT_MIRROR=http://mirrors.tencentyun.com/debian \
#     --build-arg PIP_INDEX_URL=https://mirrors.tencentyun.com/pypi/simple
ARG APT_MIRROR=""
ARG PIP_INDEX_URL=""

# 安装系统依赖
RUN if [ -n "$APT_MIRROR" ]; then \
        find /etc/apt -name '*.sources' -o -name '*.list' | xargs -r \
          sed -i "s|https\?://deb.debian.org/debian|${APT_MIRROR}|g; \
                   s|https\?://security.debian.org/debian-security|${APT_MIRROR}-security|g"; \
    fi && \
    apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 安装 Python 依赖
COPY requirements.txt .
RUN if [ -n "$PIP_INDEX_URL" ]; then \
        pip config set global.index-url "$PIP_INDEX_URL" && \
        pip config set global.trusted-host "$(echo "$PIP_INDEX_URL" | sed -E 's|https?://([^/]+).*|\1|')"; \
    fi && \
    pip install --no-cache-dir -r requirements.txt

# 复制项目代码
COPY . .

# 创建非 root 用户
RUN addgroup --gid 1001 appgroup && \
    adduser --uid 1001 --ingroup appgroup --disabled-password --gecos "" appuser && \
    chown -R appuser:appgroup /app

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
