import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';

import { loadConfig } from './config.js';
import { logger, formatBytes } from './utils/helpers.js';

function ask(rl, query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function listBackups(backupsDir) {
  try {
    const entries = await fs.readdir(backupsDir, { withFileTypes: true });
    const backupFolders = entries
      .filter((e) => e.isDirectory() && e.name.startsWith('backup-'))
      .map((e) => e.name)
      .sort()
      .reverse(); // newest first
    return backupFolders;
  } catch {
    return [];
  }
}

async function inspectBackup(backupPath) {
  const info = {
    path: backupPath,
    hasSchema: false,
    hasData: false,
    hasRPCs: false,
    hasRLS: false,
    hasStorage: false,
    hasEdgeFunctions: false,
    storageBuckets: [],
    edgeFunctions: []
  };

  const sqlDir = path.join(backupPath, 'sql_backup');
  try {
    const files = await fs.readdir(sqlDir);
    info.hasSchema = files.includes('01_schema_and_tables.sql');
    info.hasData = files.includes('02_data_inserts.sql');
    info.hasRPCs = files.includes('03_rpc_functions.sql');
    info.hasRLS = files.includes('04_rls_policies.sql');
  } catch {
    // sqlDir might not exist
  }

  const storageDir = path.join(backupPath, 'storage');
  try {
    const buckets = await fs.readdir(storageDir, { withFileTypes: true });
    info.storageBuckets = buckets.filter((b) => b.isDirectory()).map((b) => b.name);
    info.hasStorage = info.storageBuckets.length > 0;
  } catch {
    // storageDir might not exist
  }

  const edgeDir = path.join(backupPath, 'edge_functions', 'source');
  try {
    const funcs = await fs.readdir(edgeDir, { withFileTypes: true });
    info.edgeFunctions = funcs.filter((f) => f.isDirectory()).map((f) => f.name);
    info.hasEdgeFunctions = info.edgeFunctions.length > 0;
  } catch {
    // edgeDir might not exist
  }

  return info;
}

async function executeSqlFile(sql, filePath, label) {
  logger.info(`Applying ${label} (${path.basename(filePath)})...`);
  const content = await fs.readFile(filePath, 'utf8');
  if (!content.trim()) {
    logger.info(`  File is empty, skipping.`);
    return;
  }
  await sql.unsafe(content);
  logger.success(`Applied ${label} successfully.`);
}

async function restoreStorage(supabase, backupPath, bucketNames) {
  logger.step('Restoring Storage Buckets and Objects...');
  const storageDir = path.join(backupPath, 'storage');

  // Read manifest if available
  let manifestBuckets = [];
  try {
    const manifestRaw = await fs.readFile(path.join(storageDir, 'buckets_manifest.json'), 'utf8');
    manifestBuckets = JSON.parse(manifestRaw);
  } catch {
    // fallback
  }

  const { data: existingBuckets } = await supabase.storage.listBuckets();
  const existingMap = new Set((existingBuckets || []).map((b) => b.name));

  for (const bucketName of bucketNames) {
    const bucketInfo = manifestBuckets.find((b) => b.name === bucketName) || { public: false };
    
    // Ensure bucket exists in target project
    if (!existingMap.has(bucketName)) {
      logger.info(`Creating bucket "${bucketName}" (public: ${bucketInfo.public})...`);
      const { error: createErr } = await supabase.storage.createBucket(bucketName, {
        public: bucketInfo.public
      });
      if (createErr && !createErr.message.includes('already exists')) {
        logger.warn(`Could not create bucket "${bucketName}": ${createErr.message}`);
      }
    }

    const bucketPath = path.join(storageDir, bucketName);
    const uploaded = await uploadFolderRecursive(supabase, bucketName, bucketPath, '');
    logger.success(`Bucket "${bucketName}": uploaded ${uploaded} file(s).`);
  }
}

async function uploadFolderRecursive(supabase, bucketName, localDir, targetPrefix) {
  let count = 0;
  let items;
  try {
    items = await fs.readdir(localDir, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const item of items) {
    const localPath = path.join(localDir, item.name);
    const remotePath = targetPrefix ? `${targetPrefix}/${item.name}` : item.name;

    if (item.isDirectory()) {
      count += await uploadFolderRecursive(supabase, bucketName, localPath, remotePath);
    } else {
      const fileBuffer = await fs.readFile(localPath);
      const { error } = await supabase.storage.from(bucketName).upload(remotePath, fileBuffer, {
        upsert: true
      });
      if (error) {
        logger.warn(`Failed to upload "${remotePath}" to "${bucketName}": ${error.message}`);
      } else {
        count++;
      }
    }
  }
  return count;
}

export async function runRestore() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    let config;
    try {
      config = loadConfig();
    } catch (err) {
      logger.error('Configuration Error', err);
      process.exit(1);
    }

    const backupsBaseDir = path.join(process.cwd(), config.outputDir);
    const backups = await listBackups(backupsBaseDir);

    if (backups.length === 0) {
      logger.warn(`No backups found in ${backupsBaseDir}`);
      rl.close();
      return;
    }

    console.log('\n======================================================');
    console.log('🔄 SUPABASE RESTORE WIZARD');
    console.log('======================================================');
    console.log('\nAvailable Backups:');
    backups.forEach((b, idx) => {
      console.log(`  [${idx + 1}] ${b}`);
    });

    let selectedBackup = null;
    while (!selectedBackup) {
      const choice = await ask(rl, `\nSelect a backup number to restore (1-${backups.length}) [default: 1]: `);
      const trimmed = choice.trim();
      const num = trimmed === '' ? 1 : parseInt(trimmed, 10);
      if (num >= 1 && num <= backups.length) {
        selectedBackup = backups[num - 1];
      } else {
        console.log('Invalid choice. Please enter a valid number.');
      }
    }

    const backupPath = path.join(backupsBaseDir, selectedBackup);
    const info = await inspectBackup(backupPath);

    console.log('\n------------------------------------------------------');
    console.log(`📦 Selected Backup: ${selectedBackup}`);
    console.log('------------------------------------------------------');
    console.log('Contents detected:');
    console.log(`  • 01 Schema & Tables   : ${info.hasSchema ? '✅ Available' : '❌ Not found'}`);
    console.log(`  • 02 Table Data        : ${info.hasData ? '✅ Available' : '❌ Not found'}`);
    console.log(`  • 03 RPCs & Triggers   : ${info.hasRPCs ? '✅ Available' : '❌ Not found'}`);
    console.log(`  • 04 RLS Policies      : ${info.hasRLS ? '✅ Available' : '❌ Not found'}`);
    console.log(`  • Storage Buckets      : ${info.hasStorage ? `✅ (${info.storageBuckets.join(', ')})` : '⚪ None'}`);
    console.log(`  • Edge Functions       : ${info.hasEdgeFunctions ? `✅ (${info.edgeFunctions.join(', ')})` : '⚪ None'}`);
    console.log('------------------------------------------------------');

    // Confirm target destination
    const maskedDb = config.supabaseDbUrl.replace(/:[^:@]+@/, ':****@');
    console.log(`\n⚠️  TARGET DESTINATION:`);
    console.log(`  • Supabase URL: ${config.supabaseUrl}`);
    console.log(`  • Database URI: ${maskedDb}`);

    const confirmAnswer = await ask(rl, '\nAre you sure you want to restore to this database? (yes/no): ');
    if (confirmAnswer.trim().toLowerCase() !== 'yes' && confirmAnswer.trim().toLowerCase() !== 'y') {
      console.log('\n❌ Restore aborted by user.\n');
      rl.close();
      return;
    }

    rl.close();

    // Start restore process
    logger.banner('STARTING RESTORE PROCESS');
    const startTime = Date.now();

    const sql = postgres(config.supabaseDbUrl, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 30,
      onnotice: () => {}
    });

    const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false }
    });

    try {
      const sqlDir = path.join(backupPath, 'sql_backup');

      // 1. Schema
      if (info.hasSchema) {
        await executeSqlFile(sql, path.join(sqlDir, '01_schema_and_tables.sql'), '1. Schema & Tables');
      }

      // 2. Data
      if (info.hasData) {
        await executeSqlFile(sql, path.join(sqlDir, '02_data_inserts.sql'), '2. Table Data');
      }

      // 3. RPC & Triggers
      if (info.hasRPCs) {
        await executeSqlFile(sql, path.join(sqlDir, '03_rpc_functions.sql'), '3. RPC Functions & Triggers');
      }

      // 4. RLS Policies
      if (info.hasRLS) {
        await executeSqlFile(sql, path.join(sqlDir, '04_rls_policies.sql'), '4. Row Level Security Policies');
      }

      // 5. Storage
      if (info.hasStorage && info.storageBuckets.length > 0) {
        await restoreStorage(supabase, backupPath, info.storageBuckets);
      }

      // Edge functions notice
      if (info.hasEdgeFunctions) {
        console.log('\n⚡ Edge Functions Notice:');
        console.log(`   Source files are preserved in: ${path.join(backupPath, 'edge_functions', 'source')}`);
        console.log(`   To deploy any function to Supabase:`);
        console.log(`   supabase functions deploy <function-name> --project-ref ${config.supabaseProjectRef || 'YOUR_REF'}`);
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log('\n======================================================');
      console.log(`🎉 RESTORE COMPLETED IN ${elapsed}s!`);
      console.log('======================================================\n');
    } finally {
      await sql.end({ timeout: 5 });
    }
  } catch (err) {
    logger.error('Restore failed', err);
    process.exitCode = 1;
  }
}

// Auto-run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runRestore();
}
