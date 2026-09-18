import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, GitBranch } from 'lucide-react';
import { finalCutRepo } from '../../dependencies';
import type { FinalCut } from '../../domain/entities/models';
import { VersionComparePanel } from '../components/VersionComparePanel';

/**
 * P2-10+ 版本对比独立页
 * 按 storyId 加载同源成片版本，内嵌版本树 + A/B 并排播放
 */
export const VersionComparePage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const storyId = params.get('storyId') ?? '';
  const [cuts, setCuts] = useState<FinalCut[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const list = storyId ? await finalCutRepo.findByStoryIds([storyId]) : [];
        if (!cancelled) setCuts(list);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [storyId]);

  return (
    <div style={{ padding: '1rem', maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.8rem' }}>
        <button className="btn btn-secondary btn-xs" onClick={() => navigate(-1)} title={t('versionCompare.back', '返回')}>
          <ArrowLeft size={14} />
        </button>
        <h2 style={{ fontSize: '1.05rem', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <GitBranch size={16} /> {t('versionCompare.pageTitle', '同源版本对比')}
        </h2>
      </div>
      {loading ? (
        <div style={{ color: 'var(--text-muted)', padding: '2rem 0', fontSize: '0.85rem' }}>{t('versionCompare.loading', '加载版本中…')}</div>
      ) : cuts.length === 0 ? (
        <div style={{ padding: '2rem 0', fontSize: '0.85rem' }}>
          <div style={{ fontWeight: 600 }}>{t('versionCompare.empty', '该故事暂无成片版本')}</div>
          <div style={{ color: 'var(--text-muted)', marginTop: '0.3rem' }}>{t('versionCompare.emptyHint', '回到导出中心，为故事生成或回改成片后再来对比')}</div>
        </div>
      ) : (
        <VersionComparePanel cuts={cuts} onClose={() => navigate(-1)} />
      )}
    </div>
  );
};
