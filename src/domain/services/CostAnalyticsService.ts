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
  /** P3-3 告警阈值百分比（默认 80，用于临近预警） */
  thresholdPct: number;
  /** 是否临近阈值（未超出但已达阈值） */
  nearLimit: boolean;
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
    const thresholdPct = this.costMeter.getBudgetThresholdPct?.() ?? 80;
    const nearLimit = budgetTokens !== undefined && budgetTokens > 0 && !exceeded && usageRatio >= thresholdPct / 100;

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
        thresholdPct,
        nearLimit,
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
  /** P3-3 成本报表导出 CSV（与面板同源：getUsageReport 单一数据源） */
  static buildUsageReportCsv(report: UsageReport): string {
    const esc = (v: string | number): string => String(v).replace(/,/g, '，');
    const lines: string[] = [];
    lines.push('类型,名称,调用次数,Token 用量');
    lines.push('汇总,全部,' + report.totalCalls + ',' + report.totalTokens);
    lines.push('');
    lines.push('按平台,,,');
    for (const pl of report.byPlatform) lines.push('平台,' + esc(pl.platform) + ',' + pl.calls + ',' + pl.tokens);
    lines.push('');
    lines.push('按调用类型,,,');
    for (const ct of report.byCallType) lines.push('类型,' + esc(ct.callType) + ',' + ct.calls + ',' + ct.tokens);
    lines.push('');
    lines.push('近日趋势,,,');
    for (const d of report.dailyTrend) lines.push('日期,' + d.date + ',' + d.calls + ',' + d.tokens);
    lines.push('');
    lines.push('预算,' + (report.budget.budgetTokens ?? '未设置') + ',' + report.budget.usedTokens + ',已用');
    lines.push('告警,阈值' + report.budget.thresholdPct + '%,' + (report.budget.nearLimit ? '临近' : '正常') + ',' + (report.budget.exceeded ? '已超出' : '未超出'));
    return lines.join('\r\n');
  }
}