# ===================================
# CogniSync 管理后台 - Vite + Nginx
# ===================================
FROM node:20-alpine AS builder

WORKDIR /app

# 可选的 npm 镜像源，默认留空走官方 registry。
# 国内服务器 registry.npmjs.org 往往只有一两百 KB/s，npm install 会拖到超时。
# 用法：--build-arg NPM_REGISTRY=https://registry.npmmirror.com
ARG NPM_REGISTRY=""

COPY package*.json ./
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi && \
    npm install
COPY . .
RUN npm run build

# ── 生产镜像 ──
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
