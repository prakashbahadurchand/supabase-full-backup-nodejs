import fs from 'fs/promises';
import path from 'path';

export const logger = {
  info: (msg) => console.log(`ℹ️  ${msg}`),
  step: (msg) => console.log(`\n▶️  ${msg}`),
  success: (msg) => console.log(`  ✅ ${msg}`),
  warn: (msg) => console.warn(`  ⚠️  ${msg}`),
  error: (msg, err) => {
    console.error(`  ❌ ${msg}`);
    if (err && err.message) console.error(`     Details: ${err.message}`);
  },
  banner: (title) => {
    console.log(`\n======================================================`);
    console.log(`🚀 ${title}`);
    console.log(`======================================================\n`);
  }
};

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export function escapeIdentifier(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function toSqlLiteral(val) {
  if (val === null || val === undefined) {
    return 'NULL';
  }
  if (typeof val === 'boolean') {
    return val ? 'TRUE' : 'FALSE';
  }
  if (typeof val === 'number') {
    if (Number.isFinite(val)) return val.toString();
    return `'${val}'`; // NaN, Infinity as string literal
  }
  if (val instanceof Date) {
    return `'${val.toISOString()}'::timestamptz`;
  }
  if (Buffer.isBuffer(val)) {
    return `'\\x${val.toString('hex')}'::bytea`;
  }
  if (Array.isArray(val)) {
    // Check if simple array or json
    return `'${JSON.stringify(val).replace(/'/g, "''")}'::jsonb`;
  }
  if (typeof val === 'object') {
    return `'${JSON.stringify(val).replace(/'/g, "''")}'::jsonb`;
  }

  // String handling with PostgreSQL dollar quoting or standard single-quote escaping
  const strVal = String(val);
  return `'${strVal.replace(/'/g, "''")}'`;
}

export function formatBytes(bytes, decimals = 2) {
  if (!+bytes) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}
