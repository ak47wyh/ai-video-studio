/**
 * useSpaceScopedQuery — 空间维度只读查询 Hook
 *
 * Phase 2 DIP：替代页面层直调 `db.*` + `useLiveQuery`。
 * 所有数据均通过 `spaceQueryPort`（ISpaceQueryPort）读取，
 * 通过订阅 `spaceQueryPort.subscribe` 在 Dexie 变更时自动刷新。
 *
 * 设计要点：
 * - 内部封装 `useSpaceQueryResult` 通用订阅模式，避免重复样板代码
 * - 不再依赖 `dexie-react-hooks`，UI 与 Dexie 解耦
 */

import { useEffect, useState } from 'react';
import { spaceQueryPort } from '../../dependencies';
import { useSpace } from '../contexts/SpaceContext';
import type {
  Character,
  Background,
  Story,
  StorySegment,
  VideoTask,
  FinalCut,
  PipelineTask,
  StorySpace,
} from '../../domain/entities/models';

/**
 * 通用订阅式查询：依赖 `queryFn` 在 deps 变化时执行，
 * 并通过 `spaceQueryPort.subscribe` 在数据变更时自动重查。
 *
 * 注意：queryFn 不进入依赖数组，调用方需通过 deps 显式声明依赖。
 */
function useSpaceQueryResult<T>(
  queryFn: () => Promise<T>,
  deps: unknown[],
  initial: T,
): T {
  const [state, setState] = useState<T>(initial);

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      queryFn()
        .then((result) => {
          if (!cancelled) setState(result);
        })
        .catch((e) => {
          // 静默错误：保持上次成功值，避免 UI 闪烁
          console.warn('[useSpaceQueryResult] query failed', e);
        });
    };
    run();
    const unsubscribe = spaceQueryPort.subscribe(run);
    return () => {
      cancelled = true;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}

/** 当前空间下的所有角色 */
export function useSpaceScopedCharacters(): Character[] {
  const { currentSpaceId } = useSpace();
  return useSpaceQueryResult<Character[]>(
    () => (currentSpaceId
      ? spaceQueryPort.listCharactersBySpace(currentSpaceId)
      : Promise.resolve([])),
    [currentSpaceId],
    [],
  );
}

/** 当前空间下的所有背景 */
export function useSpaceScopedBackgrounds(): Background[] {
  const { currentSpaceId } = useSpace();
  return useSpaceQueryResult<Background[]>(
    () => (currentSpaceId
      ? spaceQueryPort.listBackgroundsBySpace(currentSpaceId)
      : Promise.resolve([])),
    [currentSpaceId],
    [],
  );
}

/** 当前空间下的所有故事 */
export function useSpaceScopedStories(): Story[] {
  const { currentSpaceId } = useSpace();
  return useSpaceQueryResult<Story[]>(
    () => (currentSpaceId
      ? spaceQueryPort.listStoriesBySpace(currentSpaceId)
      : Promise.resolve([])),
    [currentSpaceId],
    [],
  );
}

/** 故事下的所有段落（已按 sequenceOrder 排序） */
export function useStoryScopedSegments(storyId: string | null): StorySegment[] {
  return useSpaceQueryResult<StorySegment[]>(
    () => (storyId
      ? spaceQueryPort.listSegmentsByStory(storyId)
      : Promise.resolve([])),
    [storyId],
    [],
  );
}

/** 多个段落 ID 下的所有视频任务 */
export function useSegmentScopedVideoTasks(segmentIds: string[]): VideoTask[] {
  const key = segmentIds.join(',');
  return useSpaceQueryResult<VideoTask[]>(
    () => (segmentIds.length > 0
      ? spaceQueryPort.listVideoTasksBySegments(segmentIds)
      : Promise.resolve([])),
    [key],
    [],
  );
}

/** 所有 Pipeline 任务（按 createdAt 倒序） */
export function useSpaceScopedPipelineTasks(): PipelineTask[] {
  return useSpaceQueryResult<PipelineTask[]>(
    () => spaceQueryPort.listAllPipelineTasks(),
    [],
    [],
  );
}

/** 当前空间下的所有成片 */
export function useSpaceScopedFinalCuts(): FinalCut[] {
  const { currentSpaceId } = useSpace();
  const stories = useSpaceScopedStories();
  const storyIds = stories.map((s) => s.id);
  const key = storyIds.join(',');
  return useSpaceQueryResult<FinalCut[]>(
    () => (currentSpaceId
      ? spaceQueryPort.listFinalCutsByStories(storyIds)
      : Promise.resolve([])),
    [currentSpaceId, key],
    [],
  );
}

/** 视频任务统计 */
export interface VideoTaskStats {
  success: number;
  failed: number;
  processing: number;
  total: number;
}

export function useSpaceVideoTaskStats(): VideoTaskStats {
  const { currentSpaceId } = useSpace();
  return useSpaceQueryResult<VideoTaskStats>(
    () => (currentSpaceId
      ? spaceQueryPort.getVideoTaskStatsBySpace(currentSpaceId)
      : Promise.resolve({ success: 0, failed: 0, processing: 0, total: 0 })),
    [currentSpaceId],
    { success: 0, failed: 0, processing: 0, total: 0 },
  );
}

/** 当前空间下最近的故事（最多 N 条） */
export function useRecentStories(limit = 3): Story[] {
  const { currentSpaceId } = useSpace();
  return useSpaceQueryResult<Story[]>(
    () => (currentSpaceId
      ? spaceQueryPort.listRecentStoriesBySpace(currentSpaceId, limit)
      : Promise.resolve([])),
    [currentSpaceId, limit],
    [],
  );
}

/** 所有空间（用于跨空间复制） */
export function useAllSpaces(): StorySpace[] {
  return useSpaceQueryResult<StorySpace[]>(
    () => spaceQueryPort.listSpaces(),
    [],
    [],
  );
}

/** 复合 Hook：获取当前空间的上下文（角色/背景/故事） */
export interface SpaceContextData {
  characters: Character[];
  backgrounds: Background[];
  stories: Story[];
  loading: boolean;
}

export function useSpaceContextData(): SpaceContextData {
  const characters = useSpaceScopedCharacters();
  const backgrounds = useSpaceScopedBackgrounds();
  const stories = useSpaceScopedStories();
  return {
    characters,
    backgrounds,
    stories,
    loading: false,
  };
}
