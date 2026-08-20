# ===================================
# CogniSync 用户前端 - Vite + Nginx
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

# Pyodide 运行时（约 5.6 MB 压缩 / 13 MB 解压）打进镜像，学生端同源加载，
# 不依赖公共 CDN。下载动作由 package.json 的 prebuild 钩子触发，也就是随下面的
# `npm run build` 一起跑：脚本把文件写入 public/pyodide/，Vite 构建时原样复制到
# dist/。构建上下文里已带 public/pyodide/ 时（离线部署随代码上传），脚本会检测到
# 文件齐全并跳过下载，构建期无需访问 GitHub。
#
# 这里只负责装 bash：node:20-alpine 只有 busybox ash，而 fetch-pyodide.sh 用到
# 数组等 bash 语法，缺了会以 exit 127 失败。bash 只存在于这个被丢弃的构建阶段，
# 不进入最终的 nginx 镜像。
#
# APK_MIRROR 与后端的 APT_MIRROR / PIP_INDEX_URL 是同一套做法：默认留空走官方源，
# 国内服务器必须换镜像——Alpine 官方 CDN 实测装一个 bash 要 293 秒，构建看上去像
# 卡死；换成 https://mirrors.aliyun.com/alpine 后同一台机器上 0.06 秒就能拿到索引。
# 用法：--build-arg APK_MIRROR=https://mirrors.aliyun.com/alpine
ARG PYODIDE_VERSION=0.27.0
ARG PYODIDE_BASE_URL
ARG APK_MIRROR=""
ENV PYODIDE_VERSION=${PYODIDE_VERSION}
ENV PYODIDE_BASE_URL=${PYODIDE_BASE_URL}
RUN if [ -n "$APK_MIRROR" ]; then \
      find /etc/apk -name 'repositories' -o -name '*.repositories' | \
        xargs -r sed -i "s|https\?://dl-cdn.alpinelinux.org/alpine|${APK_MIRROR}|g"; \
    fi && \
    apk add --no-cache bash && \
    chmod +x scripts/fetch-pyodide.sh

RUN npm run build

# ── 生产镜像 ──
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
