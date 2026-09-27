.PHONY: help install start run backup restore clean check check-env

# Default target
all: help

## Display help message
help:
	@echo "================================================================"
	@echo "⚡ Supabase Full Backup & Restore Utility"
	@echo "================================================================"
	@echo "  make backup      - Run full backup (schemas, data, RPCs, RLS, storage, functions)"
	@echo "  make restore     - Interactive restore wizard (select backup, review, confirm yes/no)"
	@echo "  make check       - Validate JavaScript syntax across all source files"
	@echo "  make check-env   - Verify that .env file exists"
	@echo "  make install     - Install npm dependencies"
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
	node -c src/restore.js
	@echo "✅ All source files passed syntax check."

## Run the backup process
backup: check-env
	@echo "🚀 Initiating full backup..."
	npm run backup

start: backup
run: backup

## Run interactive restore wizard
restore: check-env
	@node src/restore.js

## Clean backup directory
clean:
	@echo "🧹 Cleaning backups directory..."
	rm -rf backups
	@echo "✅ Backups directory removed."
