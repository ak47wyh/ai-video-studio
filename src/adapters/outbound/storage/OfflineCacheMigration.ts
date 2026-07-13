import type { GeneratedFile } from '../../../domain/entities/models';

/**
 * OfflineCache → OPFS 数据迁移工具。
 *
 * 在应用首次启动时运行，将旧 `minimax-offline-cache` IndexedDB 中的
 * Blob 数据迁移到新的 OPFS / IndexedDB 文件存储层。
 *
 * 迁移完成后在 localStorage 中标记 `file_storage_migrated=true`，
 * 后续启动不再重复迁移。
 */

const OLD_DB_NAME = 'minimax-offline-cache';
const OLD_DB_VERSION = 1;
const OLD_BLOB_STORE = 'blobs';
const OLD_META_STORE = 'meta';
const MIGRATION_FLAG_KEY = 'file_storage_migrated';
/** P0 修复：失败的 key 持久化到 localStorage，下次启动时重试，避免数据永久丢失 */
const MIGRATION_FAILED_KEYS_KEY = 'file_storage_migration_failed_keys';

interface OldCacheMeta {
  key: string;
  size: number;
  contentType: string;
  lastAccessed: number;
  createdAt: number;
}

/**
 * 检查是否需要迁移。
 *
 * P0 修复：当且仅当「未标记完成」或「存在失败的 key 待重试」时返回 true。
 */
export function needsMigration(): boolean {
  try {
    const migrated = localStorage.getItem(MIGRATION_FLAG_KEY);
    const failedKeys = localStorage.getItem(MIGRATION_FAILED_KEYS_KEY);
    return !migrated || (failedKeys !== null && failedKeys !== '[]');
  } catch {
    return true; // localStorage 不可用时默认执行迁移
  }
}

/**
 * 标记迁移完成。
 */
function markMigrated(): void {
  try {
    localStorage.setItem(MIGRATION_FLAG_KEY, 'true');
    // 全部成功后清除失败 key 列表
    localStorage.removeItem(MIGRATION_FAILED_KEYS_KEY);
  } catch {
    // 忽略
  }
}

/**
 * P0 修复：持久化失败的 key 列表，下次启动时 needsMigration 会返回 true 触发重试。
 */
function persistFailedKeys(keys: string[]): void {
  try {
    if (keys.length === 0) {
      localStorage.removeItem(MIGRATION_FAILED_KEYS_KEY);
    } else {
      localStorage.setItem(MIGRATION_FAILED_KEYS_KEY, JSON.stringify(keys));
    }
  } catch {
    // 忽略
  }
}

/**
 * P0 修复：读取上次失败待重试的 key 集合。
 */
function loadFailedKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(MIGRATION_FAILED_KEYS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

/**
 * 打开旧的 OfflineCache IndexedDB。
 */
function openOldDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OLD_DB_NAME, OLD_DB_VERSION);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * 读取旧库中所有 Blob 和元数据。
 */
async function readOldEntries(db: IDBDatabase): Promise<{ key: string; blob: Blob; meta: OldCacheMeta }[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([OLD_BLOB_STORE, OLD_META_STORE], 'readonly');
    const blobStore = tx.objectStore(OLD_BLOB_STORE);
    const metaStore = tx.objectStore(OLD_META_STORE);

    const results: { key: string; blob: Blob; meta: OldCacheMeta }[] = [];

    const metaReq = metaStore.getAll();
    metaReq.onsuccess = () => {
      const metas = (metaReq.result as OldCacheMeta[]) || [];

      let completed = 0;
      if (metas.length === 0) {
        resolve([]);
        return;
      }

      for (const meta of metas) {
        const blobReq = blobStore.get(meta.key);
        blobReq.onsuccess = () => {
          const blob = blobReq.result as Blob | undefined;
          if (blob) {
            results.push({ key: meta.key, blob, meta });
          }
          completed++;
          if (completed === metas.length) {
            resolve(results);
          }
        };
        blobReq.onerror = () => {
          completed++;
          if (completed === metas.length) {
            resolve(results);
          }
        };
      }
    };
    metaReq.onerror = () => reject(metaReq.error);
  });
}

/**
 * 将旧 key 映射到新的 OPFS 路径。
 *
 * 旧 key 格式：`asset:image:{id}` / `asset:voice:{id}`
 * 新路径格式：`images/{id}` / `audio/{id}`
 */
function mapKeyToPath(key: string, contentType: string): string {
  // 尝试从旧 key 中提取 ID
  const parts = key.split(':');
  const id = parts.length >= 3 ? parts.slice(2).join(':') : key;

  if (key.startsWith('asset:image:') || contentType.startsWith('image/')) {
    return `images/${id}`;
  }
  if (key.startsWith('asset:voice:') || contentType.startsWith('audio/')) {
    return `audio/${id}`;
  }
  if (contentType.startsWith('video/')) {
    return `video/${id}`;
  }
  return `other/${id}`;
}

/** 从 contentType 推断文件类型 */
function inferFileType(contentType: string): 'image' | 'audio' | 'video' | 'other' {
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('audio/')) return 'audio';
  if (contentType.startsWith('video/')) return 'video';
  return 'other';
}

/** 从 contentType 推断文件扩展名 */
function inferExtension(contentType: string): string {
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/ogg': '.ogg',
    'audio/webm': '.webm',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
  };
  return map[contentType] || '';
}

/**
 * 执行迁移。
 *
 * P0 修复：
 *   - 单文件失败时记录到 localStorage 的 failedKeys，下次启动时 needsMigration 仍返回 true 触发重试
 *   - 仅当「全部成功」时才调用 markMigrated()，避免数据永久丢失
 *   - 已成功迁移的 key 通过 GeneratedFile 已落盘幂等（id 唯一），重试不会产生重复数据
 *
 * @param fileStorage 新的文件存储适配器
 * @param fileRepo    新的文件元数据仓储
 * @param defaultSpaceId 默认工作空间 ID
 * @returns 迁移的文件数量
 */
export async function migrateOfflineCache(
  fileStorage: { storeBlob(path: string, blob: Blob): Promise<void> },
  fileRepo: { save(file: GeneratedFile): Promise<void> },
  defaultSpaceId: string = '__default__',
): Promise<number> {
  if (!needsMigration()) {
    console.log('[FileStorage Migration] Already migrated, skipping.');
    return 0;
  }

  console.log('[FileStorage Migration] Starting migration from OfflineCache...');

  // P0 修复：上次失败的 key 集合，用于本次「仅重试失败项」。
  // - 首次迁移：集合为空 → 处理所有 entries
  // - 重试迁移：集合非空 → 只处理集合中的 key，避免重复 IO（已成功项已幂等落盘）
  const previousFailedKeys = loadFailedKeys();
  const isRetry = previousFailedKeys.size > 0;
  if (isRetry) {
    console.log(`[FileStorage Migration] Retry mode: ${previousFailedKeys.size} previously failed keys.`);
  }

  let oldDB: IDBDatabase | null = null;
  let migratedCount = 0;
  const failedKeys: string[] = [];

  try {
    oldDB = await openOldDB();
    const entries = await readOldEntries(oldDB);

    // 重试模式下仅处理失败项；首次模式处理全部
    const targets = isRetry
      ? entries.filter(e => previousFailedKeys.has(e.key))
      : entries;

    for (const { key, blob, meta } of targets) {
      try {
        const newPath = mapKeyToPath(key, meta.contentType);
        const fileType = inferFileType(meta.contentType);
        const ext = inferExtension(meta.contentType);

        // 生成唯一 ID（使用旧 key 的 hash 或原始 ID）
        const id = `migrated_${key.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

        // 写入新存储
        await fileStorage.storeBlob(newPath, blob);

        // 写入元数据
        const generatedFile: GeneratedFile = {
          id,
          spaceId: defaultSpaceId,
          fileType,
          mimeType: meta.contentType || 'application/octet-stream',
          fileName: `${id}${ext}`,
          fileSize: meta.size,
          storagePath: newPath,
          tags: ['migrated'],
          lastAccessedAt: meta.lastAccessed,
          createdAt: meta.createdAt,
        };

        await fileRepo.save(generatedFile);
        migratedCount++;
      } catch (err) {
        console.warn(`[FileStorage Migration] Failed to migrate key "${key}":`, err);
        failedKeys.push(key);
        // 继续迁移其他文件
      }
    }

    // P0 修复：仅当全部成功时才标记完成；否则持久化 failedKeys 供下次重试
    if (failedKeys.length === 0) {
      markMigrated();
      console.log(
        `[FileStorage Migration] Completed. Migrated ${migratedCount}/${targets.length} files` +
        (isRetry ? ' (retry).' : '.'),
      );
    } else {
      persistFailedKeys(failedKeys);
      console.warn(
        `[FileStorage Migration] Partially completed. Migrated ${migratedCount}/${targets.length}, ` +
        `failed ${failedKeys.length}. Failed keys will be retried next launch.`,
      );
    }
  } catch (err) {
    console.error('[FileStorage Migration] Failed:', err);
    // 不标记为已迁移，下次启动时重试
    if (failedKeys.length > 0) {
      persistFailedKeys(failedKeys);
    }
  } finally {
    if (oldDB) {
      oldDB.close();
    }
  }

  return migratedCount;
}
