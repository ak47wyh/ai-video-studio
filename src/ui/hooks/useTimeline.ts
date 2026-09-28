/**
 * useTimeline —— 剪辑工作台的时间线编排 Hook
 *
 * 职责：
 * - 按 storyId 加载/构建时间线（无则调用 buildFromStory 自动铺轨）
 * - 暴露乐观更新（updateTimeline）+ 防抖保存
 * - 暴露渲染导出（exportTimeline）调用 ITimelineRenderPort
 *
 * 不负责底层 FFmpeg 操作，也不直接渲染 UI（由 TimelineEditor 负责）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { timelineService, timelineRenderPort } from '../../dependencies';
import type { Timeline, TimelineClip, TransitionOptions } from '../../domain/ports/PostProcessPorts';
import type { RenderExportOptions, RenderProgress } from '../../domain/ports/TimelineRenderPorts';

export interface UseTimelineResult {
  timeline: Timeline | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
  /** 乐观更新内存中的时间线（不立即落盘） */
  updateTimeline: (updater: (draft: Timeline) => Timeline | void) => void;
  /** 立即保存当前时间线到仓储 */
  save: () => Promise<void>;
  /** 重新加载（丢弃未保存改动） */
  reload: () => Promise<void>;
  /** 以分镜自动铺轨（覆盖现有空时间线） */
  rebuildFromStory: () => Promise<void>;
  /** 触发渲染导出，返回 Blob */
  exportTimeline: (options: RenderExportOptions, onProgress?: (p: RenderProgress) => void) => Promise<Blob>;
}

const SAVE_DEBOUNCE_MS = 800;

export function useTimeline(storyId: string | null | undefined): UseTimelineResult {
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 持有最新 timeline，供防抖保存读取（避免 effect 依赖导致重建）
  const timelineRef = useRef<Timeline | null>(null);
  useEffect(() => {
    timelineRef.current = timeline;
  }, [timeline]);

  const storyIdRef = useRef(storyId);
  useEffect(() => {
    storyIdRef.current = storyId;
  }, [storyId]);

  const load = useCallback(async () => {
    const sid = storyIdRef.current;
    if (!sid) {
      setTimeline(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // buildFromStory 内部会跳过已有视频片段的时间线，等价于"加载或自动铺轨"
      const tl = await timelineService.buildFromStory(sid);
      setTimeline(tl);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载时间线失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, storyId]);

  // 防抖保存
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const tl = timelineRef.current;
      if (!tl) return;
      setSaving(true);
      try {
        await timelineService.save(tl);
      } catch (e) {
        setError(e instanceof Error ? e.message : '保存时间线失败');
      } finally {
        setSaving(false);
      }
    }, SAVE_DEBOUNCE_MS);
  }, []);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  const updateTimeline = useCallback((updater: (draft: Timeline) => Timeline | void) => {
    setTimeline(prev => {
      if (!prev) return prev;
      // 浅拷贝 draft 传入，updater 可返回新对象或就地修改
      const draft: Timeline = {
        ...prev,
        tracks: prev.tracks.map(t => ({ ...t, clips: [...t.clips] })),
      };
      const result = updater(draft);
      const next = result ?? draft;
      // 重新计算 duration = video 轨最末 clip 的 endTime
      const videoTrack = next.tracks.find(t => t.type === 'video');
      if (videoTrack && videoTrack.clips.length > 0) {
        next.duration = Math.max(next.duration, ...videoTrack.clips.map(c => c.startTime + c.duration));
      }
      return next;
    });
    scheduleSave();
  }, [scheduleSave]);

  const save = useCallback(async () => {
    const tl = timelineRef.current;
    if (!tl) return;
    setSaving(true);
    try {
      await timelineService.save(tl);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存时间线失败');
    } finally {
      setSaving(false);
    }
  }, []);

  const reload = useCallback(async () => {
    await load();
  }, [load]);

  const rebuildFromStory = useCallback(async () => {
    const sid = storyIdRef.current;
    if (!sid) return;
    setLoading(true);
    setError(null);
    try {
      // 删除现有再重建（buildFromStory 仅在空时间线时铺轨）
      const existing = await timelineService.loadByStoryId(sid);
      if (existing) await timelineService.delete(existing.id);
      const tl = await timelineService.buildFromStory(sid);
      setTimeline(tl);
    } catch (e) {
      setError(e instanceof Error ? e.message : '重建时间线失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const exportTimeline = useCallback(
    async (options: RenderExportOptions, onProgress?: (p: RenderProgress) => void) => {
      const tl = timelineRef.current;
      if (!tl) throw new Error('时间线未加载');
      return timelineRenderPort.render(tl, options, onProgress);
    },
    [],
  );

  return {
    timeline,
    loading,
    error,
    saving,
    updateTimeline,
    save,
    reload,
    rebuildFromStory,
    exportTimeline,
  };
}

// ===== 便捷的 clip 级更新工厂（供 TimelineEditor 使用） =====

export function moveClip(timeline: Timeline, clipId: string, newStartTime: number): Timeline {
  const tracks = timeline.tracks.map(track => ({
    ...track,
    clips: track.clips.map(c =>
      c.id === clipId ? { ...c, startTime: Math.max(0, newStartTime) } : c
    ),
  }));
  return { ...timeline, tracks };
}

export function resizeClip(timeline: Timeline, clipId: string, newDuration: number): Timeline {
  const tracks = timeline.tracks.map(track => ({
    ...track,
    clips: track.clips.map(c =>
      c.id === clipId ? { ...c, duration: Math.max(100, newDuration) } : c
    ),
  }));
  return { ...timeline, tracks };
}

/** 左边缘裁切：调整入点 + 整体左移，保持右侧不动 */
export function trimClipLeft(timeline: Timeline, clipId: string, deltaMs: number): Timeline {
  const tracks = timeline.tracks.map(track => ({
    ...track,
    clips: track.clips.map(c => {
      if (c.id !== clipId) return c;
      const newStart = Math.max(0, c.startTime + deltaMs);
      const newDuration = Math.max(100, c.duration - deltaMs);
      return { ...c, startTime: newStart, duration: newDuration };
    }),
  }));
  return { ...timeline, tracks };
}

export function removeClip(timeline: Timeline, clipId: string): Timeline {
  const tracks = timeline.tracks.map(track => ({
    ...track,
    clips: track.clips.filter(c => c.id !== clipId),
  }));
  return { ...timeline, tracks };
}

export function setClipTransition(timeline: Timeline, clipId: string, transition: TransitionOptions): Timeline {
  const tracks = timeline.tracks.map(track => ({
    ...track,
    clips: track.clips.map(c => (c.id === clipId ? { ...c, transition } : c)),
  }));
  return { ...timeline, tracks };
}

export function splitClipAtPlayhead(timeline: Timeline, clipId: string, playheadMs: number): Timeline {
  const tracks = timeline.tracks.map(track => ({
    ...track,
    clips: track.clips.flatMap<TimelineClip>(c => {
      if (c.id !== clipId) return [c];
      if (playheadMs <= c.startTime || playheadMs >= c.startTime + c.duration) return [c];
      const splitOffset = playheadMs - c.startTime;
      return [
        { ...c, duration: splitOffset },
        {
          ...c,
          id: `${c.id}_split_${Date.now()}`,
          startTime: playheadMs,
          duration: c.duration - splitOffset,
        },
      ];
    }),
  }));
  return { ...timeline, tracks };
}
