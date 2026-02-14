"""
配置管理 - 使用 Pydantic Settings
所有配置从环境变量读取，支持 .env 文件
"""
from typing import List
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
        default="postgresql+asyncpg://cognisync:cognisync_dev_password_2024@localhost:5432/cognisync_db"
    )

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

    # Admin 管理员配置
    ADMIN_KEY: str = Field(
        default="",
        description="Admin API 认证密钥（⚠️ 生产环境必须设置！）"
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


# 全局配置实例（单例）
settings = Settings()
