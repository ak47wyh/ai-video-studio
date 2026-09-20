/**
 * C1 补充：PersistedCostMeter 成本持久化（B1）+ 全量备份恢复（B3）
 *
 * 覆盖：
 * - record → getSummary 汇总（调用次数 / token / 按模型分组）
 * - localStorage 持久化（新实例可读回）
 * - 按 spaceId/storyId 过滤
 * - clear 清空 / restore 批量导入 / 预算阈值告警
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { PersistedCostMeter } from '../../adapters/outbound/PersistedCostMeter';
import type { CostRecord, CostSummary } from '../../domain/ports/CrossCuttingPorts';

function makeRecord(overrides: Partial<CostRecord> = {}): CostRecord {
  return {
    id: 'c-' + Math.random().toString(36).slice(2),
    platform: 'minimax',
    model: 'MiniMax-M2.5',
    callType: 'text',
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    timestamp: Date.now(),
    ...overrides,
  } as CostRecord;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('PersistedCostMeter — 记录与汇总（B1）', () => {
  it('record 后 getSummary 汇总调用次数与 token', () => {
    const meter = new PersistedCostMeter();
    meter.record(makeRecord());
    meter.record(makeRecord());
    const summary = meter.getSummary();
    expect(summary.totalCalls).toBe(2);
    expect(summary.totalTokens).toBe(300);
    expect(summary.byModel['MiniMax-M2.5'].calls).toBe(2);
  });

  it('无记录时汇总为空结构（不抛错）', () => {
    const meter = new PersistedCostMeter();
    const summary: CostSummary = meter.getSummary();
    expect(summary.totalCalls).toBe(0);
    expect(summary.totalTokens).toBe(0);
  });

  it('getRecords 按时间倒序返回并支持 limit', () => {
    // record 强制 Date.now() 时间戳，用 restore 注入可控 timestamp 验证排序
    const meter = new PersistedCostMeter();
    meter.restore([
      makeRecord({ id: 'a', timestamp: 1000 }),
      makeRecord({ id: 'b', timestamp: 2000 }),
      makeRecord({ id: 'c', timestamp: 3000 }),
    ]);
    const all = meter.getRecords();
    expect(all.map(r => r.id)).toEqual(['c', 'b', 'a']);
    expect(meter.getRecords(undefined, 2).map(r => r.id)).toEqual(['c', 'b']);
  });

  it('按 spaceId/storyId 过滤汇总', () => {
    const meter = new PersistedCostMeter();
    meter.record(makeRecord({ spaceId: 'sp-1', storyId: 'st-1' }));
    meter.record(makeRecord({ spaceId: 'sp-1', storyId: 'st-2' }));
    meter.record(makeRecord({ spaceId: 'sp-2' }));
    expect(meter.getSummary({ spaceId: 'sp-1' }).totalCalls).toBe(2);
    expect(meter.getSummary({ spaceId: 'sp-1', storyId: 'st-1' }).totalCalls).toBe(1);
    expect(meter.getSummary({ spaceId: 'sp-2' }).totalCalls).toBe(1);
  });
});

describe('PersistedCostMeter — localStorage 持久化（B1）', () => {
  it('新实例可读回上一实例写入的记录', () => {
    // record 会生成新 id（cost-<ts>-<n>），断言记录结构与内容而非 id
    const a = new PersistedCostMeter();
    a.record(makeRecord({ model: 'persist-model' }));
    const b = new PersistedCostMeter();
    const records = b.getRecords();
    expect(records.length).toBeGreaterThan(0);
    expect(records[0].model).toBe('persist-model');
  });

  it('clear 后持久化数据一并清空', () => {
    const a = new PersistedCostMeter();
    a.record(makeRecord({ id: 'gone-1' }));
    a.clear();
    const b = new PersistedCostMeter();
    expect(b.getRecords()).toHaveLength(0);
  });
});

describe('PersistedCostMeter — 备份恢复与预算（B3）', () => {
  it('restore 批量导入历史记录并持久化', () => {
    const backup = [makeRecord({ id: 'r1' }), makeRecord({ id: 'r2' })];
    const meter = new PersistedCostMeter();
    meter.restore(backup);
    expect(meter.getRecords()).toHaveLength(2);
    const fresh = new PersistedCostMeter();
    expect(fresh.getRecords()).toHaveLength(2);
  });

  it('restore 与现有记录合并，同 id 覆盖', () => {
    const meter = new PersistedCostMeter();
    meter.restore([makeRecord({ id: 'old-1', model: 'v1' })]);
    meter.restore([makeRecord({ id: 'old-1', model: 'v2' }), makeRecord({ id: 'new-1' })]);
    const records = meter.getRecords();
    expect(records).toHaveLength(2);
    expect(records.find(r => r.id === 'old-1')?.model).toBe('v2');
    expect(records.some(r => r.id === 'new-1')).toBe(true);
  });

  it('预算阈值：超限后 getBudgetExceeded 为 true', () => {
    const meter = new PersistedCostMeter();
    meter.setBudget(100);
    expect(meter.getBudgetExceeded()).toBe(false);
    meter.record(makeRecord({ usage: { inputTokens: 60, outputTokens: 60, totalTokens: 120 } }));
    expect(meter.getBudgetExceeded()).toBe(true);
  });

  it('未设置预算时 getBudget 返回 undefined 且永不超限', () => {
    const meter = new PersistedCostMeter();
    expect(meter.getBudget()).toBeUndefined();
    meter.record(makeRecord());
    expect(meter.getBudgetExceeded()).toBe(false);
  });
});

describe('PersistedCostMeter — 告警阈值（P3-3）', () => {
  it('默认阈值为 80', () => {
    const meter = new PersistedCostMeter();
    expect(meter.getBudgetThresholdPct()).toBe(80);
  });

  it('钳制 1-100 并持久化（新实例可读回）', () => {
    const a = new PersistedCostMeter();
    a.setBudgetThresholdPct(120);
    expect(a.getBudgetThresholdPct()).toBe(100);
    a.setBudgetThresholdPct(0);
    expect(a.getBudgetThresholdPct()).toBe(1);
    a.setBudgetThresholdPct(65);
    expect(a.getBudgetThresholdPct()).toBe(65);
    const b = new PersistedCostMeter();
    expect(b.getBudgetThresholdPct()).toBe(65);
  });

  it('非法值回退 80', () => {
    const meter = new PersistedCostMeter();
    meter.setBudgetThresholdPct(Number.NaN);
    expect(meter.getBudgetThresholdPct()).toBe(80);
  });
});
