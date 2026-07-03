/**
 * InMemoryCostMeter —— 内存成本计量实现
 *
 * M3.4 成本可视化（EVOLUTION_DESIGN.md §7.4）：
 *   聚合所有 AI 调用的 Token 用量，提供成本查询。
 *
 * 设计：
 *   - 内存存储，重启清空（满足当前 Local-First 架构）
 *   - 记录上限 1000 条，超过自动丢弃最旧记录
 *   - 所有方法同步，无 IO 阻塞
 *
 * 未来可扩展为 DexieCostMeter 持久化到 IndexedDB。
 */

import type { ICostMeter, CostRecord, CostSummary } from '../../../domain/ports/CrossCuttingPorts';

const MAX_RECORDS = 1000;

export class InMemoryCostMeter implements ICostMeter {
  private records: CostRecord[] = [];
  private counter = 0;

  record(input: Omit<CostRecord, 'id' | 'timestamp'>): void {
    const record: CostRecord = {
      ...input,
      id: `cost-${Date.now()}-${++this.counter}`,
      timestamp: Date.now(),
    };

    this.records.push(record);

    // 超过上限丢弃最旧记录
    if (this.records.length > MAX_RECORDS) {
      this.records.shift();
    }
  }

  getSummary(filter?: { spaceId?: string; storyId?: string; pipelineTaskId?: string }): CostSummary {
    const filtered = this.applyFilter(filter);

    const summary: CostSummary = {
      totalCalls: filtered.length,
      totalTokens: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      byPlatform: {},
      byModel: {},
      byCallType: {},
      period: { start: 0, end: 0 },
    };

    for (const r of filtered) {
      const tokens = r.usage?.totalTokens ?? 0;
      const inputTokens = r.usage?.inputTokens ?? 0;
      const outputTokens = r.usage?.outputTokens ?? 0;

      summary.totalTokens += tokens;
      summary.totalInputTokens += inputTokens;
      summary.totalOutputTokens += outputTokens;

      if (!summary.byPlatform[r.platform]) summary.byPlatform[r.platform] = { calls: 0, tokens: 0 };
      summary.byPlatform[r.platform].calls++;
      summary.byPlatform[r.platform].tokens += tokens;

      if (!summary.byModel[r.model]) summary.byModel[r.model] = { calls: 0, tokens: 0 };
      summary.byModel[r.model].calls++;
      summary.byModel[r.model].tokens += tokens;

      if (!summary.byCallType[r.callType]) summary.byCallType[r.callType] = { calls: 0, tokens: 0 };
      summary.byCallType[r.callType].calls++;
      summary.byCallType[r.callType].tokens += tokens;

      if (summary.period.start === 0 || r.timestamp < summary.period.start) {
        summary.period.start = r.timestamp;
      }
      if (r.timestamp > summary.period.end) {
        summary.period.end = r.timestamp;
      }
    }

    return summary;
  }

  getRecords(filter?: { spaceId?: string; storyId?: string; pipelineTaskId?: string }, limit = 100): CostRecord[] {
    const filtered = this.applyFilter(filter);
    return filtered.slice(-limit).reverse();
  }

  clear(): void {
    this.records = [];
    this.counter = 0;
  }

  private applyFilter(filter?: { spaceId?: string; storyId?: string; pipelineTaskId?: string }): CostRecord[] {
    if (!filter) return this.records;
    return this.records.filter(r => {
      if (filter.spaceId && r.spaceId !== filter.spaceId) return false;
      if (filter.storyId && r.storyId !== filter.storyId) return false;
      if (filter.pipelineTaskId && r.pipelineTaskId !== filter.pipelineTaskId) return false;
      return true;
    });
  }
}
