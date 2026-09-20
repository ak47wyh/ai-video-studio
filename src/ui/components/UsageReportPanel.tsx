import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, RefreshCw, AlertTriangle, Gauge, Download } from 'lucide-react';
import { costAnalytics } from '../../dependencies';
import { CostAnalyticsService } from '../../domain/services/CostAnalyticsService';

/**
 * P0-2 成本与产出报表面板（Dashboard 区块）。
 *
 * 数据来源：PersistedCostMeter 记录（调用次数 / Token 用量 / 预算）。
 * 口径：CostRecord 不含失败标记与金额，故仅展示真实可统计的用量指标。
 */
export const UsageReportPanel: React.FC = () => {
  const { t } = useTranslation();
  const [revision, setRevision] = useState(0);

  const report = useMemo(() => {
    void revision;
    return costAnalytics.getUsageReport({ days: 7 });
  }, [revision]);
  const { budget } = report;

  const maxPlatformTokens = Math.max(1, ...report.byPlatform.map(p => p.tokens));
  const maxTrendCalls = Math.max(1, ...report.dailyTrend.map(d => d.calls));

  const handleExportCsv = () => {
    const csv = CostAnalyticsService.buildUsageReportCsv(report);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `usage-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="dashboard-card" style={{ cursor: 'default' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
        <h3 className="dashboard-section-title" style={{ marginBottom: 0 }}>
          <BarChart3 size={16} style={{ color: 'var(--primary-color)', verticalAlign: '-2px', marginRight: '0.25rem' }} />
          {t('dashboard.usageTitle', '用量与预算')}
        </h3>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button className="btn btn-ghost" onClick={handleExportCsv} style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <Download size={12} />
            {t('dashboard.exportCsv', '导出 CSV')}
          </button>
        <button
          className="btn btn-ghost"
          style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
          onClick={() => setRevision(r => r + 1)}
          title={t('dashboard.refresh', '刷新')}
        >
          <RefreshCw size={12} /> {t('dashboard.refresh', '刷新')}
        </button>
        </div>
      </div>

      {/* 预算告警 */}
      {budget.budgetTokens !== undefined && budget.exceeded && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 0.6rem', marginBottom: '0.5rem', borderRadius: 8, background: 'var(--color-danger-bg)', color: 'var(--color-danger)', fontSize: '0.8rem' }}>
          <AlertTriangle size={14} /> {t('dashboard.budgetExceeded', '本月 Token 预算已超出')}
        </div>
      )}

      {/* 指标卡 */}
      <div className="dashboard-stats-row" style={{ marginBottom: '0.75rem' }}>
        <div className="dashboard-stat-item" style={{ background: 'var(--color-info-bg, rgba(11,127,255,0.08))' }}>
          <div className="dashboard-stat-icon" style={{ background: 'color-mix(in srgb, var(--color-info) 20%, transparent)' }}>
            <Gauge size={16} color="var(--color-info)" />
          </div>
          <div>
            <div className="dashboard-stat-value">{report.totalCalls}</div>
            <div className="dashboard-stat-label">{t('dashboard.totalCalls', '总调用')}</div>
          </div>
        </div>
        <div className="dashboard-stat-item" style={{ background: 'var(--color-info-bg, rgba(11,127,255,0.08))' }}>
          <div className="dashboard-stat-icon" style={{ background: 'color-mix(in srgb, var(--color-info) 20%, transparent)' }}>
            <BarChart3 size={16} color="var(--color-info)" />
          </div>
          <div>
            <div className="dashboard-stat-value">{report.totalTokens.toLocaleString()}</div>
            <div className="dashboard-stat-label">{t('dashboard.totalTokens', 'Token 用量')}</div>
          </div>
        </div>
      </div>

      {/* 预算进度条 */}
      {budget.budgetTokens !== undefined && budget.budgetTokens > 0 && (
        <div style={{ marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
            <span>{t('dashboard.budgetLabel', '预算')}: {budget.usedTokens.toLocaleString()} / {budget.budgetTokens.toLocaleString()} tokens</span>
            <span>{Math.round(budget.usageRatio * 100)}%</span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: 'var(--color-border)', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${budget.usageRatio * 100}%`,
                borderRadius: 4,
                background: budget.exceeded ? 'var(--color-danger)' : budget.nearLimit ? 'var(--color-warning)' : 'var(--color-success)',
                transition: 'width 0.3s',
              }}
            />
          </div>
        </div>
      )}
      {budget.budgetTokens !== undefined && budget.budgetTokens > 0 && !budget.exceeded && budget.nearLimit && (
        <div style={{ marginBottom: '0.75rem', fontSize: '0.78rem', color: 'var(--color-warning)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <AlertTriangle size={13} />
          {t('dashboard.budgetNearLimit', '已接近预算阈值，请关注用量')}
        </div>
      )}

      {/* 平台排行（Token 占比） */}
      {report.byPlatform.length > 0 && (
        <div style={{ marginBottom: '0.75rem' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
            {t('dashboard.byPlatform', '平台用量')}
          </div>
          {report.byPlatform.slice(0, 5).map(p => (
            <div key={p.platform} style={{ marginBottom: '0.3rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                <span>{p.platform}</span>
                <span>{p.calls} 次 · {p.tokens.toLocaleString()} tokens</span>
              </div>
              <div style={{ height: 5, borderRadius: 3, background: 'var(--color-border)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(p.tokens / maxPlatformTokens) * 100}%`, borderRadius: 3, background: 'var(--primary-color)' }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 近 7 日趋势 */}
      {report.dailyTrend.some(d => d.calls > 0) && (
        <div>
          <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
            {t('dashboard.dailyTrend', '近 7 日调用趋势')}
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 64 }}>
            {report.dailyTrend.map(d => (
              <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 0 }}>
                <div
                  style={{
                    width: '100%',
                    minHeight: 3,
                    borderRadius: '3px 3px 0 0',
                    background: d.calls > 0 ? 'color-mix(in srgb, var(--primary-color) 55%, transparent)' : 'transparent',
                    height: `${Math.max(3, (d.calls / maxTrendCalls) * 46)}px`,
                  }}
                  title={`${d.date}: ${d.calls} 次 · ${d.tokens.toLocaleString()} tokens`}
                />
                <span style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{d.date}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {report.totalCalls === 0 && (
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', padding: '0.5rem 0' }}>
          {t('dashboard.noUsageData', '暂无用量记录，完成一次生成后自动统计')}
        </div>
      )}
    </div>
  );
};
