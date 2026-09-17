import React, { useState } from 'react';
import { Download, Trash2, Film, Filter, RefreshCw, FilmIcon, Scissors, Copy, Send, RotateCcw, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { finalCutRepo, qcService } from '../../dependencies';
import { useSpaceScopedStories, useSpaceScopedFinalCuts } from '../hooks/useSpaceScopedQuery';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { getErrorMessage } from '../utils/errorUtils';
import { useObjectUrl } from '../hooks/useObjectUrl';
import { PublishPanel } from '../components/PublishPanel';
import { ReworkPanel } from '../components/ReworkPanel';
import { PostProductionPanel } from '../components/PostProductionPanel';
import type { FinalCut } from '../../domain/entities/models';
import type { QcReport, QcRecommendation } from '../../domain/ports/QcPorts';

type FilterRange = 'all' | 'today' | 'week' | 'month';

// B4 导出预设：按目标渠道一键下载，预设决定文件名模板与副产物
type ExportPreset = 'generic' | 'douyin' | 'bilibili';

const EXPORT_PRESETS: { id: ExportPreset; labelKey: string }[] = [
  { id: 'generic', labelKey: 'export.preset.generic' },
  { id: 'douyin', labelKey: 'export.preset.douyin' },
  { id: 'bilibili', labelKey: 'export.preset.bilibili' },
];

const PRESET_PREFIX: Record<ExportPreset, string> = {
  generic: 'final-cut',
  douyin: 'douyin',
  bilibili: 'bilibili',
};

/** 安全文件名：剔除 Windows/Unix 非法字符 */
const safeFileName = (name: string): string => name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'untitled';

/** 日期戳 yyyyMMdd */
const dateStamp = (ts: number): string => {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
};

const downloadBlob = (blob: Blob, fileName: string): void => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const ExportCenter: React.FC = () => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const navigate = useNavigate();
  const [filterRange, setFilterRange] = useState<FilterRange>('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [previewCutId, setPreviewCutId] = useState<string | null>(null);
const [publishCut, setPublishCut] = useState<FinalCut | null>(null);
const [reworkCut, setReworkCut] = useState<FinalCut | null>(null);
  // P2-8 成片 QC：<cutId, report | 'running'>
  const [qcReports, setQcReports] = useState<Record<string, QcReport | 'running'>>({});
  // 每张卡片的导出预设选择（B4）
  const [presetFor, setPresetFor] = useState<Record<string, ExportPreset>>({});

  const stories = useSpaceScopedStories();
  // Phase 6 闭环修复：useSpaceScopedFinalCuts 已通过 spaceQueryPort.subscribe 订阅数据变更，
  // 数据自动更新，无需手动刷新按钮（原 handleRefresh 是 setPreviewCutId(p => p) 空操作）。
  const allCuts = useSpaceScopedFinalCuts();

  const filteredCuts = filterCuts(allCuts, filterRange);

  const handleDownload = (cut: FinalCut, preset: ExportPreset = 'generic') => {
    try {
      const base = `${PRESET_PREFIX[preset]}-${safeFileName(getStoryTitle(cut.storyId))}-${dateStamp(cut.createdAt)}`;
      downloadBlob(cut.videoBlob, `${base}.mp4`);
      // 含字幕的成片按渠道预设一并导出 SRT，便于二次剪辑/上传时复用
      if (preset !== 'generic' && cut.srtContent) {
        downloadBlob(new Blob([cut.srtContent], { type: 'text/plain;charset=utf-8' }), `${base}.srt`);
      }
      showToast('success', t('export.downloadStarted'));
    } catch (e) {
      showToast('error', getErrorMessage(e, t('export.downloadFailed')));
    }
  };

  // 复制成片信息到剪贴板，便于归档/周报
  const handleCopyInfo = async (cut: FinalCut) => {
    try {
      await navigator.clipboard.writeText(
        `【成片】${getStoryTitle(cut.storyId)}\n时长: ${formatDuration(cut.duration)}\n大小: ${formatSize(cut.size)}\n生成: ${formatDate(cut.createdAt)}\n字幕: ${cut.hasSubtitles ? t('export.withSubs') : t('export.noSubs')}`
      );
      showToast('success', t('export.copied'));
    } catch {
      showToast('error', t('export.copyFailed'));
    }
  };

  // P2-8 分辨率期望映射
  const RES_EXPECT: Record<string, { w: number; h: number }> = {
    '512P': { w: 910, h: 512 },
    '720P': { w: 1280, h: 720 },
    '768P': { w: 1366, h: 768 },
    '1080P': { w: 1920, h: 1080 },
  };

  /** 解析 SRT 最后一条字幕的结束时间（秒） */
  const parseSrtEndSec = (srt: string): number | undefined => {
    const times = srt.match(/\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/g);
    if (!times || times.length === 0) return undefined;
    const last = times[times.length - 1];
    const m = last.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/);
    if (!m) return undefined;
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
  };

  const handleRunQc = async (cut: FinalCut) => {
    setQcReports(prev => ({ ...prev, [cut.id]: 'running' }));
    try {
      const res = cut.pipelineOptions?.videoResolution ? RES_EXPECT[cut.pipelineOptions.videoResolution] : undefined;
      const report = await qcService.runQc({
        video: cut.videoBlob,
        expectedDurationSec: cut.duration > 0 ? cut.duration / 1000 : undefined,
        expectedWidth: res?.w,
        expectedHeight: res?.h,
        subtitleEndSec: cut.srtContent ? parseSrtEndSec(cut.srtContent) : undefined,
      });
      setQcReports(prev => ({ ...prev, [cut.id]: report }));
      showToast(report.passed ? 'success' : 'error', report.passed ? t('export.qc.done') : t('export.qc.issues', { count: report.issues.length }));
    } catch (e) {
      showToast('error', getErrorMessage(e, t('export.qc.failed')));
      setQcReports(prev => {
        const next = { ...prev };
        delete next[cut.id];
        return next;
      });
    }
  };

  /** 收窄 qcReports：running 或缺失返回 null */
  const qcReportOf = (cutId: string): QcReport | null => {
    const r = qcReports[cutId];
    return r && r !== 'running' ? r : null;
  };

    const qcBadgeColor = (r: QcRecommendation): string => {
    if (r === 'ok') return 'var(--color-success)';
    if (r === 'review') return 'var(--color-warning)';
    return 'var(--color-danger)';
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.2rem' }}>
                <button
                  className="btn btn-secondary btn-xs"
                  style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}
                  onClick={() => handleRunQc(cut)}
                  disabled={qcReports[cut.id] === 'running'}
                >
                  <ShieldCheck size={13} /> {qcReports[cut.id] === 'running' ? t('export.qc.running') : t('export.qc.check')}
                </button>
                {(() => { const qc = qcReportOf(cut.id); if (!qc) return null; return (
                  <span
                    style={{
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      color: qcBadgeColor(qc.recommendation),
                      padding: '0.15rem 0.45rem',
                      borderRadius: '999px',
                      background: qcBadgeColor(qc.recommendation) + '22',
                    }}
                  >
                    {t('export.qc.' + qc.recommendation)}
                  </span>
                ); })()}
              </div>
              {(() => { const qc = qcReportOf(cut.id); if (!qc || qc.issues.length === 0) return null; return (
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                  {qc.issues.slice(0, 3).map((iss, i) => (
                    <div key={i} style={{ color: iss.severity === 'error' ? 'var(--color-danger)' : 'var(--color-warning)' }}>
                      {'• '}{iss.message}
                    </div>
                  ))}
                </div>
              ); })()}
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: 'auto' }}>
                <select
                  className="btn btn-secondary btn-xs"
                  style={{ flex: 1, fontSize: '0.72rem', padding: '0.2rem 0.3rem' }}
                  value={presetFor[cut.id] ?? 'generic'}
                  onChange={(e) => setPresetFor(prev => ({ ...prev, [cut.id]: e.target.value as ExportPreset }))}
                  aria-label={t('export.preset.label')}
                >
                  {EXPORT_PRESETS.map(p => (
                    <option key={p.id} value={p.id}>{t(p.labelKey)}</option>
                  ))}
                </select>
                <button
                  className="btn btn-primary btn-xs"
                  style={{ flex: 1 }}
                  onClick={() => handleDownload(cut, presetFor[cut.id] ?? 'generic')}
                >
                  <Download size={14} /> {t('export.downloadBtn')}
                </button>
                <button
                  className="btn btn-secondary btn-xs"
                  style={{ padding: '0.3rem 0.5rem' }}
                  onClick={() => handleCopyInfo(cut)}
                  title={t('export.copyInfo')}
                >
                  <Copy size={14} />
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
                  className="btn btn-secondary btn-xs"
                  style={{ padding: '0.3rem 0.5rem' }}
                  onClick={() => setReworkCut(cut)}
                  title={t('rework.title')}
                >
                  <RotateCcw size={14} />
                </button>
                <button
                  className="btn btn-secondary btn-xs"
                  style={{ padding: '0.3rem 0.5rem' }}
                  onClick={() => setPublishCut(cut)}
                  title={t('publish.title')}
                >
                  <Send size={14} />
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
      {publishCut && (
        <PublishPanel finalCut={publishCut} storyTitle={getStoryTitle(publishCut.storyId)} onClose={() => setPublishCut(null)} />
      )}
      {reworkCut && (
        <ReworkPanel cut={reworkCut} storyTitle={getStoryTitle(reworkCut.storyId)} onClose={() => setReworkCut(null)} onDone={() => {}} />
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
