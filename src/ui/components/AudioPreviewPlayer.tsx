/**
 * AudioPreviewPlayer — 统一音频预览播放器组件
 *
 * 功能：
 * - 波形可视化（Canvas 绘制）
 * - 播放/暂停控制
 * - 进度条拖拽
 * - 当前时间/总时长显示
 * - 音量控制
 * - 下载按钮
 * - 自动播放支持
 * - 加载状态
 * - 自动重试（最多 2 次）
 * - 延迟错误显示（避免短暂加载失败误报）
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, Download, Volume2, VolumeX, Loader2, AlertCircle, RotateCw } from 'lucide-react';

interface AudioPreviewPlayerProps {
  /** 音频 Blob URL 或可访问的音频 URL */
  src: string;
  /** 是否自动播放，默认 false */
  autoPlay?: boolean;
  /** 主题色，默认使用主色 */
  accentColor?: string;
  /** 是否显示下载按钮，默认 true */
  showDownload?: boolean;
  /** 下载文件名 */
  downloadFilename?: string;
  /** 是否显示波形，默认 true */
  showWaveform?: boolean;
  /** 紧凑模式（用于列表项），默认 false */
  compact?: boolean;
  /** 标题 */
  title?: string;
  /** 自定义样式 */
  style?: React.CSSProperties;
  /** 下载回调 */
  onDownload?: (src: string, filename: string) => void;
}

/** 格式化秒数为 mm:ss */
function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

const MAX_RETRY = 2;
const ERROR_DELAY_MS = 3000;

export const AudioPreviewPlayer: React.FC<AudioPreviewPlayerProps> = ({
  src,
  autoPlay = false,
  accentColor = 'var(--primary-color)',
  showDownload = true,
  downloadFilename,
  showWaveform = true,
  compact = false,
  title,
  style,
  onDownload,
}) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [waveformData, setWaveformData] = useState<number[]>([]);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [canPlayReady, setCanPlayReady] = useState(false);

  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingErrorRef = useRef<string | null>(null);

  // Audio 事件监听
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onLoadedMetadata = () => {
      setDuration(audio.duration);
      setIsLoading(false);
    };
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);
    const onWaiting = () => setIsLoading(true);
    const onCanPlay = () => {
      setIsLoading(false);
      setCanPlayReady(true);
      // 清除待显示的错误（如果音频最终加载成功了）
      if (errorTimerRef.current) {
        clearTimeout(errorTimerRef.current);
        errorTimerRef.current = null;
        pendingErrorRef.current = null;
      }
      setAudioError(null);
    };
    const onError = () => {
      const err = audio.error;
      let msg = '音频加载失败';
      if (err) {
        switch (err.code) {
          case MediaError.MEDIA_ERR_ABORTED: msg = '音频加载被中断'; break;
          case MediaError.MEDIA_ERR_NETWORK: msg = '网络错误，无法加载音频'; break;
          case MediaError.MEDIA_ERR_DECODE: msg = '音频解码失败，格式可能不受支持'; break;
          case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED: msg = '音频格式不受浏览器支持'; break;
          default: msg = `音频加载失败 (code: ${err.code})`;
        }
      }

      // 延迟显示错误：3s 内如果 canplay 事件触发则取消
      pendingErrorRef.current = msg;
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      errorTimerRef.current = setTimeout(() => {
        // 如果还在加载中，尝试重试
        if (retryCount < MAX_RETRY) {
          console.log(`[AudioPreviewPlayer] Retrying audio load (${retryCount + 1}/${MAX_RETRY})`);
          setRetryCount(prev => prev + 1);
          audio.load(); // 触发重新加载
          return;
        }
        setAudioError(pendingErrorRef.current);
        setIsLoading(false);
      }, ERROR_DELAY_MS);
    };

    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('error', onError);
      if (errorTimerRef.current) {
        clearTimeout(errorTimerRef.current);
      }
    };
  }, [src, retryCount]);

  // ====== 波形生成（延迟到 canplay 后，避免与 <audio> 竞争） ======

  useEffect(() => {
    if (!src || !showWaveform || !canPlayReady) return;

    let cancelled = false;
    const audioContext = new (window.AudioContext || (window as unknown as Record<string, unknown>).webkitAudioContext as typeof AudioContext)();

    const loadWaveform = async () => {
      try {
        const response = await fetch(src);
        const arrayBuffer = await response.arrayBuffer();
        if (cancelled) return;

        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        if (cancelled) return;

        const rawData = audioBuffer.getChannelData(0);
        const samples = compact ? 40 : 80;
        const blockSize = Math.floor(rawData.length / samples);
        const waveform: number[] = [];

        for (let i = 0; i < samples; i++) {
          let sum = 0;
          for (let j = 0; j < blockSize; j++) {
            sum += Math.abs(rawData[i * blockSize + j]);
          }
          waveform.push(sum / blockSize);
        }

        // 归一化
        const max = Math.max(...waveform, 0.01);
        setWaveformData(waveform.map(v => v / max));
      } catch {
        // 波形生成失败不影响播放
        setWaveformData([]);
      } finally {
        audioContext.close();
      }
    };

    loadWaveform();

    return () => {
      cancelled = true;
    };
  }, [src, showWaveform, compact, canPlayReady]);

  // ====== 绘制波形 ======

  useEffect(() => {
    if (!canvasRef.current || waveformData.length === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const barCount = waveformData.length;
    const barWidth = Math.max(2, (width / barCount) * 0.6);
    const barGap = (width - barWidth * barCount) / (barCount - 1 || 1);
    const progress = duration > 0 ? currentTime / duration : 0;

    ctx.clearRect(0, 0, width, height);

    for (let i = 0; i < barCount; i++) {
      const x = i * (barWidth + barGap);
      const barHeight = Math.max(2, waveformData[i] * height * 0.85);
      const y = (height - barHeight) / 2;

      const isPlayed = (i / barCount) < progress;

      if (isPlayed) {
        ctx.fillStyle = typeof accentColor === 'string' && accentColor.startsWith('var(')
          ? getComputedStyle(document.documentElement).getPropertyValue(accentColor.replace(/var\((.*?)\)/, '$1')).trim() || '#6366f1'
          : accentColor;
        ctx.globalAlpha = 0.9;
      } else {
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.2;
      }

      // 圆角矩形
      const radius = Math.min(barWidth / 2, 2);
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + barWidth - radius, y);
      ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + radius);
      ctx.lineTo(x + barWidth, y + barHeight - radius);
      ctx.quadraticCurveTo(x + barWidth, y + barHeight, x + barWidth - radius, y + barHeight);
      ctx.lineTo(x + radius, y + barHeight);
      ctx.quadraticCurveTo(x, y + barHeight, x, y + barHeight - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
      ctx.fill();
    }

    ctx.globalAlpha = 1;
  }, [waveformData, currentTime, duration, accentColor, compact]);

  // ====== 控制方法 ======

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(() => {});
    }
  }, [isPlaying]);

  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    const bar = progressRef.current;
    if (!audio || !bar || !duration) return;

    const rect = bar.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    audio.currentTime = ratio * duration;
  }, [duration]);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (audioRef.current) {
      audioRef.current.volume = val;
    }
    if (val > 0) setIsMuted(false);
  }, []);

  const toggleMute = useCallback(() => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    if (audioRef.current) {
      audioRef.current.volume = newMuted ? 0 : volume;
    }
  }, [isMuted, volume]);

  const handleDownloadClick = useCallback(() => {
    const filename = downloadFilename || `audio_${Date.now()}.mp3`;
    if (onDownload) {
      onDownload(src, filename);
    } else {
      const link = document.createElement('a');
      link.href = src;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }, [src, downloadFilename, onDownload]);

  const handleRetry = useCallback(() => {
    setAudioError(null);
    setRetryCount(0);
    setIsLoading(true);
    if (audioRef.current) {
      audioRef.current.load();
    }
  }, []);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  // ====== 错误状态 ======

  if (audioError) {
    return (
      <div style={{
        padding: compact ? '0.5rem' : '0.75rem',
        background: 'rgba(239,68,68,0.1)',
        border: '1px solid rgba(239,68,68,0.2)',
        borderRadius: 'var(--radius-md)',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        ...style,
      }}>
        <AlertCircle size={compact ? 14 : 16} style={{ color: 'var(--color-danger)', flexShrink: 0 }} />
        <span style={{ color: 'var(--color-danger)', fontSize: '0.8rem', flex: 1 }}>{audioError}</span>
        <button
          onClick={handleRetry}
          style={{
            background: 'none',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-danger)',
            cursor: 'pointer',
            padding: '0.2rem 0.5rem',
            fontSize: '0.75rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.25rem',
          }}
        >
          <RotateCw size={12} /> 重试
        </button>
      </div>
    );
  }

  // ====== 正常渲染 ======

  return (
    <div style={{
      background: 'rgba(0,0,0,0.2)',
      borderRadius: 'var(--radius-md)',
      padding: compact ? '0.5rem 0.75rem' : '0.75rem 1rem',
      display: 'flex',
      flexDirection: compact ? 'row' : 'column',
      alignItems: 'center',
      gap: compact ? '0.5rem' : '0.75rem',
      width: '100%',
      ...style,
    }}>
      <audio
        ref={audioRef}
        src={src}
        preload="auto"
        autoPlay={autoPlay}
        style={{ display: 'none' }}
      />

      {/* 播放按钮 */}
      <button
        onClick={togglePlay}
        style={{
          width: compact ? '28px' : '36px',
          height: compact ? '28px' : '36px',
          borderRadius: '50%',
          border: 'none',
          background: accentColor,
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          flexShrink: 0,
          transition: 'transform 0.15s, opacity 0.15s',
          opacity: isLoading ? 0.6 : 1,
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.1)'; }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
        disabled={isLoading}
      >
        {isLoading ? (
          <Loader2 size={compact ? 14 : 18} className="spin" />
        ) : isPlaying ? (
          <Pause size={compact ? 14 : 18} />
        ) : (
          <Play size={compact ? 14 : 18} style={{ marginLeft: '2px' }} />
        )}
      </button>

      {/* 中间区域：波形 + 进度条 + 时间 */}
      <div style={{ flex: 1, minWidth: 0, width: '100%' }}>
        {/* 波形 */}
        {showWaveform && waveformData.length > 0 && (
          <div
            ref={progressRef}
            onClick={handleProgressClick}
            style={{ cursor: 'pointer', marginBottom: compact ? '0' : '0.25rem' }}
          >
            <canvas
              ref={canvasRef}
              style={{
                width: '100%',
                height: compact ? '24px' : '40px',
                display: 'block',
                borderRadius: '4px',
              }}
            />
          </div>
        )}

        {/* 进度条（无波形时显示，或有波形时作为辅助） */}
        {(!showWaveform || waveformData.length === 0) && (
          <div
            ref={progressRef}
            onClick={handleProgressClick}
            style={{
              width: '100%',
              height: '4px',
              background: 'rgba(255,255,255,0.1)',
              borderRadius: '2px',
              cursor: 'pointer',
              position: 'relative',
            }}
          >
            <div style={{
              width: `${progress}%`,
              height: '100%',
              background: accentColor,
              borderRadius: '2px',
              transition: 'width 0.1s linear',
            }} />
          </div>
        )}

        {/* 时间 + 标题 */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: compact ? '0.15rem' : '0.25rem',
        }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
          {title && (
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '50%' }}>
              {title}
            </span>
          )}
        </div>
      </div>

      {/* 右侧控制区 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: compact ? '0.25rem' : '0.5rem', flexShrink: 0 }}>
        {/* 音量控制（非紧凑模式） */}
        {!compact && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <button
              onClick={toggleMute}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: '0.2rem',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              {isMuted || volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={isMuted ? 0 : volume}
              onChange={handleVolumeChange}
              style={{
                width: '60px',
                height: '3px',
                accentColor: accentColor as string,
                cursor: 'pointer',
              }}
            />
          </div>
        )}

        {/* 下载按钮 */}
        {showDownload && (
          <button
            onClick={handleDownloadClick}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '0.3rem',
              display: 'flex',
              alignItems: 'center',
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = accentColor as string; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; }}
            title="下载音频"
          >
            <Download size={compact ? 14 : 16} />
          </button>
        )}
      </div>
    </div>
  );
};
