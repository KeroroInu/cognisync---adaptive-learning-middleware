"""
配置管理 - 使用 Pydantic Settings
所有配置从环境变量读取，支持 .env 文件
"""
from typing import List
from urllib.parse import quote_plus
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field


class Settings(BaseSettings):
    """应用配置"""

    # 应用基础配置
    APP_NAME: str = "CogniSync"
    APP_ENV: str = Field(default="development", alias="APP_ENV")
    DEBUG: bool = True
    API_PREFIX: str = "/api"

    # 服务器配置
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    # CORS 配置
    CORS_ORIGINS: str = Field(
        default="http://localhost:3000,http://localhost:5173",
        description="允许跨域的前端地址列表（逗号分隔）"
    )

    # PostgreSQL 配置
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str = "cognisync"
    POSTGRES_PASSWORD: str = "cognisync_dev_password_2024"
    POSTGRES_DB: str = "cognisync_db"
    DATABASE_URL: str = Field(
        default=""
    )
    DB_POOL_SIZE: int = Field(default=10, ge=2, le=100)
    DB_MAX_OVERFLOW: int = Field(default=20, ge=0, le=200)
    DB_POOL_TIMEOUT: int = Field(default=30, ge=1, le=120)

    # Neo4j 配置
    NEO4J_URI: str = "bolt://localhost:7687"
    NEO4J_USER: str = "neo4j"
    NEO4J_PASSWORD: str = "cognisync_neo4j_2024"

    # Neo4j 向量索引配置（可选）
    ENABLE_NEO4J_VECTOR_INDEX: bool = Field(
        default=False,
        description="是否启用 Neo4j 向量索引"
    )
    EMBED_DIM: int = Field(
        default=1536,
        description="Embedding 维度（默认 OpenAI text-embedding-3-small）"
    )

    # LLM Provider 配置
    LLM_PROVIDER: str = Field(
        default="mock",
        description="LLM 提供者: mock | openai | ollama | lmstudio | deepseek"
    )
    OPENAI_API_KEY: str = "sk-your-key-here"
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"
    OPENAI_MODEL: str = "gpt-4o-mini"
    OLLAMA_BASE_URL: str = "http://localhost:11434/v1"
    OLLAMA_MODEL: str = "llama3.2:latest"
    LMSTUDIO_BASE_URL: str = "http://localhost:1234/v1"
    LMSTUDIO_MODEL: str = "local-model"

    # DeepSeek 配置
    DEEPSEEK_API_KEY: str = "sk-your-key-here"
    DEEPSEEK_BASE_URL: str = "https://api.deepseek.com/v1"
    DEEPSEEK_MODEL: str = "deepseek-chat"
    LLM_TIMEOUT_SECONDS: int = Field(default=45, ge=5, le=180)
    LLM_MAX_CONCURRENCY: int = Field(default=12, ge=1, le=100)
    LLM_MAX_RETRIES: int = Field(default=2, ge=0, le=5)

    # Admin 管理员配置
    ADMIN_KEY: str = Field(
        default="",
        description="Admin API 认证密钥（⚠️ 生产环境必须设置！）"
    )

    # 默认管理员账号（首次启动自动创建，已存在则跳过）
    ADMIN_DEFAULT_STUDENT_ID: str = Field(
        default="",
        description="默认管理员学号"
    )
    ADMIN_DEFAULT_PASSWORD: str = Field(
        default="",
        description="默认管理员密码（首次部署后请及时修改）"
    )
    ADMIN_DEFAULT_NAME: str = Field(
        default="系统管理员",
        description="默认管理员姓名"
    )
    SEED_DEFAULT_ADMIN: bool = Field(
        default=False,
        description="是否在空库中创建默认管理员；生产环境应关闭并通过专用流程创建"
    )
    SEED_TEST_DATA: bool = Field(
        default=False,
        description="是否创建测试学生和演示数据；生产环境必须关闭"
    )

    # JWT 认证配置
    JWT_SECRET: str = Field(
        default="",
        description="JWT 签名密钥（⚠️ 生产环境必须设置强随机字符串！）"
    )
    JWT_EXPIRES_IN: int = Field(
        default=1440,
        description="JWT 过期时间（分钟），默认 24 小时"
    )

    # 日志配置
    LOG_LEVEL: str = "INFO"
    LOG_FORMAT: str = "json"  # json | text

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    @property
    def cors_origins_list(self) -> List[str]:
        """将 CORS_ORIGINS 字符串转换为列表"""
        if isinstance(self.CORS_ORIGINS, str):
            return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]
        return self.CORS_ORIGINS

    @property
    def database_url(self) -> str:
        """优先使用显式 DATABASE_URL；容器部署可通过离散 POSTGRES_* 参数安全组合。"""
        if self.DATABASE_URL:
            return self.DATABASE_URL
        return (
            f"postgresql+asyncpg://{quote_plus(self.POSTGRES_USER)}:{quote_plus(self.POSTGRES_PASSWORD)}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )


# 全局配置实例（单例）
settings = Settings()
