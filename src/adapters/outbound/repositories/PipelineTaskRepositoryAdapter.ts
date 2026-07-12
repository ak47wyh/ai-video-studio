/**
 * PipelineTaskRepositoryAdapter —— Pipeline 任务仓储的 Dexie 实现
 *
 * M3.1 持久化与恢复（EVOLUTION_DESIGN.md §7.1）：
 *   将 PipelineTask 持久化到 IndexedDB，解决"刷新即丢"问题。
 *   PipelineService 在 createTask / setStage / markComplete / markFailed 时写库；
 *   启动时调用 findActive() 加载 status='running' 的任务并恢复。
 *
 * 数据模型：PipelineTask（已在 entities/models.ts 中定义）。
 * 索引：id, storyId, status, createdAt（已在 Dexie v7 中声明）。
 */

import { db } from './DexieDatabase';
import type { IPipelineTaskRepository } from '../../../domain/ports/PersistencePorts';
import type { PipelineTask } from '../../../domain/entities/models';

export class PipelineTaskRepositoryAdapter implements IPipelineTaskRepository {
  async save(task: PipelineTask): Promise<void> {
    await db.pipelineTasks.put(task);
  }

  async findById(id: string): Promise<PipelineTask | null> {
    return (await db.pipelineTasks.get(id)) ?? null;
  }

  async findByStoryId(storyId: string): Promise<PipelineTask[]> {
    const all = await db.pipelineTasks.where('storyId').equals(storyId).toArray();
    return all.sort((a, b) => b.createdAt - a.createdAt);
  }

  async findActive(): Promise<PipelineTask[]> {
    // V2 P2-3.2.6：走 status 索引，noneOf('complete', 'failed') 排除终态，
    // 避免全表扫描 + 内存过滤。pipelineTasks 表已声明 status 索引，之前未利用。
    // 注意：PipelineStatus 当前不含 'cancelled'（仅 ThreeDTaskStatusType 有），此处不检查 cancelled
    return db.pipelineTasks.where('status').noneOf(['complete', 'failed']).toArray();
  }

  async delete(id: string): Promise<void> {
    await db.pipelineTasks.delete(id);
  }
}
