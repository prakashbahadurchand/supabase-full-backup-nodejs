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

export async function exportSchemaSQL(sql, sqlDir) {
  logger.step('Exporting Database Schemas, Custom Types, Tables, and Indexes...');
  let sqlContent = `-- =============================================================\n`;
  sqlContent += `-- SUPABASE BACKUP: SCHEMAS, CUSTOM TYPES, TABLES & INDEXES\n`;
  sqlContent += `-- Generated: ${new Date().toISOString()}\n`;
  sqlContent += `-- =============================================================\n\n`;

  // 1. Schemas
  const schemas = await sql`
    SELECT schema_name 
    FROM information_schema.schemata 
    WHERE schema_name NOT IN ${sql(SYSTEM_SCHEMAS)}
      AND schema_name NOT LIKE 'pg_%';
  `;

  if (schemas.length > 0) {
    sqlContent += `-- 1. Custom Schemas\n`;
    for (const { schema_name } of schemas) {
      if (schema_name !== 'public') {
        sqlContent += `CREATE SCHEMA IF NOT EXISTS ${escapeIdentifier(schema_name)};\n`;
      }
    }
    sqlContent += `\n`;
  }

  // 2. Custom Types / ENUMs
  const customEnums = await sql`
    SELECT 
      n.nspname AS schema_name,
      t.typname AS enum_name,
      e.enumlabel AS enum_value
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname NOT IN ${sql(SYSTEM_SCHEMAS)}
      AND n.nspname NOT LIKE 'pg_%'
    ORDER BY n.nspname, t.typname, e.enumsortorder;
  `;

  if (customEnums.length > 0) {
    sqlContent += `-- 2. Custom ENUM Types\n`;
    const enumGroups = {};
    for (const item of customEnums) {
      const key = `${escapeIdentifier(item.schema_name)}.${escapeIdentifier(item.enum_name)}`;
      if (!enumGroups[key]) enumGroups[key] = [];
      enumGroups[key].push(`'${item.enum_value.replace(/'/g, "''")}'`);
    }

    for (const [enumName, values] of Object.entries(enumGroups)) {
      sqlContent += `DO $$ BEGIN\n`;
      sqlContent += `  CREATE TYPE ${enumName} AS ENUM (${values.join(', ')});\n`;
      sqlContent += `EXCEPTION WHEN duplicate_object THEN null;\n`;
      sqlContent += `END $$;\n\n`;
    }
  }

  // 3. Tables and Column Definitions (including Identity / Primary keys)
  const columns = await sql`
    SELECT 
      c.table_schema, 
      c.table_name, 
      c.column_name, 
      c.data_type, 
      c.udt_name,
      c.udt_schema,
      c.is_nullable, 
      c.column_default,
      c.is_identity,
      c.identity_generation
    FROM information_schema.columns c
    JOIN information_schema.tables t 
      ON c.table_schema = t.table_schema AND c.table_name = t.table_name
    WHERE c.table_schema NOT IN ${sql(SYSTEM_SCHEMAS)}
      AND c.table_schema NOT LIKE 'pg_%'
      AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_schema, c.table_name, c.ordinal_position;
  `;

  // Fetch Primary Keys
  const primaryKeys = await sql`
    SELECT 
      kcu.table_schema,
      kcu.table_name,
      kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema NOT IN ${sql(SYSTEM_SCHEMAS)}
    ORDER BY kcu.table_schema, kcu.table_name, kcu.ordinal_position;
  `;

  const pkMap = {};
  for (const pk of primaryKeys) {
    const key = `${escapeIdentifier(pk.table_schema)}.${escapeIdentifier(pk.table_name)}`;
    if (!pkMap[key]) pkMap[key] = [];
    pkMap[key].push(escapeIdentifier(pk.column_name));
  }

  const tables = {};
  for (const col of columns) {
    const key = `${escapeIdentifier(col.table_schema)}.${escapeIdentifier(col.table_name)}`;
    if (!tables[key]) tables[key] = [];
    tables[key].push(col);
  }

  sqlContent += `-- 3. Tables Structure\n`;
  for (const [tableKey, cols] of Object.entries(tables)) {
    sqlContent += `CREATE TABLE IF NOT EXISTS ${tableKey} (\n`;
    const colDefs = cols.map(c => {
      let type = c.data_type;
      if (c.data_type === 'USER-DEFINED') {
        type = c.udt_schema && c.udt_schema !== 'public' && c.udt_schema !== 'pg_catalog'
          ? `${escapeIdentifier(c.udt_schema)}.${escapeIdentifier(c.udt_name)}`
          : escapeIdentifier(c.udt_name);
      } else if (c.data_type === 'ARRAY') {
        // e.g. _text -> text[]
        const baseType = c.udt_name.startsWith('_') ? c.udt_name.slice(1) : c.udt_name;
        type = `${baseType}[]`;
      }

      let identityDef = '';
      if (c.is_identity === 'YES') {
        identityDef = ` GENERATED ${c.identity_generation || 'BY DEFAULT'} AS IDENTITY`;
      }

      const nullable = c.is_nullable === 'NO' ? ' NOT NULL' : '';
      const defaultVal = c.column_default ? ` DEFAULT ${c.column_default}` : '';
      return `  ${escapeIdentifier(c.column_name)} ${type}${identityDef}${nullable}${defaultVal}`;
    });

    if (pkMap[tableKey] && pkMap[tableKey].length > 0) {
      colDefs.push(`  PRIMARY KEY (${pkMap[tableKey].join(', ')})`);
    }

    sqlContent += colDefs.join(',\n');
    sqlContent += `\n);\n\n`;
  }

  // 4. Custom Indexes
  const indexes = await sql`
    SELECT 
      schemaname,
      tablename,
      indexname,
      indexdef
    FROM pg_indexes
    WHERE schemaname NOT IN ${sql(SYSTEM_SCHEMAS)}
      AND schemaname NOT LIKE 'pg_%'
      AND indexname NOT LIKE '%_pkey';
  `;

  if (indexes.length > 0) {
    sqlContent += `-- 4. Indexes\n`;
    for (const idx of indexes) {
      sqlContent += `${idx.indexdef};\n`;
    }
    sqlContent += `\n`;
  }

  // 5. Foreign Key Constraints
  const foreignKeys = await sql`
    SELECT
      tc.table_schema,
      tc.table_name,
      tc.constraint_name,
      kcu.column_name,
      ccu.table_schema AS foreign_table_schema,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name,
      rc.update_rule,
      rc.delete_rule
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.referential_constraints AS rc
      ON tc.constraint_name = rc.constraint_name
      AND tc.table_schema = rc.constraint_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema NOT IN ${sql(SYSTEM_SCHEMAS)};
  `;

  if (foreignKeys.length > 0) {
    sqlContent += `-- 5. Foreign Keys\n`;
    for (const fk of foreignKeys) {
      const sourceTable = `${escapeIdentifier(fk.table_schema)}.${escapeIdentifier(fk.table_name)}`;
      const targetTable = `${escapeIdentifier(fk.foreign_table_schema)}.${escapeIdentifier(fk.foreign_table_name)}`;
      sqlContent += `DO $$ BEGIN\n`;
      sqlContent += `  ALTER TABLE ${sourceTable} ADD CONSTRAINT ${escapeIdentifier(fk.constraint_name)}\n`;
      sqlContent += `    FOREIGN KEY (${escapeIdentifier(fk.column_name)}) REFERENCES ${targetTable} (${escapeIdentifier(fk.foreign_column_name)})\n`;
      sqlContent += `    ON UPDATE ${fk.update_rule} ON DELETE ${fk.delete_rule};\n`;
      sqlContent += `EXCEPTION WHEN duplicate_object THEN null;\n`;
      sqlContent += `END $$;\n\n`;
    }
  }

  const filePath = path.join(sqlDir, '01_schema_and_tables.sql');
  await fs.writeFile(filePath, sqlContent, 'utf8');
  logger.success(`Saved schema export: 01_schema_and_tables.sql (${Object.keys(tables).length} tables found)`);
}
