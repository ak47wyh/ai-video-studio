/**
 * DexieSpaceQueryAdapter —— ISpaceQueryPort 的 Dexie 实现
 *
 * Phase 2 DIP：封装 db.* 直查逻辑到 adapter，使 UI 不再直接 import Dexie。
 *
 * 设计要点：
 * - 内部使用 `db.*` 完成查询，外部仅暴露 Port 契约
 * - subscribe 桥接 Dexie 的 `db.on('changes')` 事件，转译为通用的"已变更"通知
 *   （不传递具体变更详情，UI 自行决定是否重新查询）
 * - 所有 list 方法均返回普通数组（已 .toArray()，无 Dexie Collection 类型泄漏）
 */

import type { ISpaceQueryPort, SpaceAssetCounts, VideoTaskStats } from '../../../domain/ports/SpaceQueryPort';
import type {
  StorySpace,
  Character,
  Background,
  Story,
  StorySegment,
  VideoTask,
  SavedImage,
  FinalCut,
  PipelineTask,
} from '../../../domain/entities/models';
import { db } from './DexieDatabase';

type ChangeListener = () => void;

export class DexieSpaceQueryAdapter implements ISpaceQueryPort {
  private listeners = new Set<ChangeListener>();
  private subscribedToDexie = false;

  /** 内部辅助：在首次订阅时挂载 Dexie changes 监听器 */
  private ensureDexieSubscription(): void {
    if (this.subscribedToDexie) return;
    this.subscribedToDexie = true;
    // Dexie 的 changes 事件：任何表 CRUD 都会触发
    // 通过微任务合并多次变更，避免连续写入产生风暴
    // Dexie 类型声明中 'changes' 由 Observable 模块提供，类型层面需断言
    let scheduled = false;
    (db as unknown as { on: (event: 'changes', listener: () => void) => void }).on('changes', () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        const snapshot = Array.from(this.listeners);
        for (const l of snapshot) {
          try {
            l();
          } catch {
            // 隔离订阅者错误，避免影响其他订阅者
          }
        }
      });
    });
  }

  async listSpaces(): Promise<StorySpace[]> {
    return db.storySpaces.toArray();
  }

  async getSpace(id: string): Promise<StorySpace | undefined> {
    return db.storySpaces.get(id);
  }

  async countBySpace(spaceId: string): Promise<SpaceAssetCounts> {
    const [images, characters, backgrounds, stories] = await Promise.all([
      db.savedImages.where('spaceId').equals(spaceId).count(),
      db.characters.where('spaceId').equals(spaceId).count(),
      db.backgrounds.where('spaceId').equals(spaceId).count(),
      db.stories.where('spaceId').equals(spaceId).count(),
    ]);
    return { images, characters, backgrounds, stories };
  }

  async listCharactersBySpace(spaceId: string): Promise<Character[]> {
    return db.characters.where('spaceId').equals(spaceId).toArray();
  }

  async listBackgroundsBySpace(spaceId: string): Promise<Background[]> {
    return db.backgrounds.where('spaceId').equals(spaceId).toArray();
  }

  async listStoriesBySpace(spaceId: string): Promise<Story[]> {
    return db.stories.where('spaceId').equals(spaceId).toArray();
  }

  async listRecentStoriesBySpace(spaceId: string, limit: number): Promise<Story[]> {
    const arr = await db.stories.where('spaceId').equals(spaceId).reverse().sortBy('createdAt');
    return arr.slice(0, limit);
  }

  async listImagesBySpace(spaceId: string): Promise<SavedImage[]> {
    return db.savedImages.where('spaceId').equals(spaceId).toArray();
  }

  async listSegmentsByStory(storyId: string): Promise<StorySegment[]> {
    const arr = await db.segments.where('storyId').equals(storyId).toArray();
    return [...arr].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
  }

  async listVideoTasksBySegments(segmentIds: string[]): Promise<VideoTask[]> {
    if (segmentIds.length === 0) return [];
    return db.videoTasks.where('segmentId').anyOf(segmentIds).toArray();
  }

  async listFinalCutsByStories(storyIds: string[]): Promise<FinalCut[]> {
    if (storyIds.length === 0) return [];
    const storySet = new Set(storyIds);
    const all = await db.finalCuts.toArray();
    return all.filter(cut => storySet.has(cut.storyId));
  }

  async listAllPipelineTasks(): Promise<PipelineTask[]> {
    return db.pipelineTasks.orderBy('createdAt').reverse().toArray();
  }

  async getVideoTaskStatsBySpace(spaceId: string): Promise<VideoTaskStats> {
    if (!spaceId) return { success: 0, failed: 0, processing: 0, total: 0 };
    const spaceStories = await db.stories.where('spaceId').equals(spaceId).toArray();
    const storyIds = new Set(spaceStories.map(s => s.id));
    const allSegments = await db.segments.toArray();
    const spaceSegmentIds = new Set(
      allSegments.filter(seg => storyIds.has(seg.storyId)).map(seg => seg.id),
    );
    const allTasks = await db.videoTasks.toArray();
    const spaceTasks = allTasks.filter(t => spaceSegmentIds.has(t.segmentId));
    return {
      success: spaceTasks.filter(t => t.status === 'SUCCESS').length,
      failed: spaceTasks.filter(t => t.status === 'FAILED').length,
      processing: spaceTasks.filter(t => t.status === 'PROCESSING' || t.status === 'PENDING').length,
      total: spaceTasks.length,
    };
  }

  subscribe(listener: ChangeListener): () => void {
    this.ensureDexieSubscription();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/**
 * 单例：与 db 共享同一份 Dexie 数据库句柄。
 *
 * UI 通过 dependencies.ts 的 spaceQueryPort 获取此实例，
 * 不再直接 import Dexie。
 */
export const spaceQueryAdapter = new DexieSpaceQueryAdapter();
