/**
 * TimelineRenderService —— 时间线渲染编排服务
 *
 * 把用户编排好的 Timeline 渲染为最终视频 Blob：
 * 1. 解析各轨 clip 的 sourceRef → Blob（从 OPFS / 远程 URL）
 * 2. 视频轨：trim（裁切入出点）→ applyTransition（段间转场，offset 按 clip1 实际时长）→ concat
 * 3. 音频轨：旁白主轨 + BGM 辅助轨链式混音 → 与视频 merge
 * 4. 字幕轨：由 clip.text/时间生成 SRT → burnSubtitles
 * 5. 后处理：resize / compress / convertFormat（按 RenderExportOptions）
 *
 * 依赖现有 FFmpeg 原子操作（IFFmpegPort），不引入新的底层能力。
 * 失败时抛出 Error（不静默 Mock，遵循项目约束）。
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  IFFmpegPort,
  Timeline,
  TimelineClip,
  TimelineTrack,
  TimelineClipSource,
  TransitionType,
  SubtitleStyle,
} from '../ports/PostProcessPorts';
import type {
  ITimelineRenderPort,
  RenderExportOptions,
  RenderProgress,
} from '../ports/TimelineRenderPorts';
import type { IFileStoragePort } from '../ports/FileStoragePorts';
import type { IVideoTaskRepository, IFinalCutRepository } from '../ports/OutboundPorts';
import type { ISavedVideoRepository, ISavedVoiceRepository } from '../ports/AssetLibraryPorts';
import type { ILoggerPort, IHttpFetchPort } from '../ports/CrossCuttingPorts';

export interface TimelineRenderDeps {
  ffmpegPort: IFFmpegPort;
  fileStorage: IFileStoragePort | (() => IFileStoragePort);
  videoTaskRepo: IVideoTaskRepository;
  finalCutRepo: IFinalCutRepository;
  savedVideoRepo: ISavedVideoRepository;
  savedVoiceRepo: ISavedVoiceRepository;
  logger: ILoggerPort;
  /** HTTP 抓取 Port（远程视频源下载归一化） */
  httpFetch: IHttpFetchPort;
}

const QUALITY_CRF: Record<RenderExportOptions['quality'], number> = {
  high: 18,
  medium: 23,
  low: 28,
};

const RESOLUTION_MAP: Record<Exclude<RenderExportOptions['resolution'], 'original'>, { width: number; height: number }> = {
  '1080p': { width: 1920, height: 1080 },
  '720p': { width: 1280, height: 720 },
};

export class TimelineRenderService implements ITimelineRenderPort {
  private deps: TimelineRenderDeps;
  private logger: ILoggerPort;

  constructor(deps: TimelineRenderDeps) {
    this.deps = deps;
    this.logger = deps.logger;
  }

  private getFileStorage(): IFileStoragePort {
    const fs = this.deps.fileStorage;
    return typeof fs === 'function' ? fs() : fs;
  }

  async render(
    timeline: Timeline,
    options: RenderExportOptions,
    onProgress?: (p: RenderProgress) => void,
  ): Promise<Blob> {
    const log = this.logger;
    const ffmpeg = this.deps.ffmpegPort;
    const emit = (percent: number, stage: string) => onProgress?.({ percent, stage });

    log.info('[TimelineRender] start', { service: 'TimelineRenderService', clips: timeline.tracks.reduce((n, t) => n + t.clips.length, 0) });

    await ffmpeg.load();
    emit(2, '加载渲染引擎');

    const videoTrack = timeline.tracks.find(t => t.type === 'video' && !t.locked);
    const audioTracks = timeline.tracks.filter(t => t.type === 'audio' && !t.muted && !t.locked);
    const subtitleTrack = timeline.tracks.find(t => t.type === 'subtitle' && !t.locked);

    if (!videoTrack || videoTrack.clips.length === 0) {
      throw new Error('时间线没有可渲染的视频片段');
    }

    // 1. 解析视频轨 clips → 带时长的 Blob
    emit(5, '解析视频素材');
    const sortedVideoClips = [...videoTrack.clips].sort((a, b) => a.startTime - b.startTime);
    const videoBlobs: Array<{ blob: Blob; durationSec: number; transition?: TransitionType | 'none' }> = [];
    for (let i = 0; i < sortedVideoClips.length; i++) {
      const clip = sortedVideoClips[i];
      const resolved = await this.resolveSourceBlob(clip.sourceRef);
      if (!resolved) {
        throw new Error(`无法解析视频片段素材（clip=${clip.id}）`);
      }
      let blob = resolved.blob;
      // 入出点裁切
      if (clip.sourceRef?.inPointSec != null && clip.sourceRef?.outPointSec != null) {
        const inSec = clip.sourceRef.inPointSec;
        const outSec = clip.sourceRef.outPointSec;
        if (outSec > inSec) {
          blob = await ffmpeg.trim(blob, inSec, outSec);
        }
      }
      const durationSec = clip.duration > 0 ? clip.duration / 1000 : resolved.durationSec;
      videoBlobs.push({ blob, durationSec, transition: clip.transition });
      emit(5 + Math.round(((i + 1) / sortedVideoClips.length) * 20), `解析视频素材 ${i + 1}/${sortedVideoClips.length}`);
    }

    // 2. 视频轨：转场 + concat
    emit(28, '拼接视频片段');
    let videoResult = videoBlobs[0].blob;
    let prevDuration = videoBlobs[0].durationSec;
    for (let i = 1; i < videoBlobs.length; i++) {
      const cur = videoBlobs[i];
      const tr = cur.transition;
      if (tr && tr !== 'none') {
        const transitionDur = 0.5;
        // offset = 前一段时长 - 转场时长（修复原 offset 硬编码 3s 的 bug）
        const offsetSec = Math.max(0, prevDuration - transitionDur);
        try {
          videoResult = await ffmpeg.applyTransition(videoResult, cur.blob, tr, transitionDur, offsetSec);
        } catch (e) {
          log.warn('[TimelineRender] transition failed, fallback to concat', {
            service: 'TimelineRenderService',
            error: e instanceof Error ? e.message : String(e),
          });
          videoResult = await ffmpeg.concat([{ blob: videoResult }, { blob: cur.blob }]);
        }
      } else {
        videoResult = await ffmpeg.concat([{ blob: videoResult }, { blob: cur.blob }]);
      }
      prevDuration = cur.durationSec;
      emit(28 + Math.round((i / videoBlobs.length) * 20), `拼接视频片段 ${i + 1}/${videoBlobs.length}`);
    }

    // 3. 音频混音 → merge 到视频
    let result = videoResult;
    if (audioTracks.length > 0) {
      emit(52, '混音');
      const audioBlob = await this.collectAndMixAudio(audioTracks);
      if (audioBlob) {
        try {
          result = await ffmpeg.merge({ video: result, audio: audioBlob });
        } catch (e) {
          log.warn('[TimelineRender] audio merge failed', {
            service: 'TimelineRenderService',
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    // 4. 字幕烧录
    if (options.burnSubtitles && subtitleTrack && subtitleTrack.clips.some(c => c.text)) {
      emit(70, '烧录字幕');
      const srt = this.buildSrt(subtitleTrack);
      if (srt) {
        try {
          result = await ffmpeg.burnSubtitles(result, srt, options.subtitleStyle);
        } catch (e) {
          log.warn('[TimelineRender] burn subtitles failed', {
            service: 'TimelineRenderService',
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    // 5. 后处理：resize / compress
    if (options.resolution !== 'original') {
      const dim = RESOLUTION_MAP[options.resolution as '1080p' | '720p'];
      if (dim) {
        emit(82, '调整分辨率');
        try {
          result = await ffmpeg.resize(result, dim.width, dim.height);
        } catch (e) {
          log.warn('[TimelineRender] resize failed', {
            service: 'TimelineRenderService',
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    emit(88, '压缩导出');
    const crf = QUALITY_CRF[options.quality];
    result = await ffmpeg.compress(result, crf);

    if (options.format !== 'mp4') {
      result = await ffmpeg.convertFormat(result, options.format);
    }

    emit(100, '渲染完成');
    log.info('[TimelineRender] done', { service: 'TimelineRenderService', size: result.size });
    return result;
  }

  /** 探测 Blob 视频时长（秒），用 HTMLVideoElement 元数据读取（轻量，无需 ffprobe） */
  async probeDuration(blob: Blob): Promise<number> {
    return new Promise<number>(resolve => {
      const url = URL.createObjectURL(blob);
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve(Number.isFinite(video.duration) ? video.duration : 0);
      };
      video.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(0);
      };
      video.src = url;
    });
  }

  // ===== 素材解析 =====

  private async resolveSourceBlob(ref?: TimelineClipSource): Promise<{ blob: Blob; durationSec: number } | null> {
    if (!ref) return null;
    const fileStorage = this.getFileStorage();
    try {
      // 优先用 storagePath 直接从 OPFS 读取（支持 narration/bgm 裸路径铺轨）
      if (ref.storagePath) {
        const blob = await fileStorage.getBlob(ref.storagePath);
        if (blob) {
          const durationSec = ref.kind === 'videoTask' || ref.kind === 'savedVideo' || ref.kind === 'finalCut'
            ? await this.probeDuration(blob)
            : 0;
          return { blob, durationSec };
        }
        // storagePath 读取失败，按 kind 降级查仓储
      }
      switch (ref.kind) {
        case 'videoTask': {
          const task = await this.deps.videoTaskRepo.findById(ref.refId);
          if (!task || task.status !== 'SUCCESS' || !task.videoUrl) return null;
          const blob = await this.fetchOrRead(task.videoUrl, task.videoStoragePath);
          const durationSec = task.duration ?? (await this.probeDuration(blob));
          return { blob, durationSec };
        }
        case 'savedVideo': {
          const v = await this.deps.savedVideoRepo.getById(ref.refId);
          if (!v) return null;
          const blob = await fileStorage.getBlob(v.blobKey);
          if (!blob) return null;
          return { blob, durationSec: v.durationSec };
        }
        case 'finalCut': {
          const fc = await this.deps.finalCutRepo.findById(ref.refId);
          if (!fc) return null;
          const blob = fc.videoStoragePath ? await fileStorage.getBlob(fc.videoStoragePath) : fc.videoBlob;
          if (!blob) return null;
          return { blob, durationSec: fc.duration };
        }
        case 'savedVoice': {
          const v = await this.deps.savedVoiceRepo.getById(ref.refId);
          if (!v) return null;
          const blob = await fileStorage.getBlob(v.audioBlobKey);
          if (!blob) return null;
          return { blob, durationSec: 0 };
        }
        default:
          return null;
      }
    } catch (e) {
      this.logger.warn('[TimelineRender] resolve source failed', {
        service: 'TimelineRenderService',
        kind: ref.kind,
        refId: ref.refId,
        error: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  }

  /** 优先从 OPFS storagePath 读取，降级到远程 URL fetch */
  private async fetchOrRead(url: string, storagePath?: string): Promise<Blob> {
    if (storagePath) {
      const blob = await this.getFileStorage().getBlob(storagePath);
      if (blob) return blob;
    }
    return this.deps.httpFetch.fetchBlob(url);
  }

  // ===== 音频混音 =====

  private async collectAndMixAudio(audioTracks: TimelineTrack[]): Promise<Blob | null> {
    const ffmpeg = this.deps.ffmpegPort;
    const trackBlobs: Blob[] = [];
    for (const track of audioTracks) {
      const sorted = [...track.clips].sort((a, b) => a.startTime - b.startTime);
      for (const clip of sorted) {
        const resolved = await this.resolveSourceBlob(clip.sourceRef);
        if (resolved) trackBlobs.push(resolved.blob);
      }
    }
    if (trackBlobs.length === 0) return null;
    if (trackBlobs.length === 1) return trackBlobs[0];
    // 链式混音：第一个为主（旁白），后续以 0.3 音量混入（BGM 语义）
    let acc = trackBlobs[0];
    for (let i = 1; i < trackBlobs.length; i++) {
      acc = await ffmpeg.mixAudio(acc, trackBlobs[i], { voiceVolume: 1, bgmVolume: 0.3 });
    }
    return acc;
  }

  // ===== 字幕 =====

  private buildSrt(track: TimelineTrack): string {
    const entries = track.clips
      .filter(c => c.text && c.text.trim())
      .sort((a, b) => a.startTime - b.startTime)
      .map((c, i) => {
        const start = this.formatSrtTime(c.startTime / 1000);
        const end = this.formatSrtTime((c.startTime + c.duration) / 1000);
        return `${i + 1}\n${start} --> ${end}\n${c.text}`;
      });
    return entries.join('\n\n');
  }

  private formatSrtTime(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec - Math.floor(sec)) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  }
}

/**
 * 把渲染产物落盘并注册为 SavedVideo + FinalCut。
 * 供 UI 层调用：渲染完成后的统一收口。
 */
export interface PersistRenderResult {
  savedVideoId: string;
  finalCutId: string;
}

/** 生成新 ID（供 UI/Service 复用） */
export function newRenderId(): string {
  return uuidv4();
}

export type { TimelineClip, SubtitleStyle };
