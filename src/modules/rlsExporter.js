import fs from 'fs/promises';
import path from 'path';
import { logger, escapeIdentifier } from '../utils/helpers.js';

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

export async function exportRLSSQL(sql, sqlDir) {
  logger.step('Exporting Row Level Security (RLS) Status & Policies...');
  let sqlContent = `-- =============================================================\n`;
  sqlContent += `-- SUPABASE BACKUP: ROW LEVEL SECURITY & POLICIES\n`;
  sqlContent += `-- Generated: ${new Date().toISOString()}\n`;
  sqlContent += `-- =============================================================\n\n`;

  // 1. Tables with RLS enabled
  const tables = await sql`
    SELECT c.relname AS table_name, n.nspname AS table_schema, c.relrowsecurity AS rls_enabled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ${sql(SYSTEM_SCHEMAS)}
      AND n.nspname NOT LIKE 'pg_%'
      AND c.relkind = 'r'
    ORDER BY n.nspname, c.relname;
  `;

  sqlContent += `-- 1. Enable Row Level Security on Tables\n`;
  for (const { table_schema, table_name, rls_enabled } of tables) {
    const fullTableName = `${escapeIdentifier(table_schema)}.${escapeIdentifier(table_name)}`;
    if (rls_enabled) {
      sqlContent += `ALTER TABLE ${fullTableName} ENABLE ROW LEVEL SECURITY;\n`;
    }
  }
  sqlContent += `\n`;

  // 2. Policies
  const policies = await sql`
    SELECT 
      schemaname, 
      tablename, 
      policyname, 
      permissive, 
      roles, 
      cmd, 
      qual, 
      with_check
    FROM pg_policies
    WHERE schemaname NOT IN ${sql(SYSTEM_SCHEMAS)}
      AND schemaname NOT LIKE 'pg_%'
    ORDER BY schemaname, tablename, policyname;
  `;

  sqlContent += `-- 2. Security Policies (${policies.length})\n\n`;
  for (const p of policies) {
    const rolesStr = p.roles && p.roles.length > 0 ? p.roles.join(', ') : 'PUBLIC';
    const tableName = `${escapeIdentifier(p.schemaname)}.${escapeIdentifier(p.tablename)}`;
    
    let policySql = `DROP POLICY IF EXISTS ${escapeIdentifier(p.policyname)} ON ${tableName};\n`;
    policySql += `CREATE POLICY ${escapeIdentifier(p.policyname)} ON ${tableName}\n`;
    policySql += `  AS ${p.permissive || 'PERMISSIVE'}\n`;
    policySql += `  FOR ${p.cmd}\n`;
    policySql += `  TO ${rolesStr}\n`;
    if (p.qual) {
      policySql += `  USING (${p.qual})\n`;
    }
    if (p.with_check) {
      policySql += `  WITH CHECK (${p.with_check})\n`;
    }
    policySql += `;\n\n`;

    sqlContent += policySql;
  }

  const filePath = path.join(sqlDir, '04_rls_policies.sql');
  await fs.writeFile(filePath, sqlContent, 'utf8');
  logger.success(`Saved RLS policies export: 04_rls_policies.sql (${policies.length} policies)`);
}
