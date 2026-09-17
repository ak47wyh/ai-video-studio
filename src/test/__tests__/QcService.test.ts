import { describe, expect, it, vi } from 'vitest';
import { QcService } from '../../domain/services/QcService';
import type { IQcMediaPort } from '../../domain/ports/QcPorts';
import type { ILoggerPort } from '../../domain/ports/CrossCuttingPorts';

function makeLogger(): ILoggerPort {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => makeLogger()) as unknown as ILoggerPort['child'],
  } as unknown as ILoggerPort;
}

function makeMedia(overrides: Partial<IQcMediaPort> = {}): IQcMediaPort {
  return {
    probe: vi.fn(async () => ({ durationSec: 10, width: 1920, height: 1080 })),
    detectSilence: vi.fn(async () => []),
    detectBlackFrames: vi.fn(async () => []),
    detectLoudness: vi.fn(async () => ({ meanVolumeDb: -16.5, maxVolumeDb: -3.2 })),
    ...overrides,
  } as IQcMediaPort;
}

function makeService(media: IQcMediaPort) {
  return new QcService({ qcMedia: media, logger: makeLogger() });
}

describe('QcService 判定纯函数', () => {
  it('时长偏差在容差内不报错', () => {
    expect(QcService.evaluateDuration(10.5, 10)).toBeNull();
    expect(QcService.evaluateDuration(11.4, 10)).toBeNull(); // 14% < 15%
  });

  it('时长偏差超过 15% 判 error（regenerate）', () => {
    const issue = QcService.evaluateDuration(8, 10);
    expect(issue?.check).toBe('duration');
    expect(issue?.severity).toBe('error');
  });

  it('未指定期望时长时跳过检查', () => {
    expect(QcService.evaluateDuration(10)).toBeNull();
  });

  it('分辨率匹配不报错，不匹配判 warning（review）', () => {
    expect(QcService.evaluateResolution(1920, 1080, 1920, 1080)).toBeNull();
    const issue = QcService.evaluateResolution(1280, 720, 1920, 1080);
    expect(issue?.severity).toBe('warning');
  });

  it('静音单段超阈值判 error', () => {
    const issue = QcService.evaluateSilence(
      [{ startSec: 1, endSec: 3.5 }],
      10,
      { thresholdSec: 1.5, ratioLimit: 0.03 },
    );
    expect(issue?.check).toBe('silence');
    expect(issue?.severity).toBe('error');
  });

  it('静音总占比超限判 error（即使单段不超阈值）', () => {
    const issue = QcService.evaluateSilence(
      [{ startSec: 0.5, endSec: 1.2 }, { startSec: 3, endSec: 3.7 }],
      10,
      { thresholdSec: 1.5, ratioLimit: 0.03 },
    );
    // 共 1.4s = 14% > 3%，且 0.7s 单段均 < 1.5s
    expect(issue?.severity).toBe('error');
  });

  it('正常静音不报错', () => {
    expect(QcService.evaluateSilence([], 10, { thresholdSec: 1.5, ratioLimit: 0.03 })).toBeNull();
  });

  it('黑帧段超阈值判 warning', () => {
    const issue = QcService.evaluateBlackFrames([{ startSec: 2, endSec: 3.5 }], 1);
    expect(issue?.check).toBe('black_frames');
    expect(issue?.severity).toBe('warning');
  });

  it('音量峰值过低判 error', () => {
    const issue = QcService.evaluateLoudness({ meanVolumeDb: -40, maxVolumeDb: -30 }, -25);
    expect(issue?.check).toBe('loudness');
    expect(issue?.severity).toBe('error');
  });

  it('正常音量不报错', () => {
    expect(QcService.evaluateLoudness({ meanVolumeDb: -16.5, maxVolumeDb: -3.2 }, -25)).toBeNull();
  });

  it('字幕超出视频时长判 error', () => {
    const issue = QcService.evaluateSubtitleSync(11, 10);
    expect(issue?.check).toBe('subtitle_sync');
    expect(issue?.severity).toBe('error');
  });

  it('字幕在时长内不报错', () => {
    expect(QcService.evaluateSubtitleSync(9.8, 10)).toBeNull();
  });
});

describe('QcService.runQc 集成', () => {
  it('全部检查通过 → ok / passed', async () => {
    const media = makeMedia();
    const service = makeService(media);
    const report = await service.runQc({
      video: new Blob(),
      expectedDurationSec: 10,
      expectedWidth: 1920,
      expectedHeight: 1080,
      subtitleEndSec: 9.5,
    });
    expect(report.passed).toBe(true);
    expect(report.recommendation).toBe('ok');
    expect(report.issues).toHaveLength(0);
    expect(report.meta.durationSec).toBe(10);
  });

  it('存在 error 问题 → regenerate（综合建议降级）', async () => {
    const media = makeMedia({
      probe: vi.fn(async () => ({ durationSec: 6, width: 1280, height: 720 })),
    });
    const service = makeService(media);
    const report = await service.runQc({
      video: new Blob(),
      expectedDurationSec: 10,
      expectedWidth: 1920,
      expectedHeight: 1080,
      subtitleEndSec: 7,
    });
    expect(report.passed).toBe(false);
    expect(report.recommendation).toBe('regenerate');
    expect(report.issues.some(i => i.check === 'duration')).toBe(true);
    expect(report.issues.some(i => i.check === 'subtitle_sync')).toBe(true);
    expect(report.issues.some(i => i.check === 'resolution')).toBe(true); // warning 也保留
  });

  it('仅 warning 问题 → review（passed 仍为 true）', async () => {
    const media = makeMedia({
      probe: vi.fn(async () => ({ durationSec: 10, width: 1280, height: 720 })),
    });
    const service = makeService(media);
    const report = await service.runQc({
      video: new Blob(),
      expectedDurationSec: 10,
      expectedWidth: 1920,
      expectedHeight: 1080,
    });
    expect(report.passed).toBe(true);
    expect(report.recommendation).toBe('review');
  });

  it('探测失败 → probe error（regenerate）', async () => {
    const media = makeMedia({
      probe: vi.fn(async () => { throw new Error('corrupt file'); }),
    });
    const service = makeService(media);
    const report = await service.runQc({ video: new Blob() });
    expect(report.recommendation).toBe('regenerate');
    expect(report.issues[0]?.check).toBe('probe');
  });

  it('单次探测失败降级为 warning 且不影响整体结论', async () => {
    const media = makeMedia({
      detectBlackFrames: vi.fn(async () => { throw new Error('filter unsupported'); }),
    });
    const service = makeService(media);
    const report = await service.runQc({ video: new Blob(), expectedDurationSec: 10 });
    expect(report.passed).toBe(true);
    expect(report.issues.find(i => i.check === 'black_frames')?.severity).toBe('warning');
  });
});

describe('QcService.toSnapshot 持久化快照（P2-8）', () => {
  it('报告映射为 FinalCut.qcReport 快照结构', () => {
    const report = {
      passed: false,
      recommendation: 'regenerate' as const,
      issues: [
        { check: 'duration', severity: 'error' as const, message: '时长偏差 20%' },
        { check: 'black_frames', severity: 'warning' as const, message: '黑帧 1.5s' },
      ],
      meta: { durationSec: 8, checkedAt: 1700000000000 },
    };
    const snap = QcService.toSnapshot(report);
    expect(snap.passed).toBe(false);
    expect(snap.recommendation).toBe('regenerate');
    expect(snap.issueCount).toBe(2);
    expect(snap.issues[0]).toEqual({ check: 'duration', severity: 'error', message: '时长偏差 20%' });
    expect(snap.checkedAt).toBe(1700000000000);
  });

  it('全部通过时快照无问题项', () => {
    const report = {
      passed: true,
      recommendation: 'ok' as const,
      issues: [],
      meta: { durationSec: 10, checkedAt: 100 },
    };
    const snap = QcService.toSnapshot(report);
    expect(snap.passed).toBe(true);
    expect(snap.issueCount).toBe(0);
    expect(snap.issues).toHaveLength(0);
  });
});
