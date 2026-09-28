/**
 * SYSTEM_OPTIMIZATION_PLAN_PHASE2 T-3：渲染进度 stage i18n 化
 * - domain 不再输出中文字符串，RenderProgress.stage 为 RenderStageKey 联合类型
 * - 断言渲染全程 stage 均为 key（无中文字符），首尾阶段符合预期
 */
import { describe, expect, it, vi } from 'vitest';
import { TimelineRenderService } from '../../domain/services/TimelineRenderService';
import type { RenderProgress, RenderStageKey } from '../../domain/ports/TimelineRenderPorts';
import type { Timeline } from '../../domain/ports/PostProcessPorts';

const STAGE_KEYS: RenderStageKey[] = [
  'render.stage.loadingEngine',
  'render.stage.parsingClips',
  'render.stage.concatVideo',
  'render.stage.mixingAudio',
  'render.stage.burningSubtitles',
  'render.stage.postProcess',
  'render.stage.finalizing',
];

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

describe('TimelineRenderService T-3 stage i18n', () => {
  it('渲染进度 stage 全部为 RenderStageKey（无中文字符串泄漏）', async () => {
    const logger = makeLogger();
    const deps = {
      ffmpegPort: makeFfmpeg(),
      fileStorage: { getBlob: vi.fn(async () => new Blob(['v'])), putBlob: vi.fn(async () => ''), deleteBlob: vi.fn(async () => { }), listBlobs: vi.fn(async () => []) },
      videoTaskRepo: { findById: vi.fn(async () => ({ status: 'SUCCESS', videoUrl: 'https://cdn/v.mp4', videoStoragePath: 'opfs://v', duration: 2 })) },
      finalCutRepo: { findById: vi.fn(async () => null) },
      savedVideoRepo: { getById: vi.fn(async () => null) },
      savedVoiceRepo: { getById: vi.fn(async () => null) },
      logger,
      httpFetch: { fetchBlob: vi.fn(async () => new Blob()) },
    };
    const service = new TimelineRenderService(deps as never);

    const timeline: Timeline = {
      id: 'tl-1',
      storyId: 'story-1',
      duration: 2000,
      transitions: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tracks: [{
        id: 'tr-1', type: 'video',
        clips: [{
          id: 'c-1', type: 'video', trackId: 'tr-1', startTime: 0, duration: 2000,
          sourceRef: { kind: 'videoTask', refId: 'task-1' },
        }],
      }],
    };

    const stages: RenderProgress[] = [];
    const result = await service.render(
      timeline,
      { resolution: 'original', format: 'mp4', quality: 'medium', burnSubtitles: false },
      (p) => stages.push(p),
    );

    expect(result).toBeInstanceOf(Blob);
    expect(stages.length).toBeGreaterThan(0);
    for (const p of stages) {
      expect(STAGE_KEYS).toContain(p.stage);
      expect(p.stage).not.toMatch(/[\u4e00-\u9fff]/);
    }
    expect(stages[0].stage).toBe('render.stage.loadingEngine');
    expect(stages[stages.length - 1].stage).toBe('render.stage.finalizing');
  });
});
