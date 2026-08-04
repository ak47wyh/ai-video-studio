/**
 * useStreamingAudioPlayer — 流式音频播放 React Hook
 *
 * 使用 MediaSource API + SourceBuffer 实现边生成边播放：
 * - 接收 WebSocket T2A 的 ArrayBuffer 音频块
 * - 自动追加到 SourceBuffer
 * - 无缝播放（无需等待全部生成）
 *
 * 降级：当浏览器不支持 MSE 时，回退到 Blob 累积 + Audio 元素。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { T2AStreamHandle, T2AStreamCallbacks } from '../../domain/ports/OutboundPorts';

export type StreamingState = 'idle' | 'connecting' | 'streaming' | 'complete' | 'error';

export interface UseStreamingAudioPlayerResult {
  state: StreamingState;
  error: string | null;
  audioUrl: string | null;
  startStreaming: (
    text: string,
    voiceId: string,
    service: { synthesizeStream: (text: string, voiceId: string, callbacks: T2AStreamCallbacks) => T2AStreamHandle }
  ) => void;
  stop: () => void;
  audioRef: React.RefObject<HTMLAudioElement | null>;
}

function hexToArrayBuffer(hex: string): ArrayBuffer {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const length = clean.length / 2;
  const buffer = new ArrayBuffer(length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < length; i++) {
    view[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return buffer;
}

export function useStreamingAudioPlayer(): UseStreamingAudioPlayerResult {
  const [state, setState] = useState<StreamingState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const chunksRef = useRef<ArrayBuffer[]>([]);
  const streamHandleRef = useRef<T2AStreamHandle | null>(null);
  // 用 ref 跟踪最新创建的 Object URL（含 MediaSource URL 与 Blob URL），卸载时兜底 revoke
  const objectUrlRef = useRef<string | null>(null);

  const mseSupported = typeof window !== 'undefined' &&
    typeof window.MediaSource !== 'undefined' &&
    MediaSource.isTypeSupported('audio/mpeg');

  const stop = useCallback(() => {
    if (streamHandleRef.current) {
      try { streamHandleRef.current.close(); } catch { /* ignore */ }
      streamHandleRef.current = null;
    }
    if (mediaSourceRef.current && mediaSourceRef.current.readyState === 'open') {
      try { mediaSourceRef.current.endOfStream(); } catch { /* ignore */ }
    }
    setState('idle');
  }, []);

  const startStreaming = useCallback((
    text: string,
    voiceId: string,
    service: { synthesizeStream: (text: string, voiceId: string, callbacks: T2AStreamCallbacks) => T2AStreamHandle }
  ) => {
    stop();
    setError(null);
    setAudioUrl(null);
    chunksRef.current = [];

    setState('connecting');

    const mimeType = 'audio/mpeg';
    if (mseSupported && audioRef.current) {
      try {
        const ms = new MediaSource();
        mediaSourceRef.current = ms;
        // 创建新 URL 前先释放旧的，避免 MediaSource Object URL 泄漏
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        const objectUrl = URL.createObjectURL(ms);
        objectUrlRef.current = objectUrl;
        audioRef.current.src = objectUrl;
        audioRef.current.load();

        ms.addEventListener('sourceopen', () => {
          if (MediaSource.isTypeSupported(mimeType)) {
            const sb = ms.addSourceBuffer(mimeType);
            sourceBufferRef.current = sb;
          }
        }, { once: true });
      } catch (e) {
        console.warn('MSE setup failed, falling back to Blob accumulation', e);
      }
    }

    const appendBuffer = (chunk: ArrayBuffer) => {
      chunksRef.current.push(chunk);
      const sb = sourceBufferRef.current;
      if (sb && !sb.updating && mediaSourceRef.current?.readyState === 'open') {
        try { sb.appendBuffer(chunk); } catch (e) { console.warn('appendBuffer error', e); }
      }
    };

    const handle: T2AStreamHandle = service.synthesizeStream(text, voiceId, {
      onAudioChunk: (chunk) => {
        setState('streaming');
        appendBuffer(chunk);
      },
      onComplete: () => {
        setState('complete');
        if (!mediaSourceRef.current && chunksRef.current.length > 0) {
          const blob = new Blob(chunksRef.current as BlobPart[], { type: mimeType });
          // 创建新 URL 前先释放旧的（含 MediaSource URL 或上一轮 Blob URL）
          if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
          const url = URL.createObjectURL(blob);
          objectUrlRef.current = url;
          setAudioUrl(url);
          if (audioRef.current) {
            audioRef.current.src = url;
            audioRef.current.play().catch(() => {});
          }
        } else {
          const blob = new Blob(chunksRef.current as BlobPart[], { type: mimeType });
          // 创建新 URL 前先释放旧的（含 MediaSource URL 或上一轮 Blob URL）
          if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
          const url = URL.createObjectURL(blob);
          objectUrlRef.current = url;
          setAudioUrl(url);
        }
      },
      onError: (err) => {
        setError(err.message);
        setState('error');
      }
    });

    streamHandleRef.current = handle;
  }, [mseSupported, stop]);

  useEffect(() => {
    return () => {
      stop();
      // 从 ref 读取最新 URL，避免闭包捕获初始 null 导致 Blob URL 泄漏
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [stop]);

  return { state, error, audioUrl, startStreaming, stop, audioRef };
}

export { hexToArrayBuffer };
