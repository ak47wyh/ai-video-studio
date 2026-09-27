import type { FinalCut, PublishTask } from '../entities/models';

/**
 * P4-3 数据洞察中心：纯函数聚合（可独立测试）。
 * 口径：成本一律 Token/调用，不估算金额；无数据显式返回 null/空，不编造。
 */

export interface CreationTrendPoint {
  /** 'MM-DD' */
  date: string;
  count: number;
  avgDurationMs: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function fmtDay(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 近 days 日按日成片量 + 平均时长（滚动窗口：最新在前，窗口 [now-(i+1)D, now-iD)） */
export function buildCreationTrend(cuts: ReadonlyArray<FinalCut>, days = 14, now = Date.now()): CreationTrendPoint[] {
  const points: CreationTrendPoint[] = [];
  for (let i = 0; i < days; i++) {
    const dayEnd = now - i * DAY_MS;
    const dayStart = dayEnd - DAY_MS;
    const day = fmtDay(dayStart);
    const inDay = cuts.filter(c => {
      const t = c.createdAt;
      return t >= dayStart && t < dayEnd;
    });
    const avgDurationMs = inDay.length > 0
      ? Math.round(inDay.reduce((s, c) => s + (c.duration || 0), 0) / inDay.length)
      : 0;
    points.push({ date: day, count: inDay.length, avgDurationMs });
  }
  return points;
}

export interface PublishBreakdownRow {
  platform: string;
  count: number;
  engaged: number;
  views: number;
  /** 互动率（engaged/views）；无有效数据时为 null → UI 显示 '—' */
  engagementRate: number | null;
}

/** 发布表现：按平台聚合任务数 / 互动 / 播放 / 互动率（stats 缺失不记数） */
export function buildPublishBreakdown(tasks: ReadonlyArray<PublishTask>): PublishBreakdownRow[] {
  const map = new Map<string, PublishBreakdownRow>();
  for (const task of tasks) {
    const row = map.get(task.platform) ?? { platform: task.platform, count: 0, engaged: 0, views: 0, engagementRate: null };
    row.count += 1;
    const s = task.stats;
    if (s) {
      row.engaged += (s.likes ?? 0) + (s.comments ?? 0) + (s.shares ?? 0);
      row.views += s.views ?? 0;
    }
    map.set(task.platform, row);
  }
  return [...map.values()].map(row => ({
    ...row,
    engagementRate: row.engaged > 0 && row.views > 0 ? row.engaged / row.views : null,
  }));
}

export interface VersionEfficiencyStats {
  storyCount: number;
  versionCount: number;
  avgVersionsPerStory: number;
  qcReported: number;
  qcPassed: number;
  qcPassRate: number | null;
  reworked: number;
}

/** 版本效率：平均版本数 / QC 快照覆盖率与通过率 / 回改次数（sourceVersionId 存在 = 由回改生成） */
export function buildVersionEfficiency(cuts: ReadonlyArray<FinalCut>): VersionEfficiencyStats {
  const storyCount = new Set(cuts.map(c => c.storyId)).size;
  const versionCount = cuts.length;
  const qcReported = cuts.filter(c => !!c.qcReport).length;
  const qcPassed = cuts.filter(c => c.qcReport?.recommendation === 'ok').length;
  const reworked = cuts.filter(c => !!c.sourceVersionId).length;
  return {
    storyCount,
    versionCount,
    avgVersionsPerStory: storyCount > 0 ? Math.round((versionCount / storyCount) * 100) / 100 : 0,
    qcReported,
    qcPassed,
    qcPassRate: qcReported > 0 ? qcPassed / qcReported : null,
    reworked,
  };
}
