# ⚡ Supabase Full Backup Tool

[![Node.js Version](https://img.shields.io/badge/Node.js-v18%2B-brightgreen)](https://nodejs.org/)
[![Database](https://img.shields.io/badge/Database-PostgreSQL-blue)](https://www.postgresql.org/)
[![Platform](https://img.shields.io/badge/Platform-Supabase-emerald)](https://supabase.com/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A production-grade, modular Node.js utility for exporting complete Supabase projects. This tool extracts database schemas, custom ENUM types, primary/foreign keys, indexes, table records, stored procedures (RPCs), triggers, and Row Level Security (RLS) policies into **clean, executable `.sql` scripts**, while backing up Edge Function configurations and downloading all Storage Bucket assets.

---

## 🚀 Key Highlights & Enhancements

* **Modular Architecture**: Separate modules for Schemas, Data Inserts, RPC Functions & Triggers, RLS Policies, Storage, and Edge Functions under `src/modules/`.
* **Complete Schema Definitions**:
  * Preserves custom PostgreSQL schemas (skips internal Supabase/PG system schemas).
  * Automatically extracts custom ENUM types (`CREATE TYPE ... AS ENUM`).
  * Generates table definitions with `IDENTITY` columns, column defaults, and non-null constraints.
  * Restores Primary Keys (`PRIMARY KEY (...)`).
  * Exports Custom Indexes (`CREATE INDEX ...`).
  * Exports Foreign Key constraints wrapped in idempotent exception blocks.
* **Resilient Data Dumping**:
  * Memory-safe streaming batch exporter using `fs.createWriteStream`.
  * Configurable chunk size (`BACKUP_CHUNK_SIZE=1000`).
  * Uses `session_replication_role = 'replica'` to bypass foreign-key order conflicts on import.
  * Safe literal escaping for strings, numbers, dates, buffers (bytea), and JSON/JSONB objects.
* **Stored Procedures & Triggers**:
  * Extracts exact function signatures with `pg_get_functiondef()`.
  * Exports table triggers (`CREATE TRIGGER ...`).
* **RLS Policies**:
  * Recreates table RLS enablement (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`).
  * Recreates `AS PERMISSIVE / RESTRICTIVE`, `FOR [cmd]`, `TO [roles]`, `USING`, and `WITH CHECK` clauses with idempotent `DROP POLICY IF EXISTS`.
* **Storage Buckets & Asset Download**:
  * Automatic pagination for buckets with large numbers of assets.
  * Recursive directory crawling and downloads for nested folders.
  * Generates `buckets_manifest.json` preserving bucket metadata and access permissions.
* **Edge Functions Configuration**:
  * Fetches function deployment specs and endpoints via the Supabase Management API (optional if `SUPABASE_ACCESS_TOKEN` is provided).
* **Backup Manifest (`manifest.json`)**:
  * Summarizes timestamp, execution duration, and stage-by-stage status for auditing.

---

## 📂 Output Directory Structure

Each backup creates an isolated timestamped directory:

```text
backups/
└── backup-2026-09-27T17-00-00-000Z/
    ├── manifest.json                  # Overall run metadata & timings
    ├── sql_backup/
    │   ├── 01_schema_and_tables.sql  # 1️⃣ Schemas, ENUMs, Tables, PKs, Indexes, FKs
    │   ├── 02_data_inserts.sql       # 2️⃣ Streamed multi-row batch data inserts
    │   ├── 03_rpc_functions.sql      # 3️⃣ Custom functions, procedures & triggers
    │   └── 04_rls_policies.sql       # 4️⃣ Table RLS enablement & policies
    ├── edge_functions/
    │   └── functions_index.json      # Metadata & configs for Edge Functions
    └── storage/
        ├── buckets_manifest.json     # Storage bucket configurations
        ├── [bucket-name-1]/          # Mirrored local files & directories
        └── [bucket-name-2]/
```

---

## 🛠️ Prerequisites

* **Node.js**: `v18.0.0` or higher (tested on v20 and v24).
* **npm**: `v9.0.0` or higher.
* A target **Supabase** project.

---

## 📦 Installation & Setup

1. **Clone or Navigate to the Directory**:
   ```bash
   git clone <repo-url>
   cd supabase-full-backup-nodejs
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

---

## 🔑 Environment Variables

Edit your `.env` file with your credentials:

```env
# Supabase Core Credentials (Required)
SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOi..."

# Direct PostgreSQL Connection URI (Required)
SUPABASE_DB_URL="postgresql://postgres:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres"

# Optional: Supabase Management API (for Edge Functions backup)
SUPABASE_PROJECT_REF="YOUR_PROJECT_REF"
SUPABASE_ACCESS_TOKEN="sbp_..."

# Optional Configuration Flags
BACKUP_OUTPUT_DIR="backups"
BACKUP_CHUNK_SIZE=1000
STORAGE_LIST_LIMIT=100
```

### 📌 How to Obtain Credentials from Supabase Dashboard

| Variable Name | Step-by-Step UI Pathway in Supabase |
| --- | --- |
| **`SUPABASE_URL`** | Project Settings (gear icon) → **API** → Copy **Project URL**. |
| **`SUPABASE_SERVICE_ROLE_KEY`** | Project Settings → **API** → Locate `service_role` under **Project API keys** → Click **Reveal**.<br>⚠️ *Keep secret; bypasses Row Level Security.* |
| **`SUPABASE_DB_URL`** | Project Settings → **Database** → Scroll to **Connection string** → Select **URI** mode (Transaction pooler or Session pooler) → Replace password placeholder. |
| **`SUPABASE_PROJECT_REF`** | Project Settings → **General** → Copy **Reference ID** (or derived automatically from your URL). |
| **`SUPABASE_ACCESS_TOKEN`** | Account Settings (Profile avatar, top right) → **Access Tokens** → **Generate New Token**. *(Optional)* |

---

## 🏃 Execution

### 1. Full Backup

Run the full backup pipeline (schemas, data, RPCs, RLS, storage, edge functions):

```bash
make backup
```

*(Aliases: `make start`, `make run`, or `npm run backup`)*

---

### 2. Interactive Restore

To restore into your configured Supabase project:

```bash
make restore
```

*(Alias: `npm run restore`)*

The restore wizard will:
1. List all available backup runs chronologically.
2. Prompt you to pick the backup number.
3. Inspect and display what will be restored (Schemas, Data, RPCs, RLS, Storage Buckets, Edge Functions).
4. Display the target Supabase destination (URL & masked DB URI).
5. Require explicit confirmation: `Are you sure you want to restore to this database? (yes/no):`.
6. Apply schema, data, RPCs, RLS policies, and sync storage buckets in safe transactional batches.

---

## 🔁 Restoring to a Supabase Instance

To import your database backup into a target Supabase project:

1. Open your target Supabase project dashboard at [supabase.com](https://supabase.com).
2. Navigate to the **SQL Editor**.
3. Open and run the generated SQL files in exact order:
   * **`01_schema_and_tables.sql`**: Recreates schemas, custom ENUMs, tables, identity columns, primary keys, indexes, and foreign keys.
   * **`02_data_inserts.sql`**: Inserts all table rows with foreign key checking temporarily relaxed (`session_replication_role = 'replica'`).
   * **`03_rpc_functions.sql`**: Rebuilds custom SQL functions, procedures, and trigger bindings.
   * **`04_rls_policies.sql`**: Enables Row Level Security on your tables and attaches policies.
4. Upload local assets stored in `storage/` back to your buckets via the Supabase Dashboard or client script.

---

## 🔒 Security Best Practices

* **Keep `.env` private**: The `.env` file is included in `.gitignore` by default. Never commit sensitive service keys or connection strings.
* **Token Expiration**: Revoke temporary Management Access Tokens after standalone backups if they are not running on an automated cron server.

---

## 📜 License

This project is licensed under the MIT License - see the LICENSE file for details.