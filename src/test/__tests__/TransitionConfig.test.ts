/**
 * SYSTEM_OPTIMIZATION_PLAN_PHASE2 T-1：转场参数可配置（TransitionOptions）
 * - normalizeTransition：旧字符串字段迁移为 TransitionOptions（向后兼容）
 * - clampTransitionDuration：时长钳制 [0.1, 2.0]
 * - TimelineRenderService：使用 clip.transition.durationSec 计算 offset，'none' 走 concat
 */
import { describe, expect, it, vi } from 'vitest';
import { TimelineRenderService } from '../../domain/services/TimelineRenderService';
import { normalizeTransition, clampTransitionDuration } from '../../domain/ports/PostProcessPorts';
import type { Timeline, TimelineClip, TransitionOptions } from '../../domain/ports/PostProcessPorts';

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn(() => makeLogger()) };
}

function makeFfmpeg() {
  return {
    load: vi.fn(async () => { }),
    trim: vi.fn(async () => new Blob()),
    concat: vi.fn(async () => new Blob()),
    applyTransition: vi.fn(async () => new Blob()),
    merge: vi.fn(async () => new Blob()),
    mixMultipleAudio: vi.fn(async () => new Blob()),
    burnSubtitles: vi.fn(async () => new Blob()),
    resize: vi.fn(async () => new Blob()),
    compress: vi.fn(async () => new Blob()),
    convertFormat: vi.fn(async () => new Blob()),
    imageToVideo: vi.fn(async () => new Blob()),
  };
}

function makeDeps(ffmpeg = makeFfmpeg()) {
  return {
    ffmpegPort: ffmpeg,
    fileStorage: { getBlob: vi.fn(async () => new Blob(['v'])), putBlob: vi.fn(async () => ''), deleteBlob: vi.fn(async () => { }), listBlobs: vi.fn(async () => []) },
    videoTaskRepo: { findById: vi.fn(async () => ({ status: 'SUCCESS', videoUrl: 'https://cdn/v.mp4', videoStoragePath: 'opfs://v', duration: 2 })) },
    finalCutRepo: { findById: vi.fn(async () => null) },
    savedVideoRepo: { getById: vi.fn(async () => null) },
    savedVoiceRepo: { getById: vi.fn(async () => null) },
    logger: makeLogger(),
    httpFetch: { fetchBlob: vi.fn(async () => new Blob()) },
  };
}

function makeTimeline(clip2Transition?: TransitionOptions | string): Timeline {
  const clip2: TimelineClip = {
    id: 'c-2', type: 'video', trackId: 'tr-1', startTime: 2000, duration: 1000,
    sourceRef: { kind: 'videoTask', refId: 'task-2' },
    ...(clip2Transition ? { transition: clip2Transition as TransitionOptions } : {}),
  };
  return {
    id: 'tl-1',
    storyId: 'story-1',
    duration: 3000,
    transitions: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tracks: [{
      id: 'tr-1', type: 'video',
      clips: [
        { id: 'c-1', type: 'video', trackId: 'tr-1', startTime: 0, duration: 2000, sourceRef: { kind: 'videoTask', refId: 'task-1' } },
        clip2,
      ],
    }],
  };
}

describe('normalizeTransition（T-1 迁移）', () => {
  it('旧字符串 "fade" → { type: fade, durationSec: 0.5 }', () => {
    expect(normalizeTransition('fade' as never)).toEqual({ type: 'fade', durationSec: 0.5 });
  });

  it('旧字符串 "none" → { type: none, durationSec: 0.5 }', () => {
    expect(normalizeTransition('none' as never)).toEqual({ type: 'none', durationSec: 0.5 });
  });

  it('undefined / 空值 → undefined', () => {
    expect(normalizeTransition(undefined)).toBeUndefined();
    expect(normalizeTransition(null)).toBeUndefined();
  });

  it('TransitionOptions 对象保留；时长越界时钳制', () => {
    expect(normalizeTransition({ type: 'wipeleft', durationSec: 1.2 })).toEqual({ type: 'wipeleft', durationSec: 1.2 });
    expect(normalizeTransition({ type: 'slideup', durationSec: 5 })).toEqual({ type: 'slideup', durationSec: 2 });
    expect(normalizeTransition({ type: 'fade', durationSec: 0.05 })).toEqual({ type: 'fade', durationSec: 0.1 });
  });
});

describe('clampTransitionDuration（T-1 范围）', () => {
  it('钳制到 [0.1, 2.0]，非法值回退 0.5', () => {
    expect(clampTransitionDuration(0.5)).toBe(0.5);
    expect(clampTransitionDuration(0.05)).toBe(0.1);
    expect(clampTransitionDuration(3)).toBe(2);
    expect(clampTransitionDuration(Number.NaN)).toBe(0.5);
    expect(clampTransitionDuration(Number.POSITIVE_INFINITY)).toBe(0.5);
  });
});

describe('TimelineRenderService T-1 转场', () => {
  it('clip.transition.durationSec 透传，offset = prevDuration - durationSec', async () => {
    const ffmpeg = makeFfmpeg();
    const service = new TimelineRenderService(makeDeps(ffmpeg) as never);
    const tr: TransitionOptions = { type: 'fade', durationSec: 1.2 };
    await service.render(makeTimeline(tr), { resolution: 'original', format: 'mp4', quality: 'medium', burnSubtitles: false }, () => { });
    expect(ffmpeg.applyTransition).toHaveBeenCalledTimes(1);
    const call = ffmpeg.applyTransition.mock.calls[0] as unknown as [Blob, Blob, TransitionOptions, number];
    expect(call[2]).toEqual({ type: 'fade', durationSec: 1.2 });
    expect(call[3]).toBeCloseTo(0.8, 1); // 2s - 1.2s
  });

  it("transition 'none' 走 concat，不调用 applyTransition", async () => {
    const ffmpeg = makeFfmpeg();
    const service = new TimelineRenderService(makeDeps(ffmpeg) as never);
    await service.render(makeTimeline({ type: 'none', durationSec: 0.5 }), { resolution: 'original', format: 'mp4', quality: 'medium', burnSubtitles: false }, () => { });
    expect(ffmpeg.applyTransition).not.toHaveBeenCalled();
    expect(ffmpeg.concat).toHaveBeenCalled();
  });

  it('无转场字段 → concat（默认无转场）', async () => {
    const ffmpeg = makeFfmpeg();
    const service = new TimelineRenderService(makeDeps(ffmpeg) as never);
    await service.render(makeTimeline(), { resolution: 'original', format: 'mp4', quality: 'medium', burnSubtitles: false }, () => { });
    expect(ffmpeg.applyTransition).not.toHaveBeenCalled();
    expect(ffmpeg.concat).toHaveBeenCalled();
  });

  it('旧字符串转场字段（运行时兼容）→ durationSec 默认 0.5', async () => {
    const ffmpeg = makeFfmpeg();
    const service = new TimelineRenderService(makeDeps(ffmpeg) as never);
    await service.render(makeTimeline('fade' as unknown as TransitionOptions), { resolution: 'original', format: 'mp4', quality: 'medium', burnSubtitles: false }, () => { });
    expect(ffmpeg.applyTransition).toHaveBeenCalledTimes(1);
    const opts = (ffmpeg.applyTransition.mock.calls[0] as unknown as [Blob, Blob, TransitionOptions])[2];
    expect(opts).toEqual({ type: 'fade', durationSec: 0.5 });
  });
});
