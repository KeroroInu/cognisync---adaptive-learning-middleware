#!/usr/bin/env python3
"""Run once as root on a NEW server. Never reads or overwrites existing secrets."""
import os
from pathlib import Path
import secrets

os.umask(0o077)
root = Path('/etc/sfls')
root.mkdir(mode=0o700, exist_ok=True)
targets = [root / name for name in ('backend.env', 'postgres.env', 'neo4j.env')]
if any(path.exists() for path in targets):
    raise SystemExit('Existing configuration detected; refusing to rotate or overwrite secrets.')
postgres, neo4j = secrets.token_hex(32), secrets.token_hex(32)
backend = {
    'APP_ENV': 'production', 'DEBUG': 'false', 'LOG_FORMAT': 'json',
    'ADMIN_KEY': secrets.token_hex(32), 'JWT_SECRET': secrets.token_hex(48),
    'POSTGRES_USER': 'cognisync', 'POSTGRES_DB': 'cognisync_db',
    'POSTGRES_PASSWORD': postgres, 'POSTGRES_HOST': 'postgres',
    'NEO4J_USER': 'neo4j', 'NEO4J_PASSWORD': neo4j, 'NEO4J_URI': 'bolt://neo4j:7687',
    'CORS_ORIGINS': 'http://124.222.152.227', 'PUBLIC_BASE_URL': 'http://124.222.152.227',
    'DB_POOL_SIZE': '10', 'DB_MAX_OVERFLOW': '10',
    'LLM_PROVIDER': 'mock', 'LLM_PROJECT_TEXT_ANALYSIS': 'rules',
    'LLM_MAX_CONCURRENCY': '12', 'LLM_MAX_QUEUE': '80',
    'SEED_DEFAULT_ADMIN': 'false', 'SEED_TEST_DATA': 'false',
    'DEFAULT_EXPERIMENT_GROUP': 'unassigned',
}
for path, values in zip(targets, (backend, {key: backend[key] for key in ('POSTGRES_USER', 'POSTGRES_DB', 'POSTGRES_PASSWORD')}, {'NEO4J_AUTH': 'neo4j/' + neo4j})):
    with path.open('x') as stream:
        stream.write(''.join(f'{key}={value}\n' for key, value in values.items()))
print('Created private production configuration. AI provider still requires teacher configuration.')
