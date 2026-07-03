/**
 * SegmentPreviewModal —— 分镜段级预览弹窗
 *
 * M3.5 段级预览（EVOLUTION_DESIGN.md §7.5）：
 *   在最终合成前预览单个分镜的"视频 + 旁白 + BGM + 字幕"组合效果，
 *   避免整段 Pipeline 跑完才发现某段不满意。
 *
 * 流程：
 *   [StoryWorkbench SegmentCard] "预览合成" → [SegmentPreviewModal]
 *   → 收集该段的视频/音频/BGM/字幕
 *   → 用 TimelineRenderService 渲染单段（不入 FinalCut 库）
 *   → <video> 预览
 *   → 用户可调整转场/BGM音量/字幕样式后重渲染
 *   → 满意后点"应用到全部" → 走完整 Pipeline
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Play, Loader2, RefreshCw, Check } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import type { StorySegment } from '../../domain/entities/models';

export interface SegmentPreviewModalProps {
  isOpen: boolean;
  segment: StorySegment | null;
  onClose: () => void;
  /** 渲染单段视频（由调用方注入，复用 TimelineRenderService） */
  onRenderSegment?: (segment: StorySegment, options: SegmentPreviewOptions) => Promise<string | null>;
  /** 用户点"应用到全部"时触发，走完整 Pipeline */
  onApplyToAll?: () => void;
}

export interface SegmentPreviewOptions {
  transitionType: 'fade' | 'fadeblack' | 'fadewhite' | 'none';
  bgmVolume: number;
  voiceVolume: number;
  subtitleStyle: 'default' | 'bold' | 'minimal';
}

const DEFAULT_OPTIONS: SegmentPreviewOptions = {
  transitionType: 'fade',
  bgmVolume: 0.3,
  voiceVolume: 0.8,
  subtitleStyle: 'default',
};

export const SegmentPreviewModal: React.FC<SegmentPreviewModalProps> = ({
  isOpen, segment, onClose, onRenderSegment, onApplyToAll,
}) => {
  const { t } = useTranslation();
  const { showToast } = useToast();

  const [options, setOptions] = useState<SegmentPreviewOptions>(DEFAULT_OPTIONS);
  const [rendering, setRendering] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const objectUrlRef = useRef<string | null>(null);

  // 弹窗打开且有分镜时重置预览状态
  useEffect(() => {
    if (!isOpen || !segment) return;
    /* eslint-disable react-hooks/set-state-in-effect -- 切换 segment 时重置预览状态属于 effect 副作用 */
    setPreviewUrl(null);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [isOpen, segment]);

  // 清理 object URL
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  const handleRender = useCallback(async () => {
    if (!segment || !onRenderSegment) return;
    setRendering(true);
    setError(null);

    // 清理旧 URL
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }

    try {
      const url = await onRenderSegment(segment, options);
      if (url) {
        objectUrlRef.current = url;
        setPreviewUrl(url);
        showToast(t('segmentPreview.renderSuccess', '渲染完成'), 'success');
      } else {
        setError(t('segmentPreview.renderFailed', '渲染失败：素材不完整，请确保该分镜已有视频和音频'));
      }
    } catch (e) {
      console.error('render segment failed', e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRendering(false);
    }
  }, [segment, options, onRenderSegment, showToast, t]);

  const handleApplyToAll = useCallback(() => {
    onApplyToAll?.();
    onClose();
  }, [onApplyToAll, onClose]);

  if (!isOpen || !segment) return null;

  // 检查素材完整性
  const hasVideo = !!segment.videoUrl;
  const hasVoice = !!segment.narrationAudioStoragePath || !!segment.narrationAudioUrl;
  const hasBgm = !!segment.bgmStoragePath || !!segment.bgmAudioUrl;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: 720, maxHeight: '90vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Play size={16} />
            {t('segmentPreview.title', '分镜预览')} — #{segment.sequenceOrder + 1}
          </h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        {/* 分镜内容 */}
        <div style={{ marginBottom: 12, padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 13, color: 'var(--text-muted)' }}>
          {segment.content.slice(0, 120)}
          {segment.content.length > 120 ? '...' : ''}
        </div>

        {/* 素材状态指示 */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 12, fontSize: 12 }}>
          <span style={{ color: hasVideo ? 'var(--success)' : 'var(--text-muted)' }}>
            {hasVideo ? '✓' : '✗'} {t('segmentPreview.video', '视频')}
          </span>
          <span style={{ color: hasVoice ? 'var(--success)' : 'var(--text-muted)' }}>
            {hasVoice ? '✓' : '✗'} {t('segmentPreview.voice', '旁白')}
          </span>
          <span style={{ color: hasBgm ? 'var(--success)' : 'var(--text-muted)' }}>
            {hasBgm ? '✓' : '✗'} {t('segmentPreview.bgm', 'BGM')}
          </span>
        </div>

        {/* 参数调整 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
              {t('segmentPreview.transition', '转场')}
            </label>
            <select
              className="input"
              value={options.transitionType}
              onChange={e => setOptions(prev => ({ ...prev, transitionType: e.target.value as SegmentPreviewOptions['transitionType'] }))}
            >
              <option value="fade">{t('segmentPreview.fade', '淡入淡出')}</option>
              <option value="fadeblack">{t('segmentPreview.fadeblack', '黑场过渡')}</option>
              <option value="fadewhite">{t('segmentPreview.fadewhite', '白场过渡')}</option>
              <option value="none">{t('segmentPreview.noTransition', '无转场')}</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
              {t('segmentPreview.subtitleStyle', '字幕样式')}
            </label>
            <select
              className="input"
              value={options.subtitleStyle}
              onChange={e => setOptions(prev => ({ ...prev, subtitleStyle: e.target.value as SegmentPreviewOptions['subtitleStyle'] }))}
            >
              <option value="default">{t('segmentPreview.styleDefault', '默认')}</option>
              <option value="bold">{t('segmentPreview.styleBold', '加粗')}</option>
              <option value="minimal">{t('segmentPreview.styleMinimal', '极简')}</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
              {t('segmentPreview.voiceVolume', '人声音量')}: {Math.round(options.voiceVolume * 100)}%
            </label>
            <input
              type="range" min={0} max={1} step={0.1}
              value={options.voiceVolume}
              onChange={e => setOptions(prev => ({ ...prev, voiceVolume: Number(e.target.value) }))}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
              {t('segmentPreview.bgmVolume', 'BGM 音量')}: {Math.round(options.bgmVolume * 100)}%
            </label>
            <input
              type="range" min={0} max={1} step={0.1}
              value={options.bgmVolume}
              onChange={e => setOptions(prev => ({ ...prev, bgmVolume: Number(e.target.value) }))}
              style={{ width: '100%' }}
            />
          </div>
        </div>

        {/* 预览区 */}
        {error ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--error)', fontSize: 13 }}>
            {error}
          </div>
        ) : previewUrl ? (
          <div style={{ marginBottom: 16 }}>
            <video
              ref={videoRef}
              src={previewUrl}
              controls
              style={{ width: '100%', borderRadius: 8, background: '#000' }}
            />
          </div>
        ) : (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, background: 'var(--bg-secondary)', borderRadius: 8 }}>
            {rendering ? (
              <>
                <Loader2 size={20} className="spin" />
                <p style={{ marginTop: 8 }}>{t('segmentPreview.rendering', '渲染中…')}</p>
              </>
            ) : (
              t('segmentPreview.placeholder', '点击下方按钮预览该分镜合成效果')
            )}
          </div>
        )}

        {/* 底部操作 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <button
            className="btn btn-primary"
            onClick={handleRender}
            disabled={rendering || (!hasVideo && !hasVoice)}
          >
            {rendering ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
            {previewUrl ? t('segmentPreview.rerender', '重新渲染') : t('segmentPreview.render', '渲染预览')}
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={onClose}>
              {t('common.close', '关闭')}
            </button>
            {previewUrl && onApplyToAll && (
              <button className="btn btn-success" onClick={handleApplyToAll}>
                <Check size={14} />
                {t('segmentPreview.applyToAll', '应用到全部')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
