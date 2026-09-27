import fs from 'fs';
import path from 'path';
import { logger, escapeIdentifier, toSqlLiteral } from '../utils/helpers.js';

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

export async function exportDataSQL(sql, sqlDir, chunkSize = 500) {
  logger.step('Exporting Table Data (Streaming batches)...');
  const filePath = path.join(sqlDir, '02_data_inserts.sql');
  const writeStream = fs.createWriteStream(filePath, { flags: 'w', encoding: 'utf8' });

  const write = (str) => {
    return new Promise((resolve, reject) => {
      if (!writeStream.write(str)) {
        writeStream.once('drain', resolve);
      } else {
        process.nextTick(resolve);
      }
    });
  };

  await write(`-- =============================================================\n`);
  await write(`-- SUPABASE BACKUP: TABLE DATA INSERTS\n`);
  await write(`-- Generated: ${new Date().toISOString()}\n`);
  await write(`-- =============================================================\n\n`);
  await write(`SET session_replication_role = 'replica';\n\n`);

  const tables = await sql`
    SELECT table_schema, table_name 
    FROM information_schema.tables 
    WHERE table_schema NOT IN ${sql(SYSTEM_SCHEMAS)}
      AND table_schema NOT LIKE 'pg_%'
      AND table_type = 'BASE TABLE'
    ORDER BY table_schema, table_name;
  `;

  let totalRows = 0;

  for (const { table_schema, table_name } of tables) {
    const fullTableName = `${escapeIdentifier(table_schema)}.${escapeIdentifier(table_name)}`;
    
    // Count rows first
    const [{ count }] = await sql.unsafe(`SELECT count(*)::bigint AS count FROM ${fullTableName};`);
    const rowCount = Number(count);

    if (rowCount === 0) {
      await write(`-- ${fullTableName}: 0 rows\n\n`);
      continue;
    }

    logger.info(`Exporting ${fullTableName} (${rowCount} rows)...`);
    await write(`-- Data for ${fullTableName} (${rowCount} rows)\n`);

    // Fetch primary key or first column to order deterministically if available
    let offset = 0;
    while (offset < rowCount) {
      const rows = await sql.unsafe(`SELECT * FROM ${fullTableName} LIMIT ${chunkSize} OFFSET ${offset};`);
      if (rows.length === 0) break;

      const cols = Object.keys(rows[0]).map(escapeIdentifier).join(', ');
      await write(`INSERT INTO ${fullTableName} (${cols}) VALUES\n`);

      const rowLines = rows.map((row) => {
        const values = Object.values(row).map(toSqlLiteral).join(', ');
        return `  (${values})`;
      });

      await write(rowLines.join(',\n') + ';\n\n');
      offset += rows.length;
      totalRows += rows.length;
    }
  }

  await write(`SET session_replication_role = 'origin';\n`);

  await new Promise((resolve, reject) => {
    writeStream.end(resolve);
    writeStream.on('error', reject);
  });

  logger.success(`Saved table data export: 02_data_inserts.sql (${totalRows} total rows)`);
}
