import type { ICostMeter, CostRecord } from '../ports/CrossCuttingPorts';

/**
 * 单条平台聚合。
 */
export interface PlatformUsage {
  calls: number;
  tokens: number;
}

/**
 * 预算视图（token 预算）。
 */
export interface BudgetView {
  /** 未设置预算时为 undefined */
  budgetTokens?: number;
  /** 已用 token（= 全部调用 token 合计） */
  usedTokens: number;
  /** 是否超出预算 */
  exceeded: boolean;
  /** 使用率 0-1（未设置预算为 0） */
  usageRatio: number;
}

/**
 * 每日趋势点。
 */
export interface DailyTrendPoint {
  /** 'MM-DD' */
  date: string;
  calls: number;
  tokens: number;
}

/**
 * 用量报表。
 */
export interface UsageReport {
  totalCalls: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byPlatform: Array<{ platform: string; calls: number; tokens: number }>;
  byCallType: Array<{ callType: string; calls: number; tokens: number }>;
  dailyTrend: DailyTrendPoint[];
  budget: BudgetView;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function fmtDay(ts: number): string {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}-${dd}`;
}

/**
 * P0-2 成本与产出报表：对 ICostMeter 记录做平台/模态/时间聚合。
 *
 * 口径说明（诚实约束）：CostRecord 仅含调用次数与 Token 用量，
 * 不含失败标记与金额，故报表不输出"成功率"与"单位成本"等无数据支撑的指标。
 */
export class CostAnalyticsService {
  private readonly costMeter: ICostMeter;

  constructor(costMeter: ICostMeter) {
    this.costMeter = costMeter;
  }

  getUsageReport(opts: { days?: number } = {}): UsageReport {
    const records = this.costMeter.getRecords();
    const days = opts.days ?? 7;

    let totalCalls = 0;
    let totalTokens = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const byPlatform = new Map<string, PlatformUsage>();
    const byCallType = new Map<string, PlatformUsage>();
    const trend = new Map<string, DailyTrendPoint>();

    const cutoff = Date.now() - days * DAY_MS;
    for (const r of records) {
      totalCalls += 1;
      const tokens = this.tokensOf(r);
      totalTokens += tokens;
      totalInputTokens += r.usage?.inputTokens ?? 0;
      totalOutputTokens += r.usage?.outputTokens ?? 0;

      this.add(byPlatform, r.platform, tokens);
      this.add(byCallType, r.callType, tokens);

      if (r.timestamp >= cutoff) {
        const day = fmtDay(r.timestamp);
        const cur = trend.get(day) ?? { date: day, calls: 0, tokens: 0 };
        cur.calls += 1;
        cur.tokens += tokens;
        trend.set(day, cur);
      }
    }

    // 趋势补全最近 days 天（无记录的天补 0，保证图表连续）
    const dailyTrend: DailyTrendPoint[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = days - 1; i >= 0; i--) {
      const ts = today.getTime() - i * DAY_MS;
      const day = fmtDay(ts);
      dailyTrend.push(trend.get(day) ?? { date: day, calls: 0, tokens: 0 });
    }

    const budgetTokens = this.costMeter.getBudget?.();
    const exceeded = this.costMeter.getBudgetExceeded?.() ?? false;
    const usageRatio = budgetTokens && budgetTokens > 0 ? Math.min(1, totalTokens / budgetTokens) : 0;

    return {
      totalCalls,
      totalTokens,
      totalInputTokens,
      totalOutputTokens,
      byPlatform: [...byPlatform.entries()]
        .map(([platform, u]) => ({ platform, calls: u.calls, tokens: u.tokens }))
        .sort((a, b) => b.tokens - a.tokens || b.calls - a.calls),
      byCallType: [...byCallType.entries()]
        .map(([callType, u]) => ({ callType, calls: u.calls, tokens: u.tokens }))
        .sort((a, b) => b.tokens - a.tokens || b.calls - a.calls),
      dailyTrend,
      budget: {
        budgetTokens,
        usedTokens: totalTokens,
        exceeded,
        usageRatio,
      },
    };
  }

  private tokensOf(r: CostRecord): number {
    return r.usage?.totalTokens ?? 0;
  }

  private add(map: Map<string, PlatformUsage>, key: string, tokens: number): void {
    const cur = map.get(key) ?? { calls: 0, tokens: 0 };
    cur.calls += 1;
    cur.tokens += tokens;
    map.set(key, cur);
  }
}
