import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/helpers.js';

const SYSTEM_SCHEMAS = [
  'pg_catalog',
  'information_schema',
  'graphql',
  'graphql_public',
  'vault',
  'extensions',
  'pgsodium',
  'pgsodium_masks',
  'supabase_functions',
  'supabase_migrations',
  'pg_toast',
  'net'
];

export async function exportRPCsSQL(sql, sqlDir) {
  logger.step('Exporting Database Functions & Triggers...');
  let sqlContent = `-- =============================================================\n`;
  sqlContent += `-- SUPABASE BACKUP: RPC FUNCTIONS & TRIGGERS\n`;
  sqlContent += `-- Generated: ${new Date().toISOString()}\n`;
  sqlContent += `-- =============================================================\n\n`;

  // 1. Functions & Stored Procedures
  const rpcs = await sql`
    SELECT 
      n.nspname AS schema_name,
      p.proname AS function_name,
      pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname NOT IN ${sql(SYSTEM_SCHEMAS)}
      AND n.nspname NOT LIKE 'pg_%'
    ORDER BY n.nspname, p.proname;
  `;

  sqlContent += `-- 1. Custom Functions & Procedures (${rpcs.length})\n\n`;
  for (const rpc of rpcs) {
    sqlContent += `-- Function: ${rpc.schema_name}.${rpc.function_name}\n`;
    sqlContent += `${rpc.definition.trim()};\n\n`;
  }

  // 2. Triggers
  const triggers = await sql`
    SELECT 
      event_object_schema,
      event_object_table,
      trigger_name,
      action_timing,
      event_manipulation,
      action_statement,
      action_orientation
    FROM information_schema.triggers
    WHERE trigger_schema NOT IN ${sql(SYSTEM_SCHEMAS)}
      AND trigger_schema NOT LIKE 'pg_%'
    ORDER BY event_object_schema, event_object_table, trigger_name;
  `;

  if (triggers.length > 0) {
    sqlContent += `-- 2. Triggers (${triggers.length})\n\n`;
    for (const t of triggers) {
      const fullTable = `"${t.event_object_schema}"."${t.event_object_table}"`;
      sqlContent += `DROP TRIGGER IF EXISTS "${t.trigger_name}" ON ${fullTable};\n`;
      sqlContent += `CREATE TRIGGER "${t.trigger_name}"\n`;
      sqlContent += `  ${t.action_timing} ${t.event_manipulation} ON ${fullTable}\n`;
      sqlContent += `  FOR EACH ${t.action_orientation}\n`;
      sqlContent += `  ${t.action_statement};\n\n`;
    }
  }

  const filePath = path.join(sqlDir, '03_rpc_functions.sql');
  await fs.writeFile(filePath, sqlContent, 'utf8');
  logger.success(`Saved functions and triggers: 03_rpc_functions.sql (${rpcs.length} functions, ${triggers.length} triggers)`);
}
