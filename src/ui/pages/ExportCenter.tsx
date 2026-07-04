import React, { useState } from 'react';
import { Download, Trash2, Film, Filter, RefreshCw, FilmIcon, Scissors } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { finalCutRepo } from '../../dependencies';
import { useSpaceScopedStories, useSpaceScopedFinalCuts } from '../hooks/useSpaceScopedQuery';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { getErrorMessage } from '../utils/errorUtils';
import { useObjectUrl } from '../hooks/useObjectUrl';
import { PostProductionPanel } from '../components/PostProductionPanel';
import type { FinalCut } from '../../domain/entities/models';

type FilterRange = 'all' | 'today' | 'week' | 'month';

export const ExportCenter: React.FC = () => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const navigate = useNavigate();
  const [filterRange, setFilterRange] = useState<FilterRange>('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [previewCutId, setPreviewCutId] = useState<string | null>(null);

  const stories = useSpaceScopedStories();
  const allCuts = useSpaceScopedFinalCuts();

  const filteredCuts = filterCuts(allCuts, filterRange);

  const handleDownload = (cut: FinalCut) => {
    try {
      const url = URL.createObjectURL(cut.videoBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `final-cut-${cut.storyId}-${cut.createdAt}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast('success', t('export.downloadStarted'));
    } catch (e) {
      showToast('error', getErrorMessage(e, t('export.downloadFailed')));
    }
  };

  const handleDelete = async (cut: FinalCut) => {
    const ok = await confirm({
      title: t('export.confirmDeleteTitle'),
      message: t('export.confirmDelete'),
      confirmLabel: t('export.deleteBtn'),
      danger: true
    });
    if (!ok) return;
    setDeletingId(cut.id);
    try {
      await finalCutRepo.delete(cut.id);
      showToast('success', t('export.deleted'));
      if (previewCutId === cut.id) setPreviewCutId(null);
    } catch (e) {
      showToast('error', getErrorMessage(e, t('export.deleteFailed')));
    } finally {
      setDeletingId(null);
    }
  };

  const handleRefresh = () => {
    setPreviewCutId(p => p);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  const formatDuration = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${String(sec).padStart(2, '0')}`;
  };

  const formatDate = (timestamp: number) => new Date(timestamp).toLocaleString();

  const getStoryTitle = (storyId: string): string => {
    return stories.find(s => s.id === storyId)?.title || t('export.untitledStory');
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{t('export.title')}</h1>
          <p>{t('export.subtitle')}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-secondary" onClick={handleRefresh}>
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '0.6rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Filter size={16} style={{ color: 'var(--text-muted)' }} />
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('export.filter')}:</span>
        {(['all', 'today', 'week', 'month'] as FilterRange[]).map(range => (
          <button
            key={range}
            className={filterRange === range ? 'btn btn-primary btn-xs' : 'btn btn-secondary btn-xs'}
            onClick={() => setFilterRange(range)}
          >
            {t(`export.range.${range}`)}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          {t('export.totalCount', { count: filteredCuts.length })}
        </span>
      </div>

      {previewCutId && (() => {
        const cut = filteredCuts.find(c => c.id === previewCutId);
        if (!cut) return null;
        return (
          <PreviewPanel
            key={cut.id}
            cut={cut}
            getStoryTitle={getStoryTitle}
            formatSize={formatSize}
            formatDuration={formatDuration}
            formatDate={formatDate}
            onClose={() => setPreviewCutId(null)}
          />
        );
      })()}

      {filteredCuts.length === 0 ? (
        <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center' }}>
          <FilmIcon size={48} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
          <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>{t('export.empty')}</p>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            {t('export.emptyHint')}
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '0.75rem' }}>
          {filteredCuts.map(cut => (
            <div
              key={cut.id}
              className="glass-panel"
              style={{ padding: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}
            >
              <div
                style={{
                  width: '100%',
                  aspectRatio: '16/9',
                  background: 'var(--bg-dark)',
                  borderRadius: 'var(--radius-sm)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer'
                }}
                role="button"
                tabIndex={0}
                aria-label={`${t('export.preview', '预览片段')}：${getStoryTitle(cut.storyId)}`}
                onClick={() => setPreviewCutId(cut.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setPreviewCutId(cut.id);
                  }
                }}
              >
                {cut.thumbnailUrl ? (
                  <img
                    src={cut.thumbnailUrl}
                    alt={getStoryTitle(cut.storyId)}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'var(--radius-sm)' }}
                  />
                ) : (
                  <Film size={32} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
                )}
              </div>
              <h4 style={{ margin: 0, fontSize: '0.85rem' }}>{getStoryTitle(cut.storyId)}</h4>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {formatSize(cut.size)} · {formatDuration(cut.duration)} · {formatDate(cut.createdAt)}
              </div>
              {cut.hasSubtitles && (
                <div style={{ fontSize: '0.75rem', color: 'var(--color-success)' }}>
                  ✓ {t('export.withSubs')}
                </div>
              )}
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: 'auto' }}>
                <button
                  className="btn btn-primary btn-xs"
                  style={{ flex: 1 }}
                  onClick={() => handleDownload(cut)}
                >
                  <Download size={14} /> {t('export.downloadBtn')}
                </button>
                <button
                  className="btn btn-secondary btn-xs"
                  style={{ padding: '0.3rem 0.5rem' }}
                  onClick={() => navigate(`/editor?storyId=${cut.storyId}`)}
                  title={t('export.openEditor', '在剪辑工作台编辑')}
                >
                  <Scissors size={14} />
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '0.3rem', color: 'var(--color-danger)' }}
                  onClick={() => handleDelete(cut)}
                  disabled={deletingId === cut.id}
                >
                  {deletingId === cut.id ? <RefreshCw size={14} className="spin" /> : <Trash2 size={14} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

function filterCuts(cuts: FinalCut[], range: FilterRange): FinalCut[] {
  const now = Date.now();
  const ranges: Record<FilterRange, number> = {
    all: 0,
    today: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000
  };
  const threshold = ranges[range];
  if (threshold === 0) return cuts.sort((a, b) => b.createdAt - a.createdAt);
  return cuts
    .filter(c => now - c.createdAt <= threshold)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * 预览面板：独立组件以便 useObjectUrl 在卸载时自动 revoke。
 */
const PreviewPanel: React.FC<{
  cut: FinalCut;
  getStoryTitle: (id: string) => string;
  formatSize: (size: number) => string;
  formatDuration: (ms: number) => string;
  formatDate: (ts: number) => string;
  onClose: () => void;
}> = ({ cut, getStoryTitle, formatSize, formatDuration, formatDate, onClose }) => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const videoUrl = useObjectUrl(cut.videoBlob);

  return (
    <div className="glass-panel" style={{ padding: '0.75rem', marginBottom: '0.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
        <Film size={18} />
        <h3 style={{ margin: 0, fontSize: '0.9rem' }}>{getStoryTitle(cut.storyId)}</h3>
        <button
          className="btn btn-secondary btn-xs"
          style={{ marginLeft: 'auto' }}
          onClick={onClose}
        >
          {t('export.closePreview')}
        </button>
      </div>
      {videoUrl && (
        <video
          src={videoUrl}
          controls
          autoPlay
          style={{ width: '100%', maxHeight: '480px', borderRadius: 'var(--radius-md)', background: '#000' }}
        />
      )}
      <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
        {formatSize(cut.size)} · {formatDuration(cut.duration)} · {cut.hasSubtitles ? t('export.withSubs') : t('export.noSubs')} · {formatDate(cut.createdAt)}
      </div>
      <div style={{ marginTop: '0.5rem' }}>
        <PostProductionPanel
          videoBlob={cut.videoBlob}
          videoUrl={null}
          onVideoProcessed={({ blob }) => {
            finalCutRepo.save({ ...cut, videoBlob: blob });
            showToast('success', t('export.videoUpdated'));
          }}
        />
      </div>
    </div>
  );
};
