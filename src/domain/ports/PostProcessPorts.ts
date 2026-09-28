// --- FFmpeg 后期处理 ---

export type TransitionType = 'none' | 'fade' | 'fadeblack' | 'fadewhite' | 'wipeleft' | 'wiperight' | 'slideup' | 'slidedown' | 'circlecrop' | 'rectcrop' | 'distance';
export type OutputFormat = 'mp4' | 'webm' | 'mov' | 'gif' | 'webp';

/** T-1：转场参数配置（类型 + 时长） */
export interface TransitionOptions {
  type: TransitionType;
  /** 转场时长（秒），默认 0.5，范围 0.1 ~ 2.0 */
  durationSec: number;
}

/** T-1：时长钳制到 [0.1, 2.0]，非法值回退 0.5 */
export function clampTransitionDuration(sec: number): number {
  if (!Number.isFinite(sec)) return 0.5;
  return Math.min(2.0, Math.max(0.1, sec));
}

/** T-1：旧字符串转场字段（如 'fade' / 'none'）迁移为 TransitionOptions，向后兼容 */
export function normalizeTransition(raw?: unknown): TransitionOptions | undefined {
  if (!raw) return undefined;
  if (typeof raw === 'string') return { type: raw as TransitionType, durationSec: 0.5 };
  if (typeof raw === 'object' && 'type' in (raw as Record<string, unknown>)) {
    const obj = raw as TransitionOptions;
    return { type: obj.type, durationSec: clampTransitionDuration(obj.durationSec ?? 0.5) };
  }
  return undefined;
}

export interface CropOptions {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MergeContext {
  video: Blob;
  audio: Blob;
  audioOffset?: number;
}

export interface SubtitleStyle {
  fontFamily?: string;
  fontSize?: number;
  primaryColor?: string;
  outlineColor?: string;
  outlineWidth?: number;
  position?: 'top' | 'center' | 'bottom';
  /** 距画面底边距（px，ASS MarginV 语义） */
  marginV?: number;
  bold?: boolean;
}

export interface VideoClip {
  blob: Blob;
  duration?: number;
  transitionIn?: { type: TransitionType; duration: number };
}

export interface BgmMixConfig {
  voiceVolume: number;
  bgmVolume: number;
  fadeIn?: number;
  fadeOut?: number;
}

export interface IFFmpegPort {
  load(): Promise<void>;
  isLoaded(): boolean;
  merge(ctx: MergeContext): Promise<Blob>;
  concat(clips: VideoClip[]): Promise<Blob>;
  burnSubtitles(video: Blob, srt: string, style?: SubtitleStyle): Promise<Blob>;
  mixAudio(voice: Blob, bgm: Blob, config: BgmMixConfig): Promise<Blob>;
  applyTransition(clip1: Blob, clip2: Blob, opts: TransitionOptions, offsetSec?: number): Promise<Blob>;
  compress(video: Blob, crf?: number): Promise<Blob>;
  convertFormat(input: Blob, format: OutputFormat): Promise<Blob>;
  changeSpeed(video: Blob, speed: number): Promise<Blob>;
  trim(video: Blob, startSec: number, endSec: number): Promise<Blob>;
  crop(video: Blob, opts: CropOptions): Promise<Blob>;
  resize(video: Blob, width: number, height: number): Promise<Blob>;
  extractFrame(video: Blob, atSec: number, format?: 'png' | 'jpg'): Promise<Blob>;
  /** 应用 delogo 滤镜去除水印（矩形区域），单次执行保留时序与音频 */
  applyDelogo(video: Blob, regions: { x: number; y: number; width: number; height: number }[]): Promise<Blob>;
  /** 将图片帧序列重新编码为视频（含可选音频流） */
  encodeFromFrames(frames: Blob[], fps: number, audio?: Blob): Promise<Blob>;
  /** T-2: 单张图片转视频片段（loop N 秒，30fps yuv420p） */
  imageToVideo(image: Blob, durationSec: number): Promise<Blob>;
  /** P2-9 写入媒体元数据（-metadata + -c copy，不重编码） */
  withMetadata(video: Blob, metadata: Record<string, string>): Promise<Blob>;
  /** SU-3: 字幕格式转换（当前支持 SRT → ASS），返回转换后字幕文本 */
  convertSubtitle(srt: string, toFormat: 'ass', style?: SubtitleStyle): Promise<string>;
  /** M-1: 音频淡入/淡出（afade 滤镜；durationSec 用于 fade-out 定位，缺省仅淡入） */
  fadeAudio(audio: Blob, opts: { fadeInSec: number; fadeOutSec: number; durationSec?: number }): Promise<Blob>;
}

// --- 字幕转录 ---

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  confidence?: number;
}

export interface IWhisperPort {
  load(): Promise<void>;
  isLoaded(): boolean;
  transcribe(audio: Blob | string, language?: string): Promise<TranscriptSegment[]>;
}

// --- 时间线 ---

export type TimelineClipType = 'video' | 'audio' | 'subtitle' | 'transition';

/**
 * 时间线片段的素材来源引用语义。
 *
 * 渲染时根据 kind + 引用字段解析为实际 Blob/URL：
 * - videoTask: 来自故事分镜的 VideoTask（refId = task.id）
 * - savedVideo: 资产库的 SavedVideo（refId = video.id）
 * - finalCut: 已有成片作为单段素材（refId = finalCut.id）
 * - savedImage: 资产库图片作为静态帧（refId = image.id）
 * - savedVoice: 资产库语音（refId = voice.id）
 * - imageAsVideo: T-2 远程图片转视频片段（imageUrl + durationSec）
 * - externalUrl: T-2 远程视频/音频 URL 直用（url + mimeType）
 *
 * inPointSec/outPointSec 用于源素材裁切（入/出点，秒）。
 */
export interface TimelineClipSource {
  kind: 'videoTask' | 'savedVideo' | 'finalCut' | 'savedImage' | 'savedVoice' | 'imageAsVideo' | 'externalUrl';
  refId?: string;
  storagePath?: string;
  inPointSec?: number;
  outPointSec?: number;
  /** T-2: imageAsVideo 专属 —— 图片 URL + 转视频时长（秒，默认 3） */
  imageUrl?: string;
  durationSec?: number;
  /** T-2: externalUrl 专属 —— 远程媒体 URL + MIME 类型 */
  url?: string;
  mimeType?: 'video/mp4' | 'audio/mpeg';
}

export interface TimelineClip {
  id: string;
  type: TimelineClipType;
  trackId: string;
  startTime: number;
  duration: number;
  /** 显示名称（旧字段，保留兼容） */
  source?: string;
  /** 素材来源引用（渲染时解析为 Blob） */
  sourceRef?: TimelineClipSource;
  text?: string;
  /** T-1：转场参数；旧字符串字段（'fade' 等）在渲染入口经 normalizeTransition 迁移 */
  transition?: TransitionOptions;
}

export interface TimelineTrack {
  id: string;
  type: 'video' | 'audio' | 'subtitle';
  clips: TimelineClip[];
  muted?: boolean;
  locked?: boolean;
}

export interface TimelineTransition {
  fromClipId: string;
  toClipId: string;
  type: TransitionType;
  duration: number;
}

export interface Timeline {
  id: string;
  storyId: string;
  duration: number;
  tracks: TimelineTrack[];
  transitions: TimelineTransition[];
  createdAt: number;
  updatedAt: number;
}
