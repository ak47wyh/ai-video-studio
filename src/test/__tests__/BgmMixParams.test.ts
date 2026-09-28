/**
 * SYSTEM_OPTIMIZATION_PLAN_PHASE2 M-1：BGM 音量/淡入淡出参数化
 * - bgmVolume 默认 0.3 应用于 mixAudio
 * - fadeInSec/fadeOutSec > 0 时对 BGM 轨先 fadeAudio 再混音
 * - fade 为 0 时不调用 fadeAudio
 */
import { describe, expect, it, vi } from 'vitest';
import { TimelineRenderService } from '../../domain/services/TimelineRenderService';
import type { Timeline } from '../../domain/ports/PostProcessPorts';
import type { RenderExportOptions } from '../../domain/ports/TimelineRenderPorts';

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
    fadeAudio: vi.fn(async (a: Blob) => a),
    mixAudio: vi.fn(async () => new Blob()),
  };
}

function makeDeps(ffmpeg: ReturnType<typeof makeFfmpeg>) {
  return {
    ffmpegPort: ffmpeg,
    fileStorage: { getBlob: vi.fn(async () => null), putBlob: vi.fn(async () => ''), deleteBlob: vi.fn(async () => { }), listBlobs: vi.fn(async () => []) },
    videoTaskRepo: { findById: vi.fn(async () => ({ status: 'SUCCESS', videoUrl: 'https://cdn/v.mp4', videoStoragePath: 'opfs://v', duration: 2 })) },
    finalCutRepo: { findById: vi.fn(async () => null) },
    savedVideoRepo: { getById: vi.fn(async () => null) },
    savedVoiceRepo: { getById: vi.fn(async () => null) },
    logger: makeLogger(),
    httpFetch: { fetchBlob: vi.fn(async () => new Blob()) },
  };
}

/** 音频轨：旁白 + BGM 两条 */
function makeTimelineWithAudio(): Timeline {
  return {
    id: 'tl-1',
    storyId: 'story-1',
    duration: 10_000,
    transitions: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tracks: [
      {
        id: 'tr-1', type: 'video',
        clips: [{ id: 'c-1', type: 'video', trackId: 'tr-1', startTime: 0, duration: 10_000, sourceRef: { kind: 'videoTask', refId: 'task-1' } }],
      },
      {
        id: 'tr-2', type: 'audio',
        clips: [
          { id: 'a-1', type: 'audio', trackId: 'tr-2', startTime: 0, duration: 10_000, sourceRef: { kind: 'videoTask', refId: 'task-1' } },
          { id: 'a-2', type: 'audio', trackId: 'tr-2', startTime: 0, duration: 10_000, sourceRef: { kind: 'videoTask', refId: 'task-1' } },
        ],
      },
    ],
  };
}

function baseOptions(): RenderExportOptions {
  return { resolution: 'original', format: 'mp4', quality: 'medium', burnSubtitles: false };
}

describe('M-1 BGM 音量/淡入淡出参数化', () => {
  it('默认 bgmVolume=0.3 传入 mixAudio', async () => {
    const ffmpeg = makeFfmpeg();
    const svc = new TimelineRenderService(makeDeps(ffmpeg) as never);
    await svc.render(makeTimelineWithAudio(), baseOptions(), () => { });
    expect(ffmpeg.mixAudio).toHaveBeenCalledWith(expect.any(Blob), expect.any(Blob), { voiceVolume: 1, bgmVolume: 0.3 });
  });

  it('bgmVolume=0.6 覆盖混音音量', async () => {
    const ffmpeg = makeFfmpeg();
    const svc = new TimelineRenderService(makeDeps(ffmpeg) as never);
    await svc.render(makeTimelineWithAudio(), { ...baseOptions(), bgmVolume: 0.6 }, () => { });
    expect(ffmpeg.mixAudio).toHaveBeenCalledWith(expect.any(Blob), expect.any(Blob), { voiceVolume: 1, bgmVolume: 0.6 });
  });

  it('fade 参数 >0 时对 BGM 轨先 fadeAudio（duration 由 timeline 提供）', async () => {
    const ffmpeg = makeFfmpeg();
    const svc = new TimelineRenderService(makeDeps(ffmpeg) as never);
    await svc.render(makeTimelineWithAudio(), { ...baseOptions(), bgmFadeInSec: 1, bgmFadeOutSec: 2 }, () => { });
    expect(ffmpeg.fadeAudio).toHaveBeenCalledWith(expect.any(Blob), { fadeInSec: 1, fadeOutSec: 2, durationSec: 10 });
  });

  it('fade 为 0 时不调用 fadeAudio', async () => {
    const ffmpeg = makeFfmpeg();
    const svc = new TimelineRenderService(makeDeps(ffmpeg) as never);
    await svc.render(makeTimelineWithAudio(), baseOptions(), () => { });
    expect(ffmpeg.fadeAudio).not.toHaveBeenCalled();
  });
});
