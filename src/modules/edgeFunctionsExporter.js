import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger, ensureDir } from '../utils/helpers.js';

const execAsync = promisify(exec);

export async function backupEdgeFunctions(config, baseDir) {
  logger.step('Exporting Edge Functions Metadata & Source Code...');
  const edgeDir = path.join(baseDir, 'edge_functions');
  await ensureDir(edgeDir);

  const { supabaseProjectRef, supabaseAccessToken } = config;

  if (!supabaseProjectRef || !supabaseAccessToken) {
    logger.warn('Skipping Edge Functions backup: SUPABASE_PROJECT_REF or SUPABASE_ACCESS_TOKEN not configured.');
    return { count: 0, skipped: true };
  }

  let functions = [];
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

    functions = await res.json();
    await fs.writeFile(
      path.join(edgeDir, 'functions_index.json'),
      JSON.stringify(functions, null, 2),
      'utf8'
    );
    logger.success(`Saved Edge Functions metadata: functions_index.json (${functions.length} functions)`);
  } catch (err) {
    logger.warn(`Could not fetch Edge Functions metadata: ${err.message}`);
  }

  // Next, attempt to download actual source code for each function
  const sourceDir = path.join(edgeDir, 'source');
  await ensureDir(sourceDir);

  // Check if supabase CLI or npx supabase is available
  let cliAvailable = false;
  let cliCmd = 'supabase';
  try {
    await execAsync('supabase --version');
    cliAvailable = true;
  } catch {
    try {
      await execAsync('npx -y supabase --version');
      cliAvailable = true;
      cliCmd = 'npx -y supabase';
    } catch {
      cliAvailable = false;
    }
  }

  let downloadedCount = 0;

  if (cliAvailable) {
    try {
      logger.info(`Attempting source code download via Supabase CLI (--use-api)...`);
      // Supabase CLI downloads into <workdir>/supabase/functions/<slug>
      const tempWorkDir = path.join(edgeDir, '.temp_cli');
      await ensureDir(tempWorkDir);

      const downloadCommand = `${cliCmd} functions download --project-ref ${supabaseProjectRef} --use-api --workdir "${tempWorkDir}"`;
      
      await execAsync(downloadCommand, {
        env: {
          ...process.env,
          SUPABASE_ACCESS_TOKEN: supabaseAccessToken
        }
      });

      // Move downloaded functions into source/
      const cliFunctionsDir = path.join(tempWorkDir, 'supabase', 'functions');
      try {
        const downloadedFolders = await fs.readdir(cliFunctionsDir);
        for (const item of downloadedFolders) {
          const srcPath = path.join(cliFunctionsDir, item);
          const destPath = path.join(sourceDir, item);
          await fs.cp(srcPath, destPath, { recursive: true });
          downloadedCount++;
        }
        // Cleanup temp dir
        await fs.rm(tempWorkDir, { recursive: true, force: true });
        logger.success(`Downloaded source code for ${downloadedCount} Edge Function(s) into edge_functions/source/`);
      } catch (copyErr) {
        logger.warn(`Could not organize downloaded function files: ${copyErr.message}`);
      }
    } catch (cliErr) {
      logger.warn(`Supabase CLI download attempt: ${cliErr.message.split('\n')[0]}`);
    }
  } else {
    logger.info('Supabase CLI not found. To download raw source code archives, install Supabase CLI or run with npx.');
  }

  return {
    count: functions.length,
    downloadedSources: downloadedCount,
    skipped: false
  };
}
