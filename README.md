# CogniSync

面向高中编程课堂的人智协同学习与过程证据采集平台。教师发布任务、知识材料、问卷并回收作品；学生在共同工作台查看任务、选用需求文档/架构画板，下载到本机用 SFLS 完成，再提交代码与过程记录。

两个课堂条件使用相同界面、工具和支架，教学差异由教师引导和任务组织体现。Python 小实验和网页贪吃蛇作为可选工具保留，旧卡片与作品不删除。平台提供研究证据，不把运行完成、画像或卡片数量当作已验证的学习效果。具体实现、验收与部署状态见开发文档。

另设独立“体验组”，供代课或其他班级体验任意项目。教师将学生分入体验组后，可自定义任务并独立发布；仍使用同一 SFLS 安装程序和提交方式，不套用实验班的贪吃蛇课程序列。体验数据以 `experience` 标记保存，正式两组分析应明确筛选 `pdt` / `ai_pbl`，不能把全量导出默认当成实验样本。

SFLS 是基于 Pi SDK 的独立本地程序，源码在 [PI_SFLS](https://github.com/KeroroInu/PI_SFLS)，当前软件发行、安装入口和各系统的验收范围见[开发与运行](docs/DEVELOPMENT.md)。平台支持 Mac/Windows 任务包、本人跨课工程继承、设计版本和研究导出。平台不为每个学生启动服务器 Agent，也不会把教师密钥打入任务包。

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
