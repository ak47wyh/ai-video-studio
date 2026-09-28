/**
 * SYSTEM_OPTIMIZATION_PLAN_PHASE2 T-2：sourceRef 扩展 imageAsVideo + externalUrl
 * - imageAsVideo: 远程图片 URL → ffmpeg.imageToVideo 转 N 秒视频片段
 * - externalUrl: 远程视频/音频 URL 直用（durationSec=-1）
 * - 旧 kind 仍按原逻辑解析；缺失引用字段时安全返回 null
 */
import { describe, expect, it, vi } from 'vitest';
import { TimelineRenderService } from '../../domain/services/TimelineRenderService';
import type { Timeline, TimelineClipSource } from '../../domain/ports/PostProcessPorts';

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
    imageToVideo: vi.fn(async (_img: Blob, durationSec: number) => new Blob([`img-${durationSec}`])),
  };
}

function makeDeps(ffmpeg = makeFfmpeg()) {
  return {
    ffmpegPort: ffmpeg,
    fileStorage: { getBlob: vi.fn(async () => null), putBlob: vi.fn(async () => ''), deleteBlob: vi.fn(async () => { }), listBlobs: vi.fn(async () => []) },
    videoTaskRepo: { findById: vi.fn(async () => null) },
    finalCutRepo: { findById: vi.fn(async () => null) },
    savedVideoRepo: { getById: vi.fn(async () => null) },
    savedVoiceRepo: { getById: vi.fn(async () => null) },
    logger: makeLogger(),
    httpFetch: { fetchBlob: vi.fn(async (url: string) => new Blob([`remote-${url}`])) },
  };
}

function makeTimeline(sourceRef: TimelineClipSource): Timeline {
  return {
    id: 'tl-1',
    storyId: 'story-1',
    duration: 4000,
    transitions: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tracks: [{
      id: 'tr-1', type: 'video',
      clips: [{ id: 'c-1', type: 'video', trackId: 'tr-1', startTime: 0, duration: 3000, sourceRef }],
    }],
  };
}

describe('TimelineRenderService T-2 sourceRef', () => {
  it('imageAsVideo：fetch 图片 → imageToVideo 转 durationSec 秒视频', async () => {
    const ffmpeg = makeFfmpeg();
    const deps = makeDeps(ffmpeg);
    const service = new TimelineRenderService(deps as never);
    await service.render(
      makeTimeline({ kind: 'imageAsVideo', imageUrl: 'https://cdn/a.jpg', durationSec: 3 }),
      { resolution: 'original', format: 'mp4', quality: 'medium', burnSubtitles: false },
      () => { },
    );
    expect(deps.httpFetch.fetchBlob).toHaveBeenCalledWith('https://cdn/a.jpg');
    expect(ffmpeg.imageToVideo).toHaveBeenCalledWith(expect.any(Blob), 3);
  });

  it('imageAsVideo：缺失 durationSec 时默认 3 秒', async () => {
    const ffmpeg = makeFfmpeg();
    const deps = makeDeps(ffmpeg);
    const service = new TimelineRenderService(deps as never);
    await service.render(
      makeTimeline({ kind: 'imageAsVideo', imageUrl: 'https://cdn/b.jpg' }),
      { resolution: 'original', format: 'mp4', quality: 'medium', burnSubtitles: false },
      () => { },
    );
    expect(ffmpeg.imageToVideo).toHaveBeenCalledWith(expect.any(Blob), 3);
  });

  it('externalUrl：远程 URL 直用，不转码时长探测（durationSec=-1）', async () => {
    const ffmpeg = makeFfmpeg();
    const deps = makeDeps(ffmpeg);
    const service = new TimelineRenderService(deps as never);
    const result = await service.render(
      makeTimeline({ kind: 'externalUrl', url: 'https://cdn/v.mp4', mimeType: 'video/mp4' }),
      { resolution: 'original', format: 'mp4', quality: 'medium', burnSubtitles: false },
      () => { },
    );
    expect(result).toBeInstanceOf(Blob);
    expect(deps.httpFetch.fetchBlob).toHaveBeenCalledWith('https://cdn/v.mp4');
    expect(ffmpeg.imageToVideo).not.toHaveBeenCalled();
  });

  it('imageAsVideo 缺失 imageUrl → 渲染失败并抛出', async () => {
    const ffmpeg = makeFfmpeg();
    const service = new TimelineRenderService(makeDeps(ffmpeg) as never);
    await expect(service.render(
      makeTimeline({ kind: 'imageAsVideo' }),
      { resolution: 'original', format: 'mp4', quality: 'medium', burnSubtitles: false },
      () => { },
    )).rejects.toThrow();
  });
});
