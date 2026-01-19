.PHONY: help install dev test lint format type-check clean db-migrate db-upgrade db-downgrade docker-up docker-down

# Default target
.DEFAULT_GOAL := help

# Colors for terminal output
GREEN  := $(shell tput -Txterm setaf 2)
YELLOW := $(shell tput -Txterm setaf 3)
RESET  := $(shell tput -Txterm sgr0)

help: ## Show this help message
	@echo '${GREEN}CogniSync Backend - Available Commands:${RESET}'
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  ${YELLOW}%-20s${RESET} %s\n", $$1, $$2}'

install: ## Install dependencies
	cd backend && pip install -e ".[dev]"

dev: ## Run development server
	cd backend && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

test: ## Run tests
	cd backend && pytest tests/ -v --cov=app --cov-report=html

lint: ## Run linter (ruff)
	cd backend && ruff check app/ tests/

format: ## Format code (ruff + black)
	cd backend && ruff format app/ tests/
	cd backend && ruff check app/ tests/ --fix

type-check: ## Run type checker (mypy)
	cd backend && mypy app/

clean: ## Clean cache and build files
	find . -type d -name "__pycache__" -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete
	find . -type f -name "*.pyo" -delete
	find . -type d -name "*.egg-info" -exec rm -rf {} +
	find . -type d -name ".pytest_cache" -exec rm -rf {} +
	find . -type d -name ".ruff_cache" -exec rm -rf {} +
	find . -type d -name ".mypy_cache" -exec rm -rf {} +
	rm -rf backend/htmlcov
	rm -rf backend/.coverage

db-migrate: ## Create new database migration
	@read -p "Enter migration message: " msg; \
	cd backend && alembic revision --autogenerate -m "$$msg"

db-upgrade: ## Apply database migrations
	cd backend && alembic upgrade head

db-downgrade: ## Rollback last database migration
	cd backend && alembic downgrade -1

docker-up: ## Start Docker containers
	docker-compose up -d

docker-down: ## Stop Docker containers
	docker-compose down

docker-logs: ## View Docker logs
	docker-compose logs -f backend

docker-build: ## Rebuild Docker images
	docker-compose build

docker-clean: ## Remove Docker containers and volumes
	docker-compose down -v
