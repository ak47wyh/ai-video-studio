import { describe, expect, it, vi } from 'vitest';
import { ComplianceService, PLATFORM_SPECS } from '../../domain/services/ComplianceService';
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

function makeService() {
  return new ComplianceService({ logger: makeLogger() });
}

describe('ComplianceService 平台发布预检（P2-9）', () => {
  it('全部通过 → passed', () => {
    const service = makeService();
    const r = service.preflight({
      durationSec: 60,
      resolution: '1080P',
      hasSubtitles: true,
      text: '正常文案',
      sensitiveWords: [],
      aiMetadataWritten: true,
      aspectRatio: '9:16',
    }, 'douyin');
    expect(r.passed).toBe(true);
    expect(r.rules.every(x => x.passed)).toBe(true);
  });

  it('时长超过平台上限 → error 阻止发布', () => {
    const service = makeService();
    const r = service.preflight({ durationSec: 2000 }, 'douyin');
    expect(r.passed).toBe(false);
    const rule = r.rules.find(x => x.id === 'duration');
    expect(rule?.severity).toBe('error');
  });

  it('B站上限 4 小时，超长片仅 B站 可通过', () => {
    const service = makeService();
    const douyin = service.preflight({ durationSec: 7200 }, 'douyin');
    const bili = service.preflight({ durationSec: 7200 }, 'bilibili');
    expect(douyin.passed).toBe(false);
    expect(bili.rules.find(x => x.id === 'duration')?.passed).toBe(true);
  });

  it('分辨率低于平台建议 → warning 不阻止', () => {
    const service = makeService();
    const r = service.preflight({ durationSec: 60, resolution: '512P' }, 'douyin');
    expect(r.passed).toBe(true); // warning 不阻止
    const rule = r.rules.find(x => x.id === 'resolution');
    expect(rule?.severity).toBe('warning');
    expect(rule?.passed).toBe(false);
  });

  it('画面比例不符 → warning 提示', () => {
    const service = makeService();
    const r = service.preflight({ durationSec: 60, aspectRatio: '16:9' }, 'douyin');
    const rule = r.rules.find(x => x.id === 'aspect_ratio');
    expect(rule?.passed).toBe(false);
    expect(rule?.severity).toBe('warning');
  });

  it('无字幕 → warning 提示', () => {
    const service = makeService();
    const r = service.preflight({ durationSec: 60, hasSubtitles: false }, 'generic');
    expect(r.rules.find(x => x.id === 'subtitles')?.passed).toBe(false);
  });

  it('未知平台回退通用规格', () => {
    const service = makeService();
    const r = service.preflight({ durationSec: 3600 }, 'unknown');
    expect(r.passed).toBe(true);
    expect(r.spec.platform).toBe('unknown');
    expect(r.rules.find(x => x.id === 'duration')?.passed).toBe(true);
  });
});

describe('ComplianceService 敏感词检查（P2-9）', () => {
  it('默认空词表不命中', () => {
    const service = makeService();
    expect(service.checkSensitiveWords('任意内容', [])).toEqual([]);
  });

  it('命中词表返回命中词', () => {
    const service = makeService();
    expect(service.checkSensitiveWords('包含敏感词甲的文案', ['甲', '乙'])).toEqual(['甲']);
  });

  it('大小写不敏感', () => {
    const service = makeService();
    expect(service.checkSensitiveWords('HELLO WORLD', ['hello'])).toEqual(['hello']);
  });

  it('空文本不命中', () => {
    const service = makeService();
    expect(service.checkSensitiveWords('', ['x'])).toEqual([]);
  });
});

describe('ComplianceService AI 生成标识（P2-9）', () => {
  it('构建 AI 元数据声明', () => {
    const service = makeService();
    const meta = service.buildAiMetadata(3);
    expect(meta.aiGenerated).toBe(true);
    expect(meta.generator).toBe('ai-video-studio');
    expect(meta.sourceVersion).toBe(3);
  });

  it('序列化包含全部关键字段', () => {
    const service = makeService();
    const s = service.serializeAiMetadata(service.buildAiMetadata(2));
    expect(s).toContain('ai-generated:true');
    expect(s).toContain('generator:ai-video-studio');
    expect(s).toContain('generated-at:');
    expect(s).toContain('source-version:2');
  });

  it('无版本号时不输出 source-version', () => {
    const service = makeService();
    const s = service.serializeAiMetadata(service.buildAiMetadata());
    expect(s).not.toContain('source-version');
  });
});

describe('ComplianceService 平台规格表', () => {
  it('三平台规格齐全且时长上限合理', () => {
    expect(PLATFORM_SPECS.douyin.maxDurationSec).toBe(900);
    expect(PLATFORM_SPECS.bilibili.maxDurationSec).toBe(14400);
    expect(PLATFORM_SPECS.generic.maxDurationSec).toBeGreaterThanOrEqual(86400);
  });
});
