import { db } from './DexieDatabase';
import type { PublishTask } from '../../../domain/entities/models';
import type { IPublishTaskRepository } from '../../../domain/ports/PublishPorts';

/** P0-1 发布任务仓库（IndexedDB） */
export class PublishTaskRepositoryAdapter implements IPublishTaskRepository {
  async save(task: PublishTask): Promise<void> {
    await db.publishTasks.put(task);
  }

  async getById(id: string): Promise<PublishTask | undefined> {
    return db.publishTasks.get(id);
  }

  async query(params: { finalCutId?: string; status?: PublishTask['status']; offset?: number; limit?: number }): Promise<PublishTask[]> {
    let col = db.publishTasks.toCollection();
    if (params.finalCutId) col = db.publishTasks.where('finalCutId').equals(params.finalCutId);
    else if (params.status) col = db.publishTasks.where('status').equals(params.status);
    let results = await col.toArray();
    results.sort((a, b) => b.updatedAt - a.updatedAt);
    if (params.offset) results = results.slice(params.offset);
    if (params.limit) results = results.slice(0, params.limit);
    return results;
  }

  async delete(id: string): Promise<void> {
    await db.publishTasks.delete(id);
  }

  async count(): Promise<number> {
    return db.publishTasks.count();
  }
}
