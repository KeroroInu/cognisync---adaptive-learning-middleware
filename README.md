# CogniSync

面向高中编程课堂的人智协同学习与过程证据采集平台。教师组织教学、发布问卷、记录课堂观察并导出数据；学生在浏览器中与 AI 讨论、编辑 Python、运行贪吃蛇。

两个课堂条件均可使用 AI：共同准备区用于简短对话和 Python 小实验，教师启动后进入各组课堂。项目解构组保留观察、功能表达、单功能流程与函数建构；常规 AI 协作组直接使用代码、游戏和对话工作区。平台提供研究材料与证据，不把画像、测试通过或卡片数量当作已经验证的学习效果。具体实现、验收和本机更新状态见开发文档。

教师可发布课堂资料和 Mac/Windows 本地 Pi 任务包、收取作品，并逐课查看学生/AI 对话与代码证据。包生成与 Mac 环境检查已通过，Windows 和学校机房仍待实测；本地 Pi 不等于服务器内嵌 Agent。

## 从这里开始

| 想了解什么 | 唯一维护入口 |
| --- | --- |
| 教学思路、两组差异、支架与评价边界 | [教学与研究设计](docs/TEACHING_DESIGN.md) |
| 系统组成、Agent、数据、权限与并发 | [系统架构](docs/ARCHITECTURE.md) |
| 当前开发状态、启动、测试、验收与待办 | [开发与运行](docs/DEVELOPMENT.md) |
| 全部资料与历史版本 | [文档目录](docs/README.md) |

当前维护目录是 `cognisync-classroom-acceptance`，分支为 `codex/classroom-export-completion`。不要把旧目录、旧端口或历史文档误当作最新运行版本；进入开发前先核对 Git 和监听进程，详见开发文档。

技术栈：React＋TypeScript＋Vite、FastAPI、PostgreSQL、Neo4j 和外部模型 API。Python 与游戏主要在学生浏览器 Worker 中执行，不在服务器为每名学生启动桌面环境。现有部署配置见 [Docker Compose](docker-compose.yml)；本次文档整理不代表已部署服务器。

后续只更新上表中的稳定文档，不再为每次讨论新建一个日期版设计文件。旧资料全文保存在 [历史档案](docs/archive/README.md)，用于追溯，不作为当前开发指令。
