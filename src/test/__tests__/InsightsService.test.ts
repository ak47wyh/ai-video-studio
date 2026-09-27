import { describe, it, expect } from 'vitest';
import {
  buildCreationTrend,
  buildPublishBreakdown,
  buildVersionEfficiency,
} from '../../domain/services/InsightsService';
import type { FinalCut, PublishTask } from '../../domain/entities/models';

const NOW = 1_750_000_000_000;

function cut(partial: Partial<FinalCut>): FinalCut {
  return {
    id: 'c',
    storyId: 's1',
    videoBlob: new Blob(),
    duration: 6000,
    size: 100,
    hasSubtitles: false,
    createdAt: NOW,
    source: 'pipeline',
    ...partial,
  } as FinalCut;
}

function task(partial: Partial<PublishTask>): PublishTask {
  return {
    id: 't',
    finalCutId: 'c',
    platform: 'generic',
    title: 'x',
    status: 'published',
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  } as PublishTask;
}

describe('InsightsService.buildCreationTrend', () => {
  it('produces one point per day with counts (newest first)', () => {
    const trend = buildCreationTrend([
      cut({ id: 'a', createdAt: NOW - 1000 }),
      cut({ id: 'b', createdAt: NOW - 2000 }),
      cut({ id: 'c', createdAt: NOW - 2 * 24 * 3600 * 1000 }),
    ], 3, NOW);
    expect(trend).toHaveLength(3);
    expect(trend[0].count).toBe(2); // 最近 24h 两条
    expect(trend[1].count).toBe(1); // 前一日窗口（c 恰在窗口起点）一条
    expect(trend[2].count).toBe(0);
  });

  it('averages duration within a day', () => {
    const trend = buildCreationTrend([
      cut({ duration: 6000, createdAt: NOW - 1000 }),
      cut({ duration: 10000, createdAt: NOW - 2000 }),
    ], 1, NOW);
    expect(trend[0].avgDurationMs).toBe(8000);
  });

  it('returns zeros for empty corpus', () => {
    const trend = buildCreationTrend([], 7, NOW);
    expect(trend).toHaveLength(7);
    expect(trend.every(p => p.count === 0 && p.avgDurationMs === 0)).toBe(true);
  });
});

describe('InsightsService.buildPublishBreakdown', () => {
  it('groups by platform and aggregates stats', () => {
    const rows = buildPublishBreakdown([
      task({ platform: 'douyin', stats: { views: 100, likes: 10, comments: 5, shares: 0, collectedAt: 1 } }),
      task({ platform: 'douyin', stats: { views: 100, likes: 0, comments: 0, shares: 5, collectedAt: 2 } }),
      task({ platform: 'bilibili', stats: undefined }),
    ]);
    expect(rows).toHaveLength(2);
    const dy = rows.find(r => r.platform === 'douyin');
    expect(dy?.count).toBe(2);
    expect(dy?.views).toBe(200);
    expect(dy?.engaged).toBe(20);
    expect(dy?.engagementRate).toBeCloseTo(0.1);
    const bl = rows.find(r => r.platform === 'bilibili');
    expect(bl?.views).toBe(0);
    expect(bl?.engagementRate).toBeNull();
  });

  it('returns empty for no tasks', () => {
    expect(buildPublishBreakdown([])).toEqual([]);
  });
});

describe('InsightsService.buildVersionEfficiency', () => {
  it('computes version depth and QC pass rate', () => {
    const stats = buildVersionEfficiency([
      cut({ id: 'a', version: 1, qcReport: { passed: true, recommendation: 'ok', issueCount: 0, issues: [], checkedAt: 1 } }),
      cut({ id: 'b', version: 2, sourceVersionId: 'a', qcReport: { passed: false, recommendation: 'regenerate', issueCount: 1, issues: [{ check: 'duration', severity: 'error', message: 'x' }], checkedAt: 2 } }),
      cut({ id: 'c', storyId: 's2', version: 1, qcReport: { passed: true, recommendation: 'ok', issueCount: 0, issues: [], checkedAt: 3 } }),
      cut({ id: 'd', version: 3, sourceVersionId: 'b' }), // 无 QC 快照
    ]);
    expect(stats.storyCount).toBe(2);
    expect(stats.versionCount).toBe(4);
    expect(stats.avgVersionsPerStory).toBe(2);
    expect(stats.qcReported).toBe(3);
    expect(stats.qcPassed).toBe(2);
    expect(stats.qcPassRate).toBeCloseTo(2 / 3);
    expect(stats.reworked).toBe(2);
  });

  it('handles empty corpus', () => {
    const stats = buildVersionEfficiency([]);
    expect(stats.versionCount).toBe(0);
    expect(stats.qcPassRate).toBeNull();
  });
});
