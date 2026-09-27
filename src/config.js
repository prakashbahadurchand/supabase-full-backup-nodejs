import dotenv from 'dotenv';

dotenv.config();

const REQUIRED_CONFIGS = [
  { key: 'SUPABASE_URL', label: 'Supabase URL', required: true },
  { key: 'SUPABASE_SERVICE_ROLE_KEY', label: 'Supabase Service Role Key', required: true },
  { key: 'SUPABASE_DB_URL', label: 'Direct Database URL (Postgres)', required: true },
  { key: 'SUPABASE_PROJECT_REF', label: 'Project Reference ID', required: false },
  { key: 'SUPABASE_ACCESS_TOKEN', label: 'Management API Access Token', required: false }
];

export function loadConfig() {
  const missing = [];
  for (const item of REQUIRED_CONFIGS) {
    if (item.required && !process.env[item.key]) {
      missing.push(`${item.key} (${item.label})`);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s):\n  - ${missing.join('\n  - ')}\n` +
      `Please check your .env file or reference .env.example.`
    );
  }

  // Derive SUPABASE_PROJECT_REF from SUPABASE_URL if not provided
  let projectRef = process.env.SUPABASE_PROJECT_REF;
  if (!projectRef && process.env.SUPABASE_URL) {
    try {
      const url = new URL(process.env.SUPABASE_URL);
      const hostParts = url.hostname.split('.');
      if (hostParts.length >= 3 && hostParts[1] === 'supabase') {
        projectRef = hostParts[0];
      }
    } catch {
      // Ignore URL parse error here
    }
  }

  return {
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    supabaseDbUrl: process.env.SUPABASE_DB_URL,
    supabaseProjectRef: projectRef || '',
    supabaseAccessToken: process.env.SUPABASE_ACCESS_TOKEN || '',
    // Backup options
    chunkSize: parseInt(process.env.BACKUP_CHUNK_SIZE || '1000', 10),
    storageBatchLimit: parseInt(process.env.STORAGE_LIST_LIMIT || '100', 10),
    outputDir: process.env.BACKUP_OUTPUT_DIR || 'backups'
  };
}
