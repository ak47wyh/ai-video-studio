/**
 * SpaceQueryPort —— 空间维度只读查询端口
 *
 * Phase 2 DIP：UI 层（SpaceDetailPage / useSpaceScopedQuery / SpaceContext）
 * 不再直接 import Dexie `db` 与 `useLiveQuery`，统一通过此 Port 查询。
 *
 * 设计要点：
 * - 仅暴露只读查询方法；写入仍走各 Service（StorySpaceService 等）
 * - subscribe 桥接 Dexie 的 db.on('changes') 事件，供 UI 用 useSyncExternalStore
 *   或简单的 useEffect+setState 模式接管响应式刷新
 * - Adapter 实现内部仍可使用 db.*，但 Dexie 依赖局限于 adapter 文件
 */

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
} from '../entities/models';

/** 资产计数概览（用于 SpaceDetailPage Tab 栏角标） */
export interface SpaceAssetCounts {
  images: number;
  characters: number;
  backgrounds: number;
  stories: number;
}

/** 视频任务状态统计（按 status 维度聚合） */
export interface VideoTaskStats {
  success: number;
  failed: number;
  processing: number;
  total: number;
}

/**
 * 空间维度只读查询端口。
 *
 * 实现方契约：
 * - 所有 list/count 方法在 spaceId 为空或不存在时返回空数组 / 零
 * - subscribe 监听器在底层 Dexie 表变更时被触发（异步微任务）
 * - 返回的 unsubscribe 函数幂等，多次调用安全
 */
export interface ISpaceQueryPort {
  /** 列出全部空间 */
  listSpaces(): Promise<StorySpace[]>;
  /** 获取单个空间 */
  getSpace(id: string): Promise<StorySpace | undefined>;
  /** 空间资产计数概览 */
  countBySpace(spaceId: string): Promise<SpaceAssetCounts>;
  /** 列出空间下所有角色 */
  listCharactersBySpace(spaceId: string): Promise<Character[]>;
  /** 列出空间下所有背景 */
  listBackgroundsBySpace(spaceId: string): Promise<Background[]>;
  /** 列出空间下所有故事 */
  listStoriesBySpace(spaceId: string): Promise<Story[]>;
  /** 列出空间下最近 N 个故事（按 createdAt 倒序） */
  listRecentStoriesBySpace(spaceId: string, limit: number): Promise<Story[]>;
  /** 列出空间下所有已保存图片 */
  listImagesBySpace(spaceId: string): Promise<SavedImage[]>;
  /** 列出故事下所有段落（按 sequenceOrder 升序） */
  listSegmentsByStory(storyId: string): Promise<StorySegment[]>;
  /** 列出多个段落 ID 下的所有视频任务 */
  listVideoTasksBySegments(segmentIds: string[]): Promise<VideoTask[]>;
  /** 列出多个故事 ID 下的所有成片 */
  listFinalCutsByStories(storyIds: string[]): Promise<FinalCut[]>;
  /** 列出全部 Pipeline 任务（按 createdAt 倒序） */
  listAllPipelineTasks(): Promise<PipelineTask[]>;
  /** 当前空间的视频任务状态统计 */
  getVideoTaskStatsBySpace(spaceId: string): Promise<VideoTaskStats>;
  /** 订阅数据变更事件；返回取消订阅函数 */
  subscribe(listener: () => void): () => void;
}
