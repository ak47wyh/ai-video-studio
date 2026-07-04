import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { DollarSign, Trash2, RefreshCw, TrendingUp, Cpu, Mic, Music, Film, Image as ImageIcon, Bot, Clapperboard, Captions } from 'lucide-react';
import { SettingsSection } from './SettingsSection';
import { costMeter } from '../../../dependencies';
import type { CostSummary, CostRecord } from '../../../domain/ports/CrossCuttingPorts';

/** 调用类型图标与颜色映射 */
const CALL_TYPE_META: Record<CostRecord['callType'], { icon: React.ReactNode; color: string; label: string }> = {
  text: { icon: <Cpu size={14} />, color: 'var(--lab-color-text)', label: '文本' },
  image: { icon: <ImageIcon size={14} />, color: 'var(--lab-color-image)', label: '图片' },
  video: { icon: <Film size={14} />, color: 'var(--lab-color-video)', label: '视频' },
  voice: { icon: <Mic size={14} />, color: 'var(--lab-color-voice)', label: '语音' },
  music: { icon: <Music size={14} />, color: 'var(--lab-color-music)', label: '音乐' },
  agent_chat: { icon: <Bot size={14} />, color: 'var(--lab-color-text)', label: 'Agent' },
  bgm_recommendation: { icon: <Music size={14} />, color: 'var(--lab-color-music)', label: 'BGM推荐' },
  cinematography: { icon: <Clapperboard size={14} />, color: 'var(--lab-color-video)', label: '镜头' },
  subtitle_align: { icon: <Captions size={14} />, color: 'var(--lab-color-text)', label: '字幕对齐' },
  subtitle_translate: { icon: <Captions size={14} />, color: 'var(--lab-color-text)', label: '字幕翻译' },
};

/**
 * 成本计量面板（P1-21）。
 *
 * 展示当前会话内所有 AI 调用的成本统计：
 * - 总调用次数 / 总 Token 数
 * - 按调用类型分组的调用次数
 * - 按平台分组的调用次数
 * - 最近调用记录（最多 20 条）
 *
 * 数据源：InMemoryCostMeter（内存存储，重启清空）。
 */
export const CostMeterSection: React.FC = () => {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<CostSummary | null>(() => costMeter.getSummary());
  const [records, setRecords] = useState<CostRecord[]>(() => costMeter.getRecords(undefined, 20));

  const refresh = useCallback(() => {
    setSummary(costMeter.getSummary());
    setRecords(costMeter.getRecords(undefined, 20));
  }, []);

  const handleClear = () => {
    costMeter.clear();
    refresh();
  };

  const formatTime = (ts: number) => {
    if (!ts) return '-';
    return new Date(ts).toLocaleTimeString();
  };

  return (
    <SettingsSection
      icon={<DollarSign size={18} />}
      title={t('settings.costMeter.title', 'AI 调用成本统计')}
      badge={summary && summary.totalCalls > 0 ? {
        status: 'ready',
        label: `${summary.totalCalls} 次调用`,
      } : undefined}
    >
      {/* 操作栏 */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button
          className="btn btn-secondary"
          onClick={refresh}
          style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
        >
          <RefreshCw size={12} />
          {t('settings.costMeter.refresh', '刷新')}
        </button>
        <button
          className="btn btn-secondary"
          onClick={handleClear}
          disabled={!summary || summary.totalCalls === 0}
          style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
        >
          <Trash2 size={12} />
          {t('settings.costMeter.clear', '清空')}
        </button>
      </div>

      {!summary || summary.totalCalls === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '1.5rem 0' }}>
          {t('settings.costMeter.empty', '暂无调用记录。在使用 AI 功能后，此处将展示成本统计。')}
        </p>
      ) : (
        <>
          {/* 总览卡片 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
            <div className="dashboard-stat-item" style={{ background: 'var(--color-info-bg)' }}>
              <div className="dashboard-stat-icon" style={{ background: 'color-mix(in srgb, var(--color-info) 20%, transparent)' }}>
                <TrendingUp size={16} color="var(--color-info)" />
              </div>
              <div>
                <div className="dashboard-stat-value" style={{ color: 'var(--color-info)' }}>{summary.totalCalls}</div>
                <div className="dashboard-stat-label">{t('settings.costMeter.totalCalls', '总调用次数')}</div>
              </div>
            </div>
            <div className="dashboard-stat-item" style={{ background: 'var(--color-success-bg)' }}>
              <div className="dashboard-stat-icon" style={{ background: 'color-mix(in srgb, var(--color-success) 20%, transparent)' }}>
                <Cpu size={16} color="var(--color-success)" />
              </div>
              <div>
                <div className="dashboard-stat-value" style={{ color: 'var(--color-success)' }}>
                  {summary.totalTokens.toLocaleString()}
                </div>
                <div className="dashboard-stat-label">{t('settings.costMeter.totalTokens', '总 Token 数')}</div>
              </div>
            </div>
            <div className="dashboard-stat-item" style={{ background: 'var(--color-warning-bg)' }}>
              <div className="dashboard-stat-icon" style={{ background: 'color-mix(in srgb, var(--color-warning) 20%, transparent)' }}>
                <Cpu size={16} color="var(--color-warning)" />
              </div>
              <div>
                <div className="dashboard-stat-value" style={{ color: 'var(--color-warning)' }}>
                  {summary.totalInputTokens.toLocaleString()} / {summary.totalOutputTokens.toLocaleString()}
                </div>
                <div className="dashboard-stat-label">{t('settings.costMeter.inputOutput', '输入/输出 Token')}</div>
              </div>
            </div>
          </div>

          {/* 按类型分组 */}
          <div style={{ marginBottom: '1rem' }}>
            <h4 style={{ fontSize: '0.85rem', fontWeight: 600, margin: '0 0 0.5rem 0', color: 'var(--text-secondary)' }}>
              {t('settings.costMeter.byCallType', '按调用类型')}
            </h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {(Object.entries(summary.byCallType) as [CostRecord['callType'], { calls: number; tokens: number }][]).map(([type, stat]) => {
                const meta = CALL_TYPE_META[type];
                return (
                  <div
                    key={type}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.4rem',
                      padding: '0.4rem 0.7rem', borderRadius: 'var(--radius-md)',
                      background: `color-mix(in srgb, ${meta.color} 10%, transparent)`,
                      border: `1px solid color-mix(in srgb, ${meta.color} 30%, transparent)`,
                      fontSize: '0.8rem',
                    }}
                  >
                    <span style={{ color: meta.color }}>{meta.icon}</span>
                    <span style={{ fontWeight: 600 }}>{meta.label}</span>
                    <span style={{ color: 'var(--text-muted)' }}>·</span>
                    <span>{stat.calls} {t('settings.costMeter.calls', '次')}</span>
                    {type === 'text' && stat.tokens > 0 && (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                        ({stat.tokens.toLocaleString()} tokens)
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 按平台分组 */}
          {Object.keys(summary.byPlatform).length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <h4 style={{ fontSize: '0.85rem', fontWeight: 600, margin: '0 0 0.5rem 0', color: 'var(--text-secondary)' }}>
                {t('settings.costMeter.byPlatform', '按平台')}
              </h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {Object.entries(summary.byPlatform).map(([platform, stat]) => (
                  <div
                    key={platform}
                    style={{
                      padding: '0.35rem 0.65rem', borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-panel)', fontSize: '0.78rem',
                      border: '1px solid var(--border-color)',
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{platform}</span>
                    <span style={{ color: 'var(--text-muted)', marginLeft: '0.4rem' }}>{stat.calls} {t('settings.costMeter.calls', '次')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 最近记录 */}
          {records.length > 0 && (
            <div>
              <h4 style={{ fontSize: '0.85rem', fontWeight: 600, margin: '0 0 0.5rem 0', color: 'var(--text-secondary)' }}>
                {t('settings.costMeter.recentRecords', '最近调用记录')}
              </h4>
              <div style={{ maxHeight: 280, overflowY: 'auto', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                {records.map(r => {
                  const meta = CALL_TYPE_META[r.callType];
                  return (
                    <div
                      key={r.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                        padding: '0.5rem 0.75rem', fontSize: '0.78rem',
                        borderBottom: '1px solid var(--border-color)',
                      }}
                    >
                      <span style={{ color: meta.color, flexShrink: 0 }}>{meta.icon}</span>
                      <span style={{ fontWeight: 600, minWidth: 50 }}>{meta.label}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.model}
                      </span>
                      {r.usage && (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                          {r.usage.totalTokens} tok
                        </span>
                      )}
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem', flexShrink: 0 }}>
                        {formatTime(r.timestamp)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </SettingsSection>
  );
};
