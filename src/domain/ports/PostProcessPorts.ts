// --- FFmpeg 后期处理 ---

export type TransitionType = 'fade' | 'fadeblack' | 'fadewhite' | 'wipeleft' | 'wiperight' | 'slideup' | 'slidedown' | 'circlecrop' | 'rectcrop' | 'distance';
export type OutputFormat = 'mp4' | 'webm' | 'mov';

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
  fontName?: string;
  fontSize?: number;
  primaryColor?: string;
  outlineColor?: string;
  outlineWidth?: number;
  position?: 'top' | 'middle' | 'bottom';
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
  applyTransition(clip1: Blob, clip2: Blob, transition: TransitionType, duration: number, offsetSec?: number): Promise<Blob>;
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
 * 渲染时根据 kind + refId 解析为实际 Blob/URL：
 * - videoTask: 来自故事分镜的 VideoTask（refId = task.id）
 * - savedVideo: 资产库的 SavedVideo（refId = video.id）
 * - finalCut: 已有成片作为单段素材（refId = finalCut.id）
 * - savedImage: 资产库图片作为静态帧（refId = image.id）
 * - savedVoice: 资产库语音（refId = voice.id）
 *
 * inPointSec/outPointSec 用于源素材裁切（入/出点，秒）。
 */
export interface TimelineClipSource {
  kind: 'videoTask' | 'savedVideo' | 'finalCut' | 'savedImage' | 'savedVoice';
  refId: string;
  storagePath?: string;
  inPointSec?: number;
  outPointSec?: number;
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
  transition?: TransitionType | 'none';
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
