import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, GitBranch } from 'lucide-react';
import type { FinalCut } from '../../domain/entities/models';
import type { VersionNode } from '../../domain/ports/VersionComparePorts';
import { versionCompareService } from '../../dependencies';
import { VersionCompareService } from '../../domain/services/VersionCompareService';
import { useObjectUrl } from '../hooks/useObjectUrl';

interface VersionComparePanelProps {
  /** 同一故事的全部版本 */
  cuts: FinalCut[];
  onClose: () => void;
}

/**
 * P2-10 同源版本对比面板
 * 版本树 + A/B 并排播放（视频 / 字幕 / 成本三栏）
 */
export const VersionComparePanel: React.FC<VersionComparePanelProps> = ({ cuts, onClose }) => {
  const { t } = useTranslation();
  const versions = useMemo(
    () => versionCompareService.listVersionsByStory(cuts, cuts[0]?.storyId ?? ''),
    [cuts],
  );
  const tree = useMemo(() => VersionCompareService.buildVersionTree(cuts), [cuts]);

  const [aId, setAId] = useState<string>(versions[0]?.id ?? '');
  const [bId, setBId] = useState<string>(versions[1]?.id ?? versions[0]?.id ?? '');

  const cutA = versions.find(v => v.id === aId) ?? versions[0];
  const cutB = versions.find(v => v.id === bId) ?? versions[1] ?? versions[0];
  const urlA = useObjectUrl(cutA?.videoBlob);
  const urlB = useObjectUrl(cutB?.videoBlob);

  const renderNode = (node: VersionNode): React.ReactNode => (
    <div key={node.cut.id} style={{ paddingLeft: `${node.depth * 16}px`, margin: '2px 0' }}>
      <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.78rem', cursor: 'pointer' }}>
        <input
          type="radio"
          name="compareA"
          checked={cutA?.id === node.cut.id}
          onChange={() => setAId(node.cut.id)}
        />
        <span style={{ fontWeight: 600 }}>
          {node.cut.version ? `v${node.cut.version}` : t('versionCompare.root', '根版本')}
        </span>
        <span style={{ color: 'var(--text-muted)' }}>
          {new Date(node.cut.createdAt).toLocaleDateString()}
        </span>
        {node.cut.id === cutB?.id && (
          <span style={{ color: 'var(--color-warning)', fontSize: '0.68rem' }}>{t('versionCompare.asB', '对比方 B')}</span>
        )}
      </label>
      {node.children.map(renderNode)}
    </div>
  );

  const srtPreview = (cut?: FinalCut): string => {
    if (!cut?.srtContent) return t('versionCompare.noSubs', '无字幕');
    const lines = cut.srtContent.split('\n').filter(l => l.trim() && !/^\d+$/.test(l.trim()) && !/-->/.test(l));
    return lines.slice(0, 6).join(' ').slice(0, 120) || t('versionCompare.noSubs', '无字幕');
  };

  const costOf = (cut?: FinalCut) => {
    if (!cut) return null;
    const cost = versionCompareService.getVersionCost(cut.pipelineTaskId);
    if (!cost.attributable) {
      return <span style={{ color: 'var(--text-muted)' }}>{t('versionCompare.costNa', '成本不可归因')}</span>;
    }
    return (
      <span>
        {t('versionCompare.calls', '调用')} {cost.callCount} · {t('versionCompare.tokens', 'Token')} {cost.tokenCount}
      </span>
    );
  };

  return (
    <div className="glass-panel fade-in" style={{ padding: '1rem', marginTop: '0.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <GitBranch size={16} style={{ color: 'var(--color-info)' }} />
        <h3 style={{ margin: 0, fontSize: '0.95rem', flex: 1 }}>
          {t('versionCompare.title', '同源版本对比')}（{versions.length}）
        </h3>
        <button className="btn btn-ghost" onClick={onClose} aria-label={t('versionCompare.close', '关闭')}>
          <X size={16} />
        </button>
      </div>

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        {/* 版本树 */}
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
            {t('versionCompare.tree', '版本树（单选设为 A）')}
          </div>
          <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--color-border)', borderRadius: 8, padding: '0.4rem' }}>
            {tree.map(renderNode)}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('versionCompare.pickB', '对比方 B')}</span>
            <select
              className="input"
              style={{ flex: 1, fontSize: '0.75rem', padding: '0.2rem 0.3rem' }}
              value={cutB?.id ?? ''}
              onChange={e => setBId(e.target.value)}
            >
              {versions.map(v => (
                <option key={v.id} value={v.id}>
                  {v.version ? `v${v.version}` : t('versionCompare.root', '根版本')} · {new Date(v.createdAt).toLocaleDateString()}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* A/B 对比 */}
        <div style={{ flex: '2 1 460px', minWidth: 0, display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {[cutA, cutB].map((cut, idx) => (
            <div key={cut?.id ?? idx} style={{ flex: '1 1 220px', minWidth: 0 }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.3rem' }}>
                {idx === 0 ? t('versionCompare.versionA', '版本 A') : t('versionCompare.versionB', '版本 B')}
                {cut && (cut.version ? ` · v${cut.version}` : '')}
              </div>
              {cut && urlA && idx === 0 && (
                <video src={urlA} controls style={{ width: '100%', borderRadius: 8, maxHeight: 200 }} />
              )}
              {cut && urlB && idx === 1 && (
                <video src={urlB} controls style={{ width: '100%', borderRadius: 8, maxHeight: 200 }} />
              )}
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.3rem', lineHeight: 1.6 }}>
                <div><strong>{t('versionCompare.subs', '字幕')}</strong>：{srtPreview(cut)}</div>
                <div><strong>{t('versionCompare.cost', '成本')}</strong>：{costOf(cut)}</div>
                <div><strong>{t('versionCompare.duration', '时长')}</strong>：{cut ? `${(cut.duration / 1000).toFixed(1)}s` : '-'}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
