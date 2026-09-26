import type { PublishTask, PublishPlatform, PublishStatus, PublishStats } from '../entities/models';
import type { IPublishTaskRepository } from '../ports/PublishPorts';
import type { IFinalCutRepository } from '../ports/OutboundPorts';

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

  private readonly finalCutRepo?: IFinalCutRepository;

  constructor(repo: IPublishTaskRepository, finalCutRepo?: IFinalCutRepository) {
    this.repo = repo;
    this.finalCutRepo = finalCutRepo;
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
    if (target === 'published' && this.finalCutRepo) {
      // P3-7 发布回执：写回成片生命周期（设计文档 A-1）
      const cut = await this.finalCutRepo.findById(task.finalCutId);
      if (cut) {
        await this.finalCutRepo.save({
          ...cut,
          lifecycle: 'published',
          publishedAt: next.updatedAt,
          publishChannel: task.platform,
        });
      }
    }
    return next;
  }

  async listTasks(filter?: { finalCutId?: string; status?: PublishStatus; limit?: number }): Promise<PublishTask[]> {
    return this.repo.query(filter ?? {});
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.repo.delete(taskId);
  }
  /** P3-8 发布数据回传：仅 published 任务可写（半自动录入，不伪造真实 API） */
  async updateStats(taskId: string, stats: Omit<PublishStats, 'collectedAt'>): Promise<PublishTask> {
    const task = await this.repo.getById(taskId);
    if (!task) throw new Error(`Publish task not found: ${taskId}`);
    if (task.status !== 'published') {
      throw new Error('Stats can only be recorded for published tasks');
    }
    const numbers = [stats.views, stats.likes, stats.comments, stats.shares];
    if (numbers.some(n => !Number.isFinite(n) || n < 0)) {
      throw new Error('Stats must be non-negative numbers');
    }
    const next: PublishTask = { ...task, stats: { ...stats, collectedAt: Date.now() }, updatedAt: Date.now() };
    await this.repo.save(next);
    return next;
  }

  /** P3-7 排期：设定未来发布时间（<= 当前时间拒绝；终态任务拒绝） */
  async scheduleTask(taskId: string, scheduledAt: number): Promise<PublishTask> {
    if (!Number.isFinite(scheduledAt) || scheduledAt <= Date.now()) {
      throw new Error('Schedule time must be in the future');
    }
    const task = await this.repo.getById(taskId);
    if (!task) throw new Error(`Publish task not found: ${taskId}`);
    if (task.status === 'published' || task.status === 'failed') {
      throw new Error('Cannot schedule a terminal task');
    }
    const next: PublishTask = { ...task, scheduledAt, updatedAt: Date.now() };
    await this.repo.save(next);
    return next;
  }

  /** P3-7 到期任务：已排期且到达发布时间、仍可推进的任务（页面加载时检查） */
  async getDueTasks(now = Date.now()): Promise<PublishTask[]> {
    const all = await this.repo.query({});
    return all.filter(t => t.scheduledAt != null && t.scheduledAt <= now && (t.status === 'draft' || t.status === 'ready' || t.status === 'exported'));
  }

  /** P3-7 立即发布：跳过排期直接推进到 published（含发布回执） */
  async publishNow(taskId: string): Promise<PublishTask> {
    return this.advance(taskId, 'published');
  }

}
