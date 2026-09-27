.PHONY: help install start backup clean check check-env

# Default target
all: help

## Display help message
help:
	@echo "================================================================"
	@echo "⚡ Supabase Full Backup Utility - Makefile Commands"
	@echo "================================================================"
	@echo "  make install     - Install npm dependencies"
	@echo "  make check-env   - Verify that .env file exists"
	@echo "  make start       - Run the full backup process (alias: make backup)"
	@echo "  make backup      - Run the full backup process"
	@echo "  make check       - Validate JavaScript syntax across all source files"
	@echo "  make clean       - Remove generated backups directory"
	@echo "================================================================"

## Install npm dependencies
install:
	@echo "📦 Installing npm dependencies..."
	npm install

## Check if .env exists
check-env:
	@if [ ! -f .env ]; then \
		echo "⚠️  .env file not found!"; \
		echo "👉 Please copy .env.example to .env and configure your credentials:"; \
		echo "   cp .env.example .env"; \
		exit 1; \
	else \
		echo "✅ .env file detected."; \
	fi

## Run syntax check
check:
	@echo "🔍 Checking JavaScript syntax..."
	node -c src/config.js
	node -c src/utils/helpers.js
	node -c src/modules/schemaExporter.js
	node -c src/modules/dataExporter.js
	node -c src/modules/rpcExporter.js
	node -c src/modules/rlsExporter.js
	node -c src/modules/edgeFunctionsExporter.js
	node -c src/modules/storageExporter.js
	node -c src/backup.js
	@echo "✅ All source files passed syntax check."

## Run the backup process
start: check-env
	@echo "🚀 Initiating backup process..."
	npm start

backup: start

## Clean backup directory
clean:
	@echo "🧹 Cleaning backups directory..."
	rm -rf backups
	@echo "✅ Backups directory removed."
