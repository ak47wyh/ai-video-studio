import { describe, expect, it, vi } from 'vitest';
import { VersionCompareService } from '../../domain/services/VersionCompareService';
import type { FinalCut } from '../../domain/entities/models';
import type { ICostMeter, ILoggerPort } from '../../domain/ports/CrossCuttingPorts';

function makeLogger(): ILoggerPort {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => makeLogger()) as unknown as ILoggerPort['child'],
  } as unknown as ILoggerPort;
}

function makeCut(overrides: Partial<FinalCut>): FinalCut {
  return {
    id: 'c-1',
    storyId: 's-1',
    videoBlob: new Blob(),
    duration: 10000,
    size: 1024,
    hasSubtitles: true,
    createdAt: 1700000000000,
    ...overrides,
  } as FinalCut;
}

function makeCostMeter(): ICostMeter {
  return {
    record: vi.fn(),
    getSummary: vi.fn(() => ({
      totalCalls: 0,
      totalTokens: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      byPlatform: {},
      byModel: {},
      byCallType: {},
      period: { start: 0, end: 0 },
    })),
    getRecords: vi.fn(() => []),
    clear: vi.fn(),
  } as unknown as ICostMeter;
}

function makeService(costMeter: ICostMeter = makeCostMeter()) {
  return new VersionCompareService({ costMeter, logger: makeLogger() });
}

describe('VersionCompareService.buildVersionTree（P2-10）', () => {
  it('单版本为根节点', () => {
    const tree = VersionCompareService.buildVersionTree([makeCut({ id: 'v1', version: 1 })]);
    expect(tree).toHaveLength(1);
    expect(tree[0].depth).toBe(0);
    expect(tree[0].children).toHaveLength(0);
  });

  it('回改链构建为父子层级（v1 → v2 → v3）', () => {
    const cuts = [
      makeCut({ id: 'v1', version: 1, createdAt: 100 }),
      makeCut({ id: 'v2', version: 2, sourceVersionId: 'v1', createdAt: 200 }),
      makeCut({ id: 'v3', version: 3, sourceVersionId: 'v2', createdAt: 300 }),
    ];
    const tree = VersionCompareService.buildVersionTree(cuts);
    expect(tree).toHaveLength(1);
    expect(tree[0].cut.id).toBe('v1');
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].cut.id).toBe('v2');
    expect(tree[0].children[0].children[0].cut.id).toBe('v3');
    expect(tree[0].children[0].children[0].depth).toBe(2);
  });

  it('分叉版本：同一父版本多个子版本', () => {
    const cuts = [
      makeCut({ id: 'v1', version: 1, createdAt: 100 }),
      makeCut({ id: 'v2a', version: 2, sourceVersionId: 'v1', createdAt: 200 }),
      makeCut({ id: 'v2b', version: 2, sourceVersionId: 'v1', createdAt: 250 }),
    ];
    const tree = VersionCompareService.buildVersionTree(cuts);
    expect(tree[0].children).toHaveLength(2);
    expect(tree[0].children.map(n => n.cut.id)).toEqual(['v2a', 'v2b']); // createdAt 升序
  });

  it('父缺失的版本提升为根（不丢失节点）', () => {
    const cuts = [
      makeCut({ id: 'v1', version: 1, createdAt: 100 }),
      makeCut({ id: 'orphan', version: 2, sourceVersionId: 'missing', createdAt: 200 }),
    ];
    const tree = VersionCompareService.buildVersionTree(cuts);
    expect(tree).toHaveLength(2);
  });

  it('多故事混合时仅按版本链分组，不跨链串接', () => {
    const cuts = [
      makeCut({ id: 'a1', storyId: 's-1', version: 1, createdAt: 100 }),
      makeCut({ id: 'b1', storyId: 's-2', version: 1, createdAt: 150 }),
    ];
    const tree = VersionCompareService.buildVersionTree(cuts);
    expect(tree).toHaveLength(2);
  });
});

describe('VersionCompareService.listVersionsByStory（P2-10）', () => {
  it('按 version 升序返回同故事版本', () => {
    const service = makeService();
    const cuts = [
      makeCut({ id: 'v2', version: 2, createdAt: 200 }),
      makeCut({ id: 'v1', version: 1, createdAt: 100 }),
      makeCut({ id: 'other', storyId: 's-2', version: 1, createdAt: 150 }),
    ];
    const list = service.listVersionsByStory(cuts, 's-1');
    expect(list.map(c => c.id)).toEqual(['v1', 'v2']);
  });
});

describe('VersionCompareService.getVersionCost（P2-10）', () => {
  it('无 pipelineTaskId 时不可归因', () => {
    const service = makeService();
    const cost = service.getVersionCost(undefined);
    expect(cost.attributable).toBe(false);
    expect(cost.callCount).toBe(0);
  });

  it('按 pipelineTaskId 查询成本摘要', () => {
    const costMeter = makeCostMeter();
    vi.mocked(costMeter.getSummary).mockReturnValue({
      totalCalls: 12,
      totalTokens: 3400,
      totalInputTokens: 2000,
      totalOutputTokens: 1400,
      byPlatform: { minimax: { calls: 12, tokens: 3400 } },
      byModel: { 'MiniMax-Hailuo-2.3': { calls: 8, tokens: 0 }, 'DeepSeek-V3': { calls: 4, tokens: 3400 } },
      byCallType: { text: { calls: 4, tokens: 3400 }, video: { calls: 8, tokens: 0 } },
      period: { start: 100, end: 200 },
    });
    const service = makeService(costMeter);
    const cost = service.getVersionCost('task-9');
    expect(cost.attributable).toBe(true);
    expect(cost.callCount).toBe(12);
    expect(cost.tokenCount).toBe(3400);
    expect(cost.byModel['MiniMax-Hailuo-2.3']).toBe(8);
    expect(costMeter.getSummary).toHaveBeenCalledWith({ pipelineTaskId: 'task-9' });
  });
});
