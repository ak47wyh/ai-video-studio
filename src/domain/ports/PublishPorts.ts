import type { PublishTask } from '../entities/models';

/** P0-1 发布任务仓库 */
export interface IPublishTaskRepository {
  save(task: PublishTask): Promise<void>;
  getById(id: string): Promise<PublishTask | undefined>;
  query(params: { finalCutId?: string; status?: PublishTask['status']; offset?: number; limit?: number }): Promise<PublishTask[]>;
  delete(id: string): Promise<void>;
  count(): Promise<number>;
}
