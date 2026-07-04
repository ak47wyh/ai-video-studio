import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, ZoomIn, ZoomOut, Scissors, Volume2, VolumeX, Lock, Unlock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Timeline, TimelineClip, TimelineTrack, TransitionType } from '../../domain/ports/PostProcessPorts';
import {
  moveClip, resizeClip, trimClipLeft, removeClip,
  setClipTransition, splitClipAtPlayhead,
} from '../hooks/useTimeline';

export interface TimelineEditorProps {
  timeline: Timeline;
  onChange: (timeline: Timeline) => void;
  onPlay?: () => void;
  onPause?: () => void;
  onClipSelect?: (clip: TimelineClip | null) => void;
  /** 外部播放头时间（ms），传入后由外部驱动；不传则内部自维护 */
  currentTimeMs?: number;
  /** 外部播放头变更回调 */
  onSeek?: (ms: number) => void;
}

const DEFAULT_PX_PER_SECOND = 60;
const MIN_PX_PER_SECOND = 20;
const MAX_PX_PER_SECOND = 240;
/** 吸附阈值（像素）：拖动到该距离内自动吸附到其他 clip 边缘 / 播放头 */
const SNAP_THRESHOLD_PX = 8;

export const TimelineEditor: React.FC<TimelineEditorProps> = React.memo(({
  timeline,
  onChange,
  onPlay,
  onPause,
  onClipSelect,
  currentTimeMs: externalTimeMs,
  onSeek,
}) => {
  const { t } = useTranslation();
  const [pxPerSecond, setPxPerSecond] = useState(DEFAULT_PX_PER_SECOND);
  const [isPlaying, setIsPlaying] = useState(false);
  const [internalTimeMs, setInternalTimeMs] = useState(0);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [draggingClipId, setDraggingClipId] = useState<string | null>(null);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartTime, setDragStartTime] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // 外部受控 / 内部自维护播放头
  const currentTimeMs = externalTimeMs ?? internalTimeMs;
  const currentTimeMsRef = useRef(currentTimeMs);
  useEffect(() => {
    currentTimeMsRef.current = currentTimeMs;
  }, [currentTimeMs]);
  const setCurrentTimeMs = useCallback((ms: number) => {
    if (onSeek) onSeek(ms);
    else setInternalTimeMs(ms);
  }, [onSeek]);

  const totalWidth = Math.max(timeline.duration, 5000) / 1000 * pxPerSecond;

  const sortedTracks = useMemo(() => {
    return [...timeline.tracks].sort((a, b) => {
      const order = { video: 0, subtitle: 1, audio: 2 };
      return (order[a.type] ?? 3) - (order[b.type] ?? 3);
    });
  }, [timeline.tracks]);

  const formatTime = (ms: number): string => {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    const milli = Math.floor((ms % 1000) / 100);
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${milli}`;
  };

  const handleZoomIn = () => setPxPerSecond(p => Math.min(p * 1.5, MAX_PX_PER_SECOND));
  const handleZoomOut = () => setPxPerSecond(p => Math.max(p / 1.5, MIN_PX_PER_SECOND));

  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      setIsPlaying(false);
      onPause?.();
    } else {
      setIsPlaying(true);
      onPlay?.();
    }
  }, [isPlaying, onPlay, onPause]);

  // 内部播放头驱动（外部受控时不启用）
  useEffect(() => {
    if (!isPlaying || externalTimeMs != null) return;
    let rafId: number;
    let lastFrameTime = performance.now();
    const tick = (now: number) => {
      const delta = now - lastFrameTime;
      lastFrameTime = now;
      const next = currentTimeMsRef.current + delta;
      if (next >= timeline.duration) {
        currentTimeMsRef.current = timeline.duration;
        setInternalTimeMs(timeline.duration);
        setIsPlaying(false);
        onPause?.();
        return;
      }
      currentTimeMsRef.current = next;
      setInternalTimeMs(next);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, timeline.duration, onPause, externalTimeMs]);

  // ===== 吸附：收集所有可作为吸附点的 X 坐标 =====
  const collectSnapPoints = useCallback((excludeClipId: string | null): number[] => {
    const points: number[] = [0];
    // 播放头
    points.push((currentTimeMsRef.current / 1000) * pxPerSecond);
    for (const track of timeline.tracks) {
      if (track.locked) continue;
      for (const c of track.clips) {
        if (c.id === excludeClipId) continue;
        points.push((c.startTime / 1000) * pxPerSecond);
        points.push(((c.startTime + c.duration) / 1000) * pxPerSecond);
      }
    }
    return points;
  }, [timeline.tracks, pxPerSecond]);

  const snap = useCallback((targetPx: number, excludeClipId?: string): number => {
    const points = collectSnapPoints(excludeClipId ?? null);
    let best = targetPx;
    let bestDelta = SNAP_THRESHOLD_PX;
    for (const p of points) {
      const d = Math.abs(p - targetPx);
      if (d < bestDelta) {
        bestDelta = d;
        best = p;
      }
    }
    return best;
  }, [collectSnapPoints]);

  // ===== clip 拖动（带吸附） =====
  const handleClipMouseDown = (e: React.MouseEvent, clip: TimelineClip) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setDraggingClipId(clip.id);
    setDragStartX(e.clientX);
    setDragStartTime(clip.startTime);
    setSelectedClipId(clip.id);
    onClipSelect?.(clip);
  };

  useEffect(() => {
    if (!draggingClipId) return;
    const handleMouseMove = (e: MouseEvent) => {
      const deltaPx = e.clientX - dragStartX;
      // 原始新位置（px）
      const rawTargetPx = (dragStartTime / 1000) * pxPerSecond + deltaPx;
      // 吸附后位置
      const snappedPx = Math.max(0, snap(rawTargetPx, draggingClipId));
      const newStartTime = (snappedPx / pxPerSecond) * 1000;
      onChange(moveClip(timeline, draggingClipId, newStartTime));
    };
    const handleMouseUp = () => {
      setDraggingClipId(null);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingClipId, dragStartX, dragStartTime, pxPerSecond, timeline, onChange, snap]);

  const handleClipResize = useCallback((clipId: string, newDuration: number) => {
    onChange(resizeClip(timeline, clipId, newDuration));
  }, [timeline, onChange]);

  /** 左边缘裁切：deltaMs>0 缩短左侧，<0 向左扩展 */
  const handleClipTrimLeft = useCallback((clipId: string, deltaMs: number) => {
    onChange(trimClipLeft(timeline, clipId, deltaMs));
  }, [timeline, onChange]);

  const handleRemoveClip = useCallback((clipId: string) => {
    onChange(removeClip(timeline, clipId));
    if (selectedClipId === clipId) {
      setSelectedClipId(null);
      onClipSelect?.(null);
    }
  }, [timeline, onChange, selectedClipId, onClipSelect]);

  const toggleTrackMute = (trackId: string) => {
    const newTracks = timeline.tracks.map(t =>
      t.id === trackId ? { ...t, muted: !t.muted } : t
    );
    onChange({ ...timeline, tracks: newTracks });
  };

  const toggleTrackLock = (trackId: string) => {
    const newTracks = timeline.tracks.map(t =>
      t.id === trackId ? { ...t, locked: !t.locked } : t
    );
    onChange({ ...timeline, tracks: newTracks });
  };

  const handleSplitAtPlayhead = useCallback(() => {
    if (!selectedClipId) return;
    onChange(splitClipAtPlayhead(timeline, selectedClipId, currentTimeMsRef.current));
  }, [selectedClipId, timeline, onChange]);

  const handleSetTransition = useCallback((clipId: string, transition: TransitionType | 'none') => {
    onChange(setClipTransition(timeline, clipId, transition));
  }, [timeline, onChange]);

  // ===== 轨道点击：定位播放头 =====
  const handleTrackClick = (e: React.MouseEvent, track: TimelineTrack) => {
    if (track.locked) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ms = (x / pxPerSecond) * 1000;
    setCurrentTimeMs(Math.max(0, Math.min(ms, timeline.duration)));
  };

  // ===== 键盘快捷键 =====
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleKey = (e: KeyboardEvent) => {
      // 输入框中不拦截
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      switch (e.key) {
        case ' ':
          e.preventDefault();
          handlePlayPause();
          break;
        case 'Delete':
        case 'Backspace':
          if (selectedClipId) {
            e.preventDefault();
            handleRemoveClip(selectedClipId);
          }
          break;
        case 's':
        case 'S':
          if (selectedClipId) {
            e.preventDefault();
            handleSplitAtPlayhead();
          }
          break;
        case 'ArrowLeft': {
          e.preventDefault();
          const step = e.shiftKey ? 1000 : 100; // Shift+← 1s，← 100ms
          setCurrentTimeMs(Math.max(0, currentTimeMsRef.current - step));
          break;
        }
        case 'ArrowRight': {
          e.preventDefault();
          const step = e.shiftKey ? 1000 : 100;
          setCurrentTimeMs(Math.min(timeline.duration, currentTimeMsRef.current + step));
          break;
        }
        default:
          break;
      }
    };
    el.addEventListener('keydown', handleKey);
    return () => el.removeEventListener('keydown', handleKey);
  }, [containerRef, selectedClipId, handlePlayPause, handleRemoveClip, handleSplitAtPlayhead, timeline.duration, setCurrentTimeMs]);

  const renderRuler = () => {
    const ticks: React.ReactElement[] = [];
    const totalSec = Math.max(Math.ceil(timeline.duration / 1000), 10);
    const tickInterval = pxPerSecond >= 80 ? 1 : pxPerSecond >= 40 ? 2 : 5;
    for (let s = 0; s <= totalSec; s += tickInterval) {
      const x = s * pxPerSecond;
      ticks.push(
        <div key={s} style={{
          position: 'absolute',
          left: x,
          top: 0,
          height: '100%',
          borderLeft: s % (tickInterval * 5) === 0 ? '1px solid rgba(255,255,255,0.3)' : '1px solid rgba(255,255,255,0.1)',
          fontSize: '0.65rem',
          color: 'rgba(255,255,255,0.5)',
          paddingLeft: '4px'
        }}>
          {formatTime(s * 1000)}
        </div>
      );
    }
    return ticks;
  };

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      style={{ display: 'flex', flexDirection: 'column', background: 'rgba(0,0,0,0.4)', borderRadius: 'var(--radius-md)', overflow: 'hidden', outline: 'none' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem', background: 'rgba(255,255,255,0.05)' }}>
        <button className="btn btn-primary" style={{ padding: '0.3rem 0.6rem' }} onClick={handlePlayPause}>
          {isPlaying ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', minWidth: '5rem' }}>
          {formatTime(currentTimeMs)} / {formatTime(timeline.duration)}
        </span>
        <div style={{ flex: 1 }} />
        <button className="btn btn-secondary" style={{ padding: '0.3rem 0.5rem' }} onClick={handleSplitAtPlayhead} disabled={!selectedClipId} title={t('timeline.splitAtPlayhead') + ' (S)'}>
          <Scissors size={14} />
        </button>
        <button className="btn btn-secondary" style={{ padding: '0.3rem 0.5rem' }} onClick={handleZoomOut} title={t('timeline.zoomOut')}>
          <ZoomOut size={14} />
        </button>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{pxPerSecond}px/s</span>
        <button className="btn btn-secondary" style={{ padding: '0.3rem 0.5rem' }} onClick={handleZoomIn} title={t('timeline.zoomIn')}>
          <ZoomIn size={14} />
        </button>
      </div>

      <div style={{ overflowX: 'auto', overflowY: 'hidden', padding: '0.5rem' }}>
        <div style={{ minWidth: totalWidth, position: 'relative' }}>
          <div style={{
            position: 'relative',
            height: '24px',
            background: 'rgba(255,255,255,0.05)',
            borderBottom: '1px solid rgba(255,255,255,0.1)',
            marginBottom: '0.5rem'
          }}>
            {renderRuler()}
          </div>

          {sortedTracks.map(track => (
            <div key={track.id} style={{ display: 'flex', alignItems: 'center', marginBottom: '0.25rem' }}>
              <div style={{
                width: '100px',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem',
                padding: '0.25rem',
                background: 'rgba(255,255,255,0.05)',
                borderRadius: 'var(--radius-sm)',
                marginRight: '0.5rem'
              }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', flex: 1 }}>{track.type}</span>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '0.15rem 0.3rem', border: 'none' }}
                  onClick={() => toggleTrackMute(track.id)}
                  title={track.muted ? t('timeline.unmute') : t('timeline.mute')}
                >
                  {track.muted ? <VolumeX size={10} /> : <Volume2 size={10} />}
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '0.15rem 0.3rem', border: 'none' }}
                  onClick={() => toggleTrackLock(track.id)}
                  title={track.locked ? t('timeline.unlock') : t('timeline.lock')}
                >
                  {track.locked ? <Lock size={10} /> : <Unlock size={10} />}
                </button>
              </div>
              <div
                style={{
                  position: 'relative',
                  flex: 1,
                  height: '50px',
                  background: 'rgba(255,255,255,0.03)',
                  borderRadius: 'var(--radius-sm)',
                  overflow: 'hidden',
                  opacity: track.muted ? 0.4 : 1,
                  cursor: track.locked ? 'not-allowed' : 'text',
                }}
                onMouseDown={(e) => {
                  // 点击轨道空白处：定位播放头 + 取消选中
                  if (e.target === e.currentTarget) {
                    handleTrackClick(e, track);
                    setSelectedClipId(null);
                    onClipSelect?.(null);
                  }
                }}
              >
                {track.clips.map(clip => (
                  <ClipView
                    key={clip.id}
                    clip={clip}
                    pxPerSecond={pxPerSecond}
                    selected={selectedClipId === clip.id}
                    onMouseDown={(e) => handleClipMouseDown(e, clip)}
                    onResize={(newDuration) => handleClipResize(clip.id, newDuration)}
                    onTrimLeft={(deltaMs) => handleClipTrimLeft(clip.id, deltaMs)}
                    onTransitionChange={(tr) => handleSetTransition(clip.id, tr)}
                    onRemove={() => handleRemoveClip(clip.id)}
                  />
                ))}
              </div>
            </div>
          ))}

          <div style={{
            position: 'absolute',
            top: 0,
            left: (currentTimeMs / 1000) * pxPerSecond,
            width: '2px',
            height: '100%',
            background: '#ef4444',
            pointerEvents: 'none',
            zIndex: 10
          }} />
        </div>
      </div>
    </div>
  );
});

TimelineEditor.displayName = 'TimelineEditor';

interface ClipViewProps {
  clip: TimelineClip;
  pxPerSecond: number;
  selected: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onResize: (newDuration: number) => void;
  /** 左边缘裁切：deltaMs>0 缩短左侧，<0 向左扩展 */
  onTrimLeft: (deltaMs: number) => void;
  onRemove: () => void;
  onTransitionChange: (transition: TransitionType | 'none') => void;
}

const ClipView: React.FC<ClipViewProps> = ({
  clip,
  pxPerSecond,
  selected,
  onMouseDown,
  onResize,
  onTrimLeft,
  onRemove,
}) => {
  const left = (clip.startTime / 1000) * pxPerSecond;
  const width = (clip.duration / 1000) * pxPerSecond;
  // 右边缘 resize
  const [resizing, setResizing] = useState(false);
  const [resizeStart, setResizeStart] = useState({ x: 0, duration: 0 });
  // 左边缘 trim
  const [trimming, setTrimming] = useState(false);
  const [trimStart, setTrimStart] = useState({ x: 0 });

  const colorByType: Record<string, string> = {
    video: 'rgba(99,102,241,0.6)',
    audio: 'rgba(34,197,94,0.6)',
    subtitle: 'rgba(234,179,8,0.6)',
    transition: 'rgba(236,72,153,0.6)'
  };
  const color = colorByType[clip.type] || 'rgba(99,102,241,0.6)';

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    setResizing(true);
    setResizeStart({ x: e.clientX, duration: clip.duration });
  };

  useEffect(() => {
    if (!resizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      const deltaPx = e.clientX - resizeStart.x;
      const deltaMs = (deltaPx / pxPerSecond) * 1000;
      onResize(Math.max(100, resizeStart.duration + deltaMs));
    };
    const handleMouseUp = () => setResizing(false);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizing, resizeStart, pxPerSecond, onResize]);

  const handleTrimMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    setTrimming(true);
    setTrimStart({ x: e.clientX });
  };

  useEffect(() => {
    if (!trimming) return;
    const handleMouseMove = (e: MouseEvent) => {
      const deltaPx = e.clientX - trimStart.x;
      const deltaMs = (deltaPx / pxPerSecond) * 1000;
      // 限制：trim 后时长不得低于 100ms
      const maxDeltaMs = clip.duration - 100;
      const clamped = Math.max(-Infinity, Math.min(deltaMs, maxDeltaMs));
      onTrimLeft(clamped);
      // 重置起点，使后续 delta 基于当前帧（增量式 trim）
      setTrimStart({ x: e.clientX });
    };
    const handleMouseUp = () => setTrimming(false);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [trimming, trimStart, pxPerSecond, onTrimLeft, clip.duration]);

  return (
    <div
      onMouseDown={onMouseDown}
      onContextMenu={(e) => { e.preventDefault(); onRemove(); }}
      style={{
        position: 'absolute',
        left,
        top: 4,
        width: Math.max(20, width),
        height: 42,
        background: color,
        border: selected ? '2px solid #fbbf24' : '1px solid rgba(255,255,255,0.2)',
        borderRadius: 'var(--radius-sm)',
        cursor: 'grab',
        userSelect: 'none',
        display: 'flex',
        alignItems: 'center',
        padding: '0 0.5rem',
        overflow: 'hidden',
        fontSize: '0.7rem',
        color: '#fff',
        boxShadow: selected ? '0 0 0 2px color-mix(in srgb, var(--color-warning) 30%, transparent)' : undefined
      }}
    >
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {clip.text || clip.source || clip.type}
      </span>
      {clip.transition && clip.transition !== 'none' && (
        <span style={{ fontSize: '0.6rem', opacity: 0.7, marginLeft: '0.25rem' }}>
          ↪ {clip.transition}
        </span>
      )}
      {/* 左边缘 trim 手柄 */}
      <div
        onMouseDown={handleTrimMouseDown}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '6px',
          height: '100%',
          cursor: 'ew-resize',
          background: selected ? 'rgba(251,191,36,0.4)' : 'rgba(0,0,0,0.3)',
        }}
      />
      {/* 右边缘 resize 手柄 */}
      <div
        onMouseDown={handleResizeMouseDown}
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          width: '6px',
          height: '100%',
          cursor: 'ew-resize',
          background: selected ? 'rgba(251,191,36,0.4)' : 'rgba(0,0,0,0.3)'
        }}
      />
    </div>
  );
};
