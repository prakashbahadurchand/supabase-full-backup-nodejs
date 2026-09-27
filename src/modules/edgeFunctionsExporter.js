import fs from 'fs/promises';
import path from 'path';
import { logger, ensureDir } from '../utils/helpers.js';

export async function backupEdgeFunctions(config, baseDir) {
  logger.step('Exporting Edge Functions Metadata & Configuration...');
  const edgeDir = path.join(baseDir, 'edge_functions');
  await ensureDir(edgeDir);

  const { supabaseProjectRef, supabaseAccessToken } = config;

  if (!supabaseProjectRef || !supabaseAccessToken) {
    logger.warn('Skipping Edge Functions backup: SUPABASE_PROJECT_REF or SUPABASE_ACCESS_TOKEN not configured.');
    return { count: 0, skipped: true };
  }

  try {
    const url = `https://api.supabase.com/v1/projects/${encodeURIComponent(supabaseProjectRef)}/functions`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${supabaseAccessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!res.ok) {
      throw new Error(`Management API responded with status ${res.status}: ${res.statusText}`);
    }

    const functions = await res.json();
    const count = Array.isArray(functions) ? functions.length : 0;
    
    await fs.writeFile(
      path.join(edgeDir, 'functions_index.json'),
      JSON.stringify(functions, null, 2),
      'utf8'
    );
    
    logger.success(`Saved Edge Functions metadata: functions_index.json (${count} functions)`);
    return { count, skipped: false };
  } catch (err) {
    logger.warn(`Could not complete Edge Functions backup: ${err.message}`);
    return { count: 0, error: err.message };
  }
}
