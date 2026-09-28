/**
 * ExportModal —— 时间线渲染导出弹窗
 *
 * 提供分辨率 / 质量 / 格式 / 字幕烧录选项，
 * 调用 useTimeline.exportTimeline → ITimelineRenderPort.render。
 * 渲染过程展示进度条 + 阶段文案，完成后可下载。
 */

import React, { useState } from 'react';
import { X, Download, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RenderExportOptions, RenderProgress } from '../../../domain/ports/TimelineRenderPorts';
import { useToast } from '../../contexts/ToastContext';
import { getErrorMessage } from '../../utils/errorUtils';

interface ExportModalProps {
  open: boolean;
  onClose: () => void;
  onExport: (options: RenderExportOptions, onProgress: (p: RenderProgress) => void) => Promise<Blob>;
  /** E-1/E-2: 当前时间线时长（ms），用于 GIF 体积警告与 4K 提示 */
  durationMs?: number;
}

type Phase = 'idle' | 'rendering' | 'done' | 'error';

export const ExportModal: React.FC<ExportModalProps> = ({ open, onClose, onExport, durationMs }) => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [resolution, setResolution] = useState<RenderExportOptions['resolution']>('original');
  const [format, setFormat] = useState<RenderExportOptions['format']>('mp4');
  const [quality, setQuality] = useState<RenderExportOptions['quality']>('medium');
  const [burnSubtitles, setBurnSubtitles] = useState(true);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<RenderProgress | null>(null);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // E-1: GIF 时长 >30s 时提示体积风险；E-2: 4K 提示耗时长
  const gifLongWarning = format === 'gif' && typeof durationMs === 'number' && durationMs / 1000 > 30;

  if (!open) return null;

  const handleExport = async () => {
    setPhase('rendering');
    setProgress({ percent: 0, stage: 'render.stage.loadingEngine' });
    setErrorMsg(null);
    setResultBlob(null);
    try {
      const options: RenderExportOptions = {
        resolution,
        format,
        quality,
        burnSubtitles,
      };
      const blob = await onExport(options, p => setProgress(p));
      setResultBlob(blob);
      setPhase('done');
      showToast('success', t('editor.export.success', '渲染完成'));
    } catch (e) {
      setErrorMsg(getErrorMessage(e, t('editor.export.failed', '渲染失败')));
      setPhase('error');
      showToast('error', getErrorMessage(e, t('editor.export.failed', '渲染失败')));
    }
  };

  const handleDownload = () => {
    if (!resultBlob) return;
    const url = URL.createObjectURL(resultBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `render-${Date.now()}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleClose = () => {
    if (phase === 'rendering') return; // 渲染中禁止关闭
    setPhase('idle');
    setProgress(null);
    setResultBlob(null);
    setErrorMsg(null);
    onClose();
  };

  return (
    <div
      onClick={handleClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
      }}
    >
      <div
        className="glass-panel"
        onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 480, padding: '1.5rem', position: 'relative' }}
      >
        <button
          className="btn btn-secondary"
          style={{ position: 'absolute', top: '0.75rem', right: '0.75rem', padding: '0.3rem', border: 'none', background: 'transparent' }}
          onClick={handleClose}
          disabled={phase === 'rendering'}
        >
          <X size={18} />
        </button>

        <h2 style={{ margin: '0 0 1rem', fontSize: '1.1rem' }}>
          {t('editor.export.title', '导出视频')}
        </h2>

        {phase === 'idle' && (
          <>
            <Field label={t('editor.export.resolution', '分辨率')}>
              <select className="input" value={resolution} onChange={e => setResolution(e.target.value as RenderExportOptions['resolution'])}>
                <option value="original">{t('editor.export.resolutionOriginal', '原分辨率')}</option>
                <option value="1080p">1080p</option>
                <option value="720p">720p</option>
                <option value="480p">480p</option>
                <option value="4k">4K</option>
                <option value="vertical_1080x1920">{t('editor.export.resolutionVertical', '竖屏 1080×1920')}</option>
              </select>
              {resolution === '4k' && (
                <div style={{ fontSize: '0.75rem', color: 'var(--warning-color, #f59e0b)', marginTop: '0.3rem' }}>
                  {t('editor.export.resolution4kWarn', '4K 渲染耗时较长，且源素材不足 4K 时画质不会提升')}
                </div>
              )}
            </Field>
            <Field label={t('editor.export.format', '格式')}>
              <select className="input" value={format} onChange={e => setFormat(e.target.value as RenderExportOptions['format'])}>
                <option value="mp4">{t('editor.export.formatMp4', 'MP4（通用推荐）')}</option>
                <option value="gif">{t('editor.export.formatGif', 'GIF（动图，适合 ≤30s）')}</option>
                <option value="webp">{t('editor.export.formatWebp', 'WebP（动画，适合网页）')}</option>
                <option value="mov">{t('editor.export.formatMov', 'MOV（高质量，适合剪辑）')}</option>
                <option value="webm">{t('editor.export.formatWebm', 'WebM（开源，适合网页）')}</option>
              </select>
              {gifLongWarning && (
                <div style={{ fontSize: '0.75rem', color: 'var(--warning-color, #f59e0b)', marginTop: '0.3rem' }}>
                  {t('editor.export.gifLongWarn', 'GIF 时长超过 30 秒，文件体积可能过大')}
                </div>
              )}
            </Field>
            <Field label={t('editor.export.quality', '质量')}>
              <select className="input" value={quality} onChange={e => setQuality(e.target.value as RenderExportOptions['quality'])}>
                <option value="high">{t('editor.export.qualityHigh', '高（文件大）')}</option>
                <option value="medium">{t('editor.export.qualityMedium', '中（推荐）')}</option>
                <option value="low">{t('editor.export.qualityLow', '低（文件小）')}</option>
              </select>
            </Field>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0.75rem 0', fontSize: '0.85rem' }}>
              <input type="checkbox" checked={burnSubtitles} onChange={e => setBurnSubtitles(e.target.checked)} />
              {t('editor.export.burnSubtitles', '烧录字幕轨')}
            </label>
            <button className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }} onClick={handleExport}>
              <Download size={16} />
              {t('editor.export.start', '开始渲染')}
            </button>
          </>
        )}

        {phase === 'rendering' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', padding: '1.5rem 0' }}>
            <Loader2 size={32} className="spin" style={{ color: 'var(--primary-color)' }} />
            <div style={{ width: '100%' }}>
              <div style={{ height: 6, background: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${progress?.percent ?? 0}%`, height: '100%',
                    background: 'var(--primary-color)', transition: 'width 0.2s',
                  }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.4rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                <span>{t(progress?.stage ?? '', { percent: progress?.percent ?? 0 })}</span>
                <span>{Math.round(progress?.percent ?? 0)}%</span>
              </div>
            </div>
          </div>
        )}

        {phase === 'done' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', padding: '1.5rem 0' }}>
            <CheckCircle2 size={36} style={{ color: 'var(--success-color, #22c55e)' }} />
            <span style={{ fontSize: '0.9rem' }}>
              {t('editor.export.success', '渲染完成')} · {Math.round((resultBlob?.size ?? 0) / 1024 / 1024)} MB
            </span>
            <button className="btn btn-primary" onClick={handleDownload}>
              <Download size={16} />
              {t('editor.export.download', '下载视频')}
            </button>
          </div>
        )}

        {phase === 'error' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', padding: '1.5rem 0' }}>
            <AlertCircle size={36} style={{ color: 'var(--error-color, #ef4444)' }} />
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center', wordBreak: 'break-word' }}>
              {errorMsg}
            </p>
            <button className="btn btn-secondary" onClick={() => setPhase('idle')}>
              {t('editor.export.retry', '重试')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ marginBottom: '0.75rem' }}>
    <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>{label}</label>
    {children}
  </div>
);
