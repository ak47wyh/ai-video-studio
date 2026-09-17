/**
 * P0-2 成本与产出报表：CostAnalyticsService 聚合逻辑
 *
 * 覆盖：
 * - 总量（calls/tokens/input/output）
 * - 按平台/模态聚合与降序排序
 * - 近 N 天趋势（补零、按日归并）
 * - 预算使用率与超限标记
 * - 无记录空态
 */
import { describe, it, expect, vi } from 'vitest';
import { CostAnalyticsService } from '../../domain/services/CostAnalyticsService';
import type { ICostMeter, CostRecord } from '../../domain/ports/CrossCuttingPorts';

function makeMeter(records: CostRecord[], budget?: number, exceeded = false): ICostMeter {
  return {
    record: vi.fn(),
    getSummary: vi.fn() as unknown as ICostMeter['getSummary'],
    getRecords: vi.fn(() => records),
    clear: vi.fn(),
    getBudget: () => budget,
    getBudgetExceeded: () => exceeded,
  } as unknown as ICostMeter;
}

function rec(partial: Partial<CostRecord> & { platform: string; callType: CostRecord['callType']; timestamp: number }): CostRecord {
  return {
    id: `c-${partial.timestamp}-${partial.platform}`,
    model: 'm',
    ...partial,
    ...(partial.usage ? { usage: partial.usage } : {}),
  } as CostRecord;
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

describe('CostAnalyticsService — 用量报表聚合', () => {
  it('汇总调用次数与 Token 总量（含输入/输出）', () => {
    const svc = new CostAnalyticsService(makeMeter([
      rec({ platform: 'minimax', callType: 'text', timestamp: NOW, usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } }),
      rec({ platform: 'minimax', callType: 'video', timestamp: NOW }),
      rec({ platform: 'volcengine', callType: 'voice', timestamp: NOW }),
    ]));
    const r = svc.getUsageReport();
    expect(r.totalCalls).toBe(3);
    expect(r.totalTokens).toBe(150);
    expect(r.totalInputTokens).toBe(100);
    expect(r.totalOutputTokens).toBe(50);
  });

  it('按平台与模态聚合，按 token 降序', () => {
    const svc = new CostAnalyticsService(makeMeter([
      rec({ platform: 'minimax', callType: 'video', timestamp: NOW }),
      rec({ platform: 'minimax', callType: 'text', timestamp: NOW, usage: { inputTokens: 200, outputTokens: 0, totalTokens: 200 } }),
      rec({ platform: 'volcengine', callType: 'voice', timestamp: NOW, usage: { inputTokens: 30, outputTokens: 10, totalTokens: 40 } }),
    ]));
    const r = svc.getUsageReport();
    expect(r.byPlatform).toEqual([
      { platform: 'minimax', calls: 2, tokens: 200 },
      { platform: 'volcengine', calls: 1, tokens: 40 },
    ]);
    expect(r.byCallType[0]).toEqual({ callType: 'text', calls: 1, tokens: 200 });
  });

  it('近 N 天趋势：按日归并且无记录的天补零', () => {
    const svc = new CostAnalyticsService(makeMeter([
      rec({ platform: 'minimax', callType: 'text', timestamp: NOW, usage: { inputTokens: 10, outputTokens: 0, totalTokens: 10 } }),
      rec({ platform: 'minimax', callType: 'text', timestamp: NOW - 60000, usage: { inputTokens: 20, outputTokens: 0, totalTokens: 20 } }),
      rec({ platform: 'minimax', callType: 'video', timestamp: NOW - 3 * DAY }),
    ]));
    const r = svc.getUsageReport({ days: 7 });
    expect(r.dailyTrend).toHaveLength(7);
    // 今天：2 次调用 30 tokens
    expect(r.dailyTrend[6].calls).toBe(2);
    expect(r.dailyTrend[6].tokens).toBe(30);
    // 3 天前：1 次调用 0 token（视频无 usage）
    expect(r.dailyTrend[3].calls).toBe(1);
    // 其余天补零
    expect(r.dailyTrend[0].calls).toBe(0);
  });

  it('预算：未设置返回 usageRatio 0 且不超限；设置后按总量计算使用率', () => {
    const noBudget = new CostAnalyticsService(makeMeter([
      rec({ platform: 'minimax', callType: 'text', timestamp: NOW, usage: { inputTokens: 50, outputTokens: 0, totalTokens: 50 } }),
    ]));
    expect(noBudget.getUsageReport().budget).toMatchObject({ budgetTokens: undefined, exceeded: false, usageRatio: 0 });

    const withBudget = new CostAnalyticsService(makeMeter([
      rec({ platform: 'minimax', callType: 'text', timestamp: NOW, usage: { inputTokens: 50, outputTokens: 0, totalTokens: 50 } }),
    ], 200));
    const b = withBudget.getUsageReport().budget;
    expect(b.budgetTokens).toBe(200);
    expect(b.usedTokens).toBe(50);
    expect(b.usageRatio).toBeCloseTo(0.25);
    expect(b.exceeded).toBe(false);
  });

  it('超限标记透传，使用率封顶 1', () => {
    const svc = new CostAnalyticsService(makeMeter([
      rec({ platform: 'minimax', callType: 'text', timestamp: NOW, usage: { inputTokens: 300, outputTokens: 0, totalTokens: 300 } }),
    ], 200, true));
    const b = svc.getUsageReport().budget;
    expect(b.exceeded).toBe(true);
    expect(b.usageRatio).toBe(1);
  });

  it('无记录返回全零报表（趋势仍补满 N 天）', () => {
    const svc = new CostAnalyticsService(makeMeter([]));
    const r = svc.getUsageReport({ days: 3 });
    expect(r.totalCalls).toBe(0);
    expect(r.totalTokens).toBe(0);
    expect(r.byPlatform).toEqual([]);
    expect(r.dailyTrend).toHaveLength(3);
  });
});
