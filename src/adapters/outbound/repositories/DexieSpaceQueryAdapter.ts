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

  /** 内部辅助：在首次订阅时挂载变更监听器 */
  private ensureDexieSubscription(): void {
    if (this.subscribedToDexie) return;
    this.subscribedToDexie = true;

    let scheduled = false;
    const notifyAll = (): void => {
      // 通过微任务合并多次变更，避免连续写入产生风暴
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
    };

    // 策略 1：优先尝试 Dexie Observable 插件的 'changes' 事件（若已安装）
    // 修复：db.on('changes') 需要 dexie-observable 插件，未安装时内部访问
    // undefined.subscribe 抛 TypeError。try/catch 捕获后降级到策略 2。
    try {
      (db as unknown as { on: (event: 'changes', listener: () => void) => void }).on('changes', notifyAll);
      return;
    } catch {
      // dexie-observable 未安装，降级到表钩子方案
    }

    // 策略 2：Dexie 核心表钩子（creating/updating/deleting），无需任何插件
    // 这是 Dexie 内置功能，在所有写操作时同步触发回调。
    // 注意：钩子在事务内同步触发，但 notifyAll 通过 queueMicrotask 延迟通知，
    // 确保 UI 重查时事务已提交。
    try {
      const tables = [
        db.storySpaces, db.characters, db.backgrounds, db.stories,
        db.segments, db.videoTasks, db.pipelineTasks, db.finalCuts,
        db.savedImages, db.savedVoices, db.savedPrompts, db.savedVideos,
        db.snapshots, db.timelines, db.generatedFiles,
      ];
      for (const table of tables) {
        // 三种钩子都返回 undefined，不修改 Dexie 写入行为
        table.hook('creating', notifyAll);
        table.hook('updating', notifyAll);
        table.hook('deleting', notifyAll);
      }
      return;
    } catch {
      // 表钩子也不可用（极旧 Dexie 版本），降级到策略 3
    }

    // 策略 3：轮询兜底（2 秒间隔），确保最低限度的 UI 刷新能力
    // 仅在前两种策略都失败时启用，避免完全失去响应性
    setInterval(notifyAll, 2000);
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
