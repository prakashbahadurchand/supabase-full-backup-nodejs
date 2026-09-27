import fs from 'fs/promises';
import path from 'path';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';

import { loadConfig } from './config.js';
import { logger, ensureDir } from './utils/helpers.js';
import { exportSchemaSQL } from './modules/schemaExporter.js';
import { exportDataSQL } from './modules/dataExporter.js';
import { exportRPCsSQL } from './modules/rpcExporter.js';
import { exportRLSSQL } from './modules/rlsExporter.js';
import { backupEdgeFunctions } from './modules/edgeFunctionsExporter.js';
import { backupStorage } from './modules/storageExporter.js';

export async function runBackup() {
  const startTime = Date.now();
  let config;

  try {
    config = loadConfig();
  } catch (err) {
    logger.error('Configuration Error', err);
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDirName = `backup-${timestamp}`;
  const baseDir = path.join(process.cwd(), config.outputDir, backupDirName);
  const sqlDir = path.join(baseDir, 'sql_backup');

  logger.banner(`SUPABASE FULL BACKUP TOOL v2.1.0\nTarget Directory: ${baseDir}`);

  await ensureDir(baseDir);
  await ensureDir(sqlDir);

  const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false }
  });

  const sql = postgres(config.supabaseDbUrl, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 30,
    onnotice: () => {} // Suppress noisy PG notices
  });

  const manifest = {
    version: '2.1.0',
    timestamp: new Date().toISOString(),
    projectRef: config.supabaseProjectRef,
    supabaseUrl: config.supabaseUrl,
    stages: {},
    durationMs: 0
  };

  try {
    // Stage 1: Schemas & Tables
    await exportSchemaSQL(sql, sqlDir);
    manifest.stages.schema = { status: 'success' };

    // Stage 2: Data Inserts
    await exportDataSQL(sql, sqlDir, config.chunkSize);
    manifest.stages.data = { status: 'success' };

    // Stage 3: Functions & Triggers
    await exportRPCsSQL(sql, sqlDir);
    manifest.stages.functions = { status: 'success' };

    // Stage 4: RLS & Policies
    await exportRLSSQL(sql, sqlDir);
    manifest.stages.rls = { status: 'success' };

    // Stage 5: Edge Functions
    const edgeResult = await backupEdgeFunctions(config, baseDir);
    manifest.stages.edgeFunctions = edgeResult;

    // Stage 6: Storage
    const storageResult = await backupStorage(supabase, baseDir, {
      batchLimit: config.storageBatchLimit
    });
    manifest.stages.storage = storageResult;

    manifest.durationMs = Date.now() - startTime;
    await fs.writeFile(
      path.join(baseDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf8'
    );

    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('\n======================================================');
    console.log(`🎉 BACKUP COMPLETED IN ${elapsedSeconds}s!`);
    console.log(`📂 Output: ${baseDir}`);
    console.log(`👉 To restore database:`);
    console.log(`   Run files in ${path.join(baseDir, 'sql_backup')} sequentially:`);
    console.log(`   1. 01_schema_and_tables.sql`);
    console.log(`   2. 02_data_inserts.sql`);
    console.log(`   3. 03_rpc_functions.sql`);
    console.log(`   4. 04_rls_policies.sql`);
    console.log('======================================================\n');
  } catch (err) {
    logger.error('Fatal backup error encountered', err);
    process.exitCode = 1;
  } finally {
    try {
      await sql.end({ timeout: 5 });
    } catch {
      // Ignore cleanup error
    }
  }
}

// Auto-run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runBackup();
}