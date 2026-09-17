import type { PublishTask, PublishPlatform, PublishStatus } from '../entities/models';
import type { IPublishTaskRepository } from '../ports/PublishPorts';

/**
 * 状态机：draft → ready → exported → published；ready/exported 可转 failed；failed 可重试回 ready。
 */
const TRANSITIONS: Record<PublishStatus, PublishStatus[]> = {
  draft: ['ready'],
  ready: ['exported', 'failed'],
  exported: ['published', 'failed'],
  published: [],
  failed: ['ready'],
};

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export interface CreatePublishTaskInput {
  finalCutId: string;
  storyId?: string;
  platform: PublishPlatform;
  title: string;
  description?: string;
  tags?: string[];
  coverUrl?: string;
  presetKey?: string;
}

/**
 * P0-1 发布中心：成片 → 发布任务（平台/标题/标签/封面）→ 状态追踪。
 *
 * 说明：真实平台 API 发布需平台授权（同 A4 限制），本服务提供
 * 半自动发布——状态流转由用户操作推进，覆盖"导出文件 + 发布配置 + 记录"闭环。
 */
export class PublishService {
  private readonly repo: IPublishTaskRepository;

  constructor(repo: IPublishTaskRepository) {
    this.repo = repo;
  }

  async createTask(input: CreatePublishTaskInput): Promise<PublishTask> {
    const now = Date.now();
    const task: PublishTask = {
      id: generateId(),
      finalCutId: input.finalCutId,
      storyId: input.storyId,
      platform: input.platform,
      title: input.title,
      description: input.description,
      tags: input.tags ?? [],
      coverUrl: input.coverUrl,
      presetKey: input.presetKey,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };
    await this.repo.save(task);
    return task;
  }

  /**
   * 推进状态（校验合法流转）。
   * @throws 非法流转时抛错，不落库。
   */
  async advance(taskId: string, target: PublishStatus, error?: string): Promise<PublishTask> {
    const task = await this.repo.getById(taskId);
    if (!task) throw new Error(`Publish task not found: ${taskId}`);
    const allowed = TRANSITIONS[task.status] ?? [];
    if (!allowed.includes(target)) {
      throw new Error(`Invalid transition ${task.status} -> ${target}`);
    }
    const next: PublishTask = { ...task, status: target, updatedAt: Date.now() };
    if (target === 'failed') next.error = error;
    else delete next.error;
    await this.repo.save(next);
    return next;
  }

  async listTasks(filter?: { finalCutId?: string; status?: PublishStatus; limit?: number }): Promise<PublishTask[]> {
    return this.repo.query(filter ?? {});
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.repo.delete(taskId);
  }
}
