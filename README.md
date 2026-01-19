# CogniSync - Adaptive Learning Middleware

前后端分离的教育智能体中间件项目。

## 📂 项目结构

```
cognisync/
├── frontend/                 # 前端项目 (React + TypeScript + Vite)
│   ├── App.tsx
│   ├── components/
│   ├── views/
│   ├── services/
│   └── package.json
│
├── backend/                  # 后端项目 (FastAPI + Python 3.11+)
│   ├── app/
│   │   ├── main.py
│   │   ├── api/
│   │   ├── schemas/
│   │   ├── models/
│   │   ├── services/
│   │   └── middlewares/
│   ├── tests/
│   ├── Dockerfile
│   └── README.md
│
├── docker-compose.yml        # Docker Compose 配置
├── Makefile                  # 自动化命令
└── README.md                 # 本文件
```

## 🚀 快速开始

### 前端

```bash
cd frontend
npm install
npm run dev
```

访问: http://localhost:3000

详见 [frontend/README.md](frontend/README.md)

### 后端

```bash
cd backend
pip install -e ".[dev]"
uvicorn app.main:app --reload
```

访问: http://localhost:8000/docs

详见 [backend/README.md](backend/README.md)

### Docker Compose（推荐）

```bash
# 启动所有服务
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

## 📖 文档

- [完整项目规格文档](docs/PROJECT_SPECIFICATION.md)
- [API 实现指南](docs/API_IMPLEMENTATION_GUIDE.md)
- [后端 README](backend/README.md)
- [API 文档 (Swagger)](http://localhost:8000/docs)

## 🛠️ 技术栈

### 前端
- React 19.2 + TypeScript 5.8
- Vite 6.2
- D3.js + Recharts
- Tailwind CSS

### 后端
- FastAPI + Python 3.11+
- SQLAlchemy 2.0 + Pydantic v2
- PostgreSQL + Redis
- Docker + Docker Compose

## 📝 开发命令

查看所有可用命令:

```bash
make help
```

## 📄 许可证

MIT License
