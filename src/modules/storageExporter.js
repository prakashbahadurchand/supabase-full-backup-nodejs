import fs from 'fs/promises';
import path from 'path';
import { logger, ensureDir, formatBytes } from '../utils/helpers.js';

export async function backupStorage(supabase, baseDir, options = {}) {
  logger.step('Exporting Supabase Storage Buckets & Assets...');
  const storageDir = path.join(baseDir, 'storage');
  await ensureDir(storageDir);

  const { batchLimit = 100 } = options;

  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) {
    logger.error('Failed to list storage buckets', error);
    return { buckets: 0, files: 0, totalBytes: 0, error: error.message };
  }

  if (!buckets || buckets.length === 0) {
    logger.info('No storage buckets found in this project.');
    return { buckets: 0, files: 0, totalBytes: 0 };
  }

  // Save bucket configuration metadata
  await fs.writeFile(
    path.join(storageDir, 'buckets_manifest.json'),
    JSON.stringify(buckets, null, 2),
    'utf8'
  );
  logger.info(`Found ${buckets.length} bucket(s): ${buckets.map(b => b.name).join(', ')}`);

  let totalFiles = 0;
  let totalBytes = 0;

  for (const bucket of buckets) {
    const bucketFolder = path.join(storageDir, bucket.name);
    await ensureDir(bucketFolder);
    logger.info(`Downloading bucket: "${bucket.name}" (public: ${bucket.public})`);

    const stats = await downloadDirectory(supabase, bucket.name, '', bucketFolder, batchLimit);
    totalFiles += stats.files;
    totalBytes += stats.bytes;
    logger.success(`Bucket "${bucket.name}" complete: ${stats.files} file(s), ${formatBytes(stats.bytes)}`);
  }

  logger.success(`Storage download finished: ${totalFiles} file(s) across ${buckets.length} bucket(s), total ${formatBytes(totalBytes)}`);
  return { buckets: buckets.length, files: totalFiles, totalBytes };
}

async function downloadDirectory(supabase, bucketName, currentPrefix, targetLocalDir, batchLimit) {
  let stats = { files: 0, bytes: 0 };
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data: items, error } = await supabase.storage.from(bucketName).list(currentPrefix, {
      limit: batchLimit,
      offset: offset,
      sortBy: { column: 'name', order: 'asc' }
    });

    if (error) {
      logger.warn(`Error listing files in "${bucketName}/${currentPrefix}": ${error.message}`);
      break;
    }

    if (!items || items.length === 0) {
      break;
    }

    for (const item of items) {
      const itemRelativePath = currentPrefix ? `${currentPrefix}/${item.name}` : item.name;

      // In Supabase storage, folders often have id === null or metadata === null
      const isFolder = item.id === null || !item.metadata;

      if (isFolder) {
        const nestedLocalDir = path.join(targetLocalDir, item.name);
        await ensureDir(nestedLocalDir);
        const subStats = await downloadDirectory(supabase, bucketName, itemRelativePath, nestedLocalDir, batchLimit);
        stats.files += subStats.files;
        stats.bytes += subStats.bytes;
      } else {
        const localFilePath = path.join(targetLocalDir, item.name);
        try {
          const { data: fileBlob, error: downloadError } = await supabase.storage
            .from(bucketName)
            .download(itemRelativePath);

          if (downloadError) {
            logger.warn(`Failed to download "${itemRelativePath}": ${downloadError.message}`);
            continue;
          }

          if (fileBlob) {
            const buffer = Buffer.from(await fileBlob.arrayBuffer());
            await fs.writeFile(localFilePath, buffer);
            stats.files += 1;
            stats.bytes += buffer.length;
          }
        } catch (err) {
          logger.warn(`Download exception for "${itemRelativePath}": ${err.message}`);
        }
      }
    }

    if (items.length < batchLimit) {
      hasMore = false;
    } else {
      offset += items.length;
    }
  }

  return stats;
}
