/**
 * PersistedCostMeter —— localStorage 持久化成本计量（B1 成本持久化与预算告警）
 *
 * 背景：原 InMemoryCostMeter 内存存储，刷新即清空，无法支撑长期用量审计与预算管理。
 * 本实现：
 *   - 记录持久化到 localStorage（键 ai-video-studio:costMeter:records:v1），刷新不丢
 *   - 记录上限 1000 条，超过自动丢弃最旧记录
 *   - 支持月度 Token 预算（setBudget/getBudget），超出后 getBudgetExceeded() 供 UI 告警
 *   - 读取时校验记录结构，坏数据静默丢弃（不影响启动）
 *
 * 设计约束：实现 ICostMeter 接口（同步方法），业务服务无感知切换。
 */
import type { ICostMeter, CostRecord, CostSummary } from '../../domain/ports/CrossCuttingPorts';

const MAX_RECORDS = 1000;
const RECORDS_KEY = 'ai-video-studio:costMeter:records:v1';
const BUDGET_KEY = 'ai-video-studio:costMeter:budget:v1';

function safeStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // SSR / 隐私模式等场景降级为 null（仅内存）
  }
  return null;
}

function isValidRecord(r: unknown): r is CostRecord {
  if (!r || typeof r !== 'object') return false;
  const o = r as Record<string, unknown>;
  return typeof o.id === 'string'
    && typeof o.timestamp === 'number'
    && typeof o.platform === 'string'
    && typeof o.model === 'string'
    && typeof o.callType === 'string';
}

export class PersistedCostMeter implements ICostMeter {
  private records: CostRecord[] = [];
  private counter = 0;
  private budgetTokens: number | undefined;

  constructor() {
    this.loadPersisted();
  }

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
    this.persist();
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
    this.persist();
  }

  /** B3 全量备份恢复：批量导入历史记录（校验后合并，去重覆盖同 id） */
  restore(records: CostRecord[]): void {
    if (!Array.isArray(records)) return;
    const valid = records.filter(isValidRecord);
    const byId = new Map<string, CostRecord>(this.records.map(r => [r.id, r]));
    for (const r of valid) byId.set(r.id, r);
    const merged = Array.from(byId.values());
    // 保持时间序（恢复后仍按 timestamp 排序，供 getRecords 倒序展示）
    merged.sort((a, b) => a.timestamp - b.timestamp);
    this.records = merged.slice(-MAX_RECORDS);
    this.persist();
  }

  // ---------- B1 预算告警（接口扩展，业务服务通过 ICostMeter 无感知） ----------

  /** 设置 Token 预算阈值（undefined 表示不限制） */
  setBudget(tokens: number | undefined): void {
    this.budgetTokens = tokens && tokens > 0 ? tokens : undefined;
    const storage = safeStorage();
    if (!storage) return;
    try {
      if (this.budgetTokens === undefined) {
        storage.removeItem(BUDGET_KEY);
      } else {
        storage.setItem(BUDGET_KEY, String(this.budgetTokens));
      }
    } catch {
      // 存储不可用时静默降级（仅内存生效）
    }
  }

  getBudget(): number | undefined {
    return this.budgetTokens;
  }

  /** 是否已超出预算阈值（未设置预算返回 false） */
  getBudgetExceeded(): boolean {
    if (this.budgetTokens === undefined || this.budgetTokens <= 0) return false;
    return this.getSummary().totalTokens >= this.budgetTokens;
  }

  // ---------- 持久化 ----------

  private loadPersisted(): void {
    const storage = safeStorage();
    if (!storage) return;
    try {
      const raw = storage.getItem(RECORDS_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.records = parsed.filter(isValidRecord).slice(-MAX_RECORDS);
        }
      }
      const budgetRaw = storage.getItem(BUDGET_KEY);
      if (budgetRaw) {
        const n = Number(budgetRaw);
        if (Number.isFinite(n) && n > 0) this.budgetTokens = n;
      }
    } catch {
      // 数据损坏时从空记录开始（不阻断启动）
      this.records = [];
    }
  }

  private persist(): void {
    const storage = safeStorage();
    if (!storage) return;
    try {
      storage.setItem(RECORDS_KEY, JSON.stringify(this.records));
    } catch {
      // 配额满 / 隐私模式：忽略，保持内存语义
    }
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
