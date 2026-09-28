/**
 * PreviewStage —— 剪辑工作台中央预览区
 *
 * 上半：视频预览播放器（基于选中 clip 的 sourceRef 解析 Blob URL）
 * 下半：TimelineEditor 时间线编排区
 *
 * 播放头由本组件统一管理，下传给 TimelineEditor 作受控时间。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TimelineEditor } from '../../components/TimelineEditor';
import { useToast } from '../../contexts/ToastContext';
import { getFileStorage, videoTaskRepo, finalCutRepo, savedVideoRepo, savedVoiceRepo } from '../../../dependencies';
import type { Timeline, TimelineClip } from '../../../domain/ports/PostProcessPorts';

interface PreviewStageProps {
  timeline: Timeline;
  selectedClip: TimelineClip | null;
  onChange: (timeline: Timeline) => void;
  onClipSelect: (clip: TimelineClip | null) => void;
}

export const PreviewStage: React.FC<PreviewStageProps> = ({ timeline, selectedClip, onChange, onClipSelect }) => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // 选中 clip 变化 → 解析预览 URL
  useEffect(() => {
    let revoked = false;
    let url: string | null = null;

    const resolve = async () => {
      if (!selectedClip?.sourceRef) {
        setPreviewUrl(null);
        return;
      }
      const ref = selectedClip.sourceRef;
      try {
        const fs = getFileStorage();
        // 优先用 storagePath 直接读
        if (ref.storagePath) {
          const blob = await fs.getBlob(ref.storagePath);
          if (blob) {
            url = URL.createObjectURL(blob);
            if (!revoked) setPreviewUrl(url);
            return;
          }
        }
        // 降级到仓储查找
        switch (ref.kind) {
          case 'videoTask': {
            if (!ref.refId) break;
            const task = await videoTaskRepo.findById(ref.refId);
            if (task?.videoStoragePath) {
              const blob = await fs.getBlob(task.videoStoragePath);
              if (blob) {
                url = URL.createObjectURL(blob);
                if (!revoked) setPreviewUrl(url);
              }
            } else if (task?.videoUrl) {
              url = task.videoUrl;
              if (!revoked) setPreviewUrl(url);
            }
            break;
          }
          case 'savedVideo': {
            if (!ref.refId) break;
            const v = await savedVideoRepo.getById(ref.refId);
            if (v) {
              const blob = await fs.getBlob(v.blobKey);
              if (blob) {
                url = URL.createObjectURL(blob);
                if (!revoked) setPreviewUrl(url);
              }
            }
            break;
          }
          case 'finalCut': {
            if (!ref.refId) break;
            const fc = await finalCutRepo.findById(ref.refId);
            if (fc?.videoStoragePath) {
              const blob = await fs.getBlob(fc.videoStoragePath);
              if (blob) {
                url = URL.createObjectURL(blob);
                if (!revoked) setPreviewUrl(url);
              }
            } else if (fc?.videoBlob) {
              url = URL.createObjectURL(fc.videoBlob);
              if (!revoked) setPreviewUrl(url);
            }
            break;
          }
          case 'savedVoice': {
            if (!ref.refId) break;
            const v = await savedVoiceRepo.getById(ref.refId);
            if (v) {
              const blob = await fs.getBlob(v.audioBlobKey);
              if (blob) {
                url = URL.createObjectURL(blob);
                if (!revoked) setPreviewUrl(url);
              }
            }
            break;
          }
          case 'imageAsVideo': {
            // T-2: 图片转视频素材，直接用图片 URL 预览静态帧
            if (!ref.imageUrl) break;
            url = ref.imageUrl;
            if (!revoked) setPreviewUrl(url);
            break;
          }
          case 'externalUrl': {
            // T-2: 远程视频/音频 URL 直用
            if (!ref.url) break;
            url = ref.url;
            if (!revoked) setPreviewUrl(url);
            break;
          }
        }
      } catch (e) {
        showToast('error', e instanceof Error ? e.message : t('editor.preview.loadFailed', '预览加载失败'));
      }
    };

    resolve();
    return () => {
      revoked = true;
      if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
    };
  }, [selectedClip, showToast, t]);

  // 播放头驱动 video.currentTime
  useEffect(() => {
    if (videoRef.current && !isPlaying) {
      videoRef.current.currentTime = currentTimeMs / 1000;
    }
  }, [currentTimeMs, isPlaying]);

  const handlePlayPause = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (isPlaying) {
      v.pause();
      setIsPlaying(false);
    } else {
      v.play().catch(() => undefined);
      setIsPlaying(true);
    }
  }, [isPlaying]);

  const handleTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v || !isPlaying) return;
    setCurrentTimeMs(v.currentTime * 1000);
  }, [isPlaying]);

  const handleVideoEnded = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const formatTime = useMemo(() => (ms: number) => {
    const sec = Math.floor(ms / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }, []);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.75rem', minWidth: 0 }}>
      {/* 预览播放器 */}
      <div style={{
        background: 'rgba(0,0,0,0.4)', borderRadius: 'var(--radius-md)', overflow: 'hidden',
        display: 'flex', flexDirection: 'column', minHeight: 240,
      }}>
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#000', minHeight: 200, position: 'relative',
        }}>
          {previewUrl ? (
            <video
              ref={videoRef}
              src={previewUrl}
              style={{ maxWidth: '100%', maxHeight: '100%' }}
              onTimeUpdate={handleTimeUpdate}
              onEnded={handleVideoEnded}
              controls={false}
            />
          ) : (
            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              {t('editor.preview.empty', '选中时间线片段以预览')}
            </span>
          )}
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.75rem',
          background: 'rgba(255,255,255,0.05)',
        }}>
          <button className="btn btn-primary" style={{ padding: '0.3rem 0.6rem' }} onClick={handlePlayPause} disabled={!previewUrl}>
            {isPlaying ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {formatTime(currentTimeMs)} / {formatTime(timeline.duration)}
          </span>
        </div>
      </div>

      {/* 时间线编排 */}
      <TimelineEditor
        timeline={timeline}
        onChange={onChange}
        onClipSelect={onClipSelect}
        currentTimeMs={currentTimeMs}
        onSeek={setCurrentTimeMs}
      />
    </div>
  );
};
