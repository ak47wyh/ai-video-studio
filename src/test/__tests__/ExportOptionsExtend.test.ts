/**
 * SYSTEM_OPTIMIZATION_PLAN_PHASE2 E-2/E-1：分辨率档位扩展 + 导出格式扩展
 * - E-2: RESOLUTION_MAP 480p/4k/vertical_1080x1920 → resize 正确尺寸
 * - E-1: format gif/webp/mov/webm → 非 mp4 时 convertFormat(format)；mp4 不额外转换
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
  };
}

function makeDeps(ffmpeg = makeFfmpeg()) {
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

function makeTimeline(): Timeline {
  return {
    id: 'tl-1',
    storyId: 'story-1',
    duration: 2000,
    transitions: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tracks: [{
      id: 'tr-1', type: 'video',
      clips: [{ id: 'c-1', type: 'video', trackId: 'tr-1', startTime: 0, duration: 2000, sourceRef: { kind: 'videoTask', refId: 'task-1' } }],
    }],
  };
}

function baseOptions(): RenderExportOptions {
  return { resolution: 'original', format: 'mp4', quality: 'medium', burnSubtitles: false };
}

describe('E-2 分辨率档位扩展', () => {
  it.each([
    ['480p', 854, 480],
    ['720p', 1280, 720],
    ['1080p', 1920, 1080],
    ['4k', 3840, 2160],
    ['vertical_1080x1920', 1080, 1920],
  ] as const)('%s → resize(%i, %i)', async (res, w, h) => {
    const ffmpeg = makeFfmpeg();
    const service = new TimelineRenderService(makeDeps(ffmpeg) as never);
    await service.render(makeTimeline(), { ...baseOptions(), resolution: res }, () => { });
    expect(ffmpeg.resize).toHaveBeenCalledWith(expect.any(Blob), w, h);
  });

  it('original 不触发 resize', async () => {
    const ffmpeg = makeFfmpeg();
    const service = new TimelineRenderService(makeDeps(ffmpeg) as never);
    await service.render(makeTimeline(), baseOptions(), () => { });
    expect(ffmpeg.resize).not.toHaveBeenCalled();
  });
});

describe('E-1 导出格式扩展', () => {
  it.each(['gif', 'webp', 'mov', 'webm'] as const)('format=%s → convertFormat(%s)', async (f) => {
    const ffmpeg = makeFfmpeg();
    const service = new TimelineRenderService(makeDeps(ffmpeg) as never);
    await service.render(makeTimeline(), { ...baseOptions(), format: f }, () => { });
    expect(ffmpeg.convertFormat).toHaveBeenCalledWith(expect.any(Blob), f);
  });

  it('format=mp4 不额外转换', async () => {
    const ffmpeg = makeFfmpeg();
    const service = new TimelineRenderService(makeDeps(ffmpeg) as never);
    await service.render(makeTimeline(), baseOptions(), () => { });
    expect(ffmpeg.convertFormat).not.toHaveBeenCalled();
  });
});
