import { db } from './DexieDatabase';
import type { ISensitiveWordRepository } from '../../../domain/ports/CompliancePorts';
import type { SensitiveWordEntry } from '../../../domain/entities/models';

/**
 * P3-2 敏感词仓库（Dexie sensitiveWords 表）
 * 支持按平台查询、启用过滤、写入与删除
 */
export class DexieSensitiveWordRepository implements ISensitiveWordRepository {
  async listByPlatform(platform: SensitiveWordEntry['platform']): Promise<SensitiveWordEntry[]> {
    const rows = await db.table<SensitiveWordEntry, string>('sensitiveWords')
      .where('platform').equals(platform).toArray();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  }

  async listEnabledByPlatform(platform: SensitiveWordEntry['platform']): Promise<SensitiveWordEntry[]> {
    const rows = await db.table<SensitiveWordEntry, string>('sensitiveWords')
      .where('platform').equals(platform).filter(e => e.enabled !== false).toArray();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  }

  async put(entry: SensitiveWordEntry): Promise<void> {
    await db.table<SensitiveWordEntry, string>('sensitiveWords').put(entry);
  }

  async delete(id: string): Promise<void> {
    await db.table<SensitiveWordEntry, string>('sensitiveWords').delete(id);
  }
}
