import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, Film, Coins, Send, Layers } from 'lucide-react';
import { AsyncState } from '../components/AsyncState';
import {
  finalCutRepo,
  publishTaskRepo,
  costAnalytics,
} from '../../dependencies';
import {
  buildCreationTrend,
  buildPublishBreakdown,
  buildVersionEfficiency,
} from '../../domain/services/InsightsService';
import type { FinalCut, PublishTask } from '../../domain/entities/models';

/**
 * P4-3 数据洞察中心：创作趋势 / 成本趋势 / 发布表现 / 版本效率 四卡。
 * 口径：成本以 Token/调用计，不估算金额；互动率=互动/播放，无有效数据显式 '—'。
 */
export const InsightsPage: React.FC = () => {
  const { t } = useTranslation();
  const [cuts, setCuts] = useState<FinalCut[]>([]);
  const [tasks, setTasks] = useState<PublishTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([
      finalCutRepo.listAll ? finalCutRepo.listAll() : Promise.resolve<FinalCut[]>([]),
      publishTaskRepo.query({}),
    ]).then(([c, p]) => {
      if (!alive) return;
      setCuts(c);
      setTasks(p);
    }).catch(() => {}).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const usage = useMemo(() => {
    try { return costAnalytics.getUsageReport({ days: 14 }); } catch { return null; }
  }, []);
  const creation = useMemo(() => buildCreationTrend(cuts, 14), [cuts]);
  const publishRows = useMemo(() => buildPublishBreakdown(tasks), [tasks]);
  const versionStats = useMemo(() => buildVersionEfficiency(cuts), [cuts]);

  const maxCount = Math.max(1, ...creation.map(p => p.count));

  if (loading) return <div className="page-container fade-in"><AsyncState loading minHeight={240} /></div>;

  return (
    <div className="page-container fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('insights.title', '数据洞察')}</h1>
          <p className="page-subtitle">{t('insights.subtitle', '创作 / 成本 / 发布 / 版本效率 一处复盘')}</p>
        </div>
      </div>
      <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: '0 0 0.6rem' }}>
        {t('insights.scope', '数据来自本地：成片 / QC 快照 / 发布回传 / 成本计量；成本以 Token/调用计，不估算金额。')}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.6rem' }}>
        {/* 卡1 创作趋势 */}
        <div className="card" style={{ padding: '0.7rem 0.8rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.4rem' }}>
            <Film size={14} /> {t('insights.creation', '创作趋势（近 14 日）')}
          </div>
          {creation.every(p => p.count === 0) ? (
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{t('insights.empty', '暂无成片数据')}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {creation.map(p => (
                <div key={p.date} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.68rem' }}>
                  <span style={{ width: 34, color: 'var(--text-secondary)', flexShrink: 0 }}>{p.date}</span>
                  <div style={{ flex: 1, height: 10, background: 'rgba(0,0,0,0.06)', borderRadius: 5, overflow: 'hidden' }}>
                    <div style={{ width: `${(p.count / maxCount) * 100}%`, height: '100%', background: 'var(--primary-color)', borderRadius: 5 }} />
                  </div>
                  <span style={{ width: 22, textAlign: 'right', fontWeight: 600 }}>{p.count}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: '0.35rem', fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
            {t('insights.avgDuration', '日均成片')}: {cuts.length > 0 ? Math.round(cuts.reduce((s, c) => s + (c.duration || 0), 0) / cuts.length / 1000) : 0}s · {t('insights.totalCuts', '成片')} {cuts.length}
          </div>
        </div>

        {/* 卡2 成本趋势 */}
        <div className="card" style={{ padding: '0.7rem 0.8rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.4rem' }}>
            <Coins size={14} /> {t('insights.cost', '成本趋势（近 14 日）')}
          </div>
          {!usage || usage.dailyTrend.every(p => p.calls === 0) ? (
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{t('insights.empty', '暂无成本数据')}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {usage.dailyTrend.map(p => (
                <div key={p.date} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.68rem' }}>
                  <span style={{ width: 34, color: 'var(--text-secondary)', flexShrink: 0 }}>{p.date}</span>
                  <span style={{ flex: 1 }}>{t('insights.calls')} {p.calls}</span>
                  <span style={{ width: 60, textAlign: 'right' }}>{p.tokens.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
          {usage && (
            <div style={{ marginTop: '0.35rem', fontSize: '0.68rem', color: usage.budget.exceeded ? 'var(--color-danger)' : 'var(--text-secondary)' }}>
              {usage.budget.budgetTokens != null && (
                <>
                  {t('insights.budget', '预算')} {usage.budget.usedTokens.toLocaleString()}/{usage.budget.budgetTokens.toLocaleString()}
                  {usage.budget.exceeded ? ` · ${t('insights.exceeded', '已超限')}` : ''}
                </>
              )}
              {usage.budget.budgetTokens == null && `${t('insights.used', '已用')} ${usage.budget.usedTokens.toLocaleString()} tokens`}
            </div>
          )}
        </div>

        {/* 卡3 发布表现 */}
        <div className="card" style={{ padding: '0.7rem 0.8rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.4rem' }}>
            <Send size={14} /> {t('insights.publish', '发布表现')}
          </div>
          {publishRows.length === 0 ? (
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{t('insights.empty', '暂无发布数据')}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {publishRows.map(r => (
                <div key={r.platform} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.68rem' }}>
                  <span style={{ width: 64, fontWeight: 600 }}>{r.platform}</span>
                  <span>{t('insights.publishCount', '任务')} {r.count}</span>
                  <span>· {t('insights.views', '播放')} {r.views}</span>
                  <span style={{ marginLeft: 'auto' }}>
                    {t('insights.engagement', '互动率')} {r.engagementRate == null ? '—' : `${(r.engagementRate * 100).toFixed(1)}%`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 卡4 版本效率 */}
        <div className="card" style={{ padding: '0.7rem 0.8rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.4rem' }}>
            <Layers size={14} /> {t('insights.version', '版本效率')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.68rem' }}>
            <span>{t('insights.stories', '故事')} {versionStats.storyCount} · {t('insights.versions', '版本')} {versionStats.versionCount} · {t('insights.avgVersion', '均版本/故事')} {versionStats.avgVersionsPerStory}</span>
            <span>
              {t('insights.qcRate', 'QC 通过率')} {versionStats.qcPassRate == null ? '—' : `${(versionStats.qcPassRate * 100).toFixed(0)}%`}
              {' '}({versionStats.qcPassed}/{versionStats.qcReported} {t('insights.qcReported', '已质检')})
            </span>
            <span>{t('insights.reworked', '回改次数')} {versionStats.reworked}</span>
          </div>
        </div>
      </div>

      <div style={{ marginTop: '0.6rem', fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
        <BarChart3 size={11} /> {t('insights.note', '版本效率统计基于本地成片与 QC 快照，实时计算。')}
      </div>
    </div>
  );
};

export default InsightsPage;
