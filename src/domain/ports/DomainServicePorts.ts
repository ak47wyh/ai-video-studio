/**
 * DomainServicePorts —— 业务编排 Port 抽象
 *
 * 把"业务层 Service"包装为 Port，使上层编排（如未来的工作流编辑器）
 * 可以替换或 mock 这些业务能力。
 *
 * 当前实现：直接对应 *Service.ts 类（同一进程内单例）。
 * 后续可实现：远程微服务适配器、第三方 SaaS 适配器。
 */

import type { StorySegment, Character, Background } from '../entities/models';
import type {
  MergeContext,
  SubtitleStyle,
  VideoClip,
  TransitionType,
  OutputFormat,
  BgmMixConfig,
  Timeline
} from './PostProcessPorts';
import type { SrtEntry } from '../services/SubtitleService';
export type { SrtEntry } from '../services/SubtitleService';
export type {
  MergeContext,
  SubtitleStyle,
  VideoClip,
  TransitionType,
  OutputFormat,
  BgmMixConfig,
  Timeline
} from './PostProcessPorts';

// ==========================================
// AI Agent
// ==========================================

export interface AgentContext {
  systemPrompt?: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  tools?: Array<{ name: string; description: string; schema: unknown }>;
}

export interface AgentResponse {
  content: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  usage?: { promptTokens: number; completionTokens: number };
}

export interface AgentResponseDelta {
  deltaContent?: string;
  deltaToolCall?: { id: string; name: string; argumentsDelta: string };
  finishReason?: 'stop' | 'tool_use' | 'length';
}

/**
 * AI Agent 端口。
 * 当前实现：AgentService。
 */
export interface IAgentPort {
  chat(context: AgentContext): Promise<AgentResponse>;
  /** 流式对话：返回 AsyncIterable<AgentResponseDelta> */
  chatStream(context: AgentContext): AsyncIterable<AgentResponseDelta>;
}

// ==========================================
// BGM 推荐
// ==========================================

export type BGMCategory =
  | 'cinematic-epic' | 'lighthearted' | 'suspense' | 'melancholic' | 'upbeat'
  | 'romantic' | 'mystery' | 'epic-action' | 'sci-fi-tech' | 'fantasy-mythic'
  | 'horror-dark' | 'documentary';

export interface BGMRecommendation {
  category: BGMCategory;
  prompt: string;
  emotion: string;
  tempo: 'slow' | 'medium' | 'fast';
  instruments: string[];
  useInstrumental: boolean;
  reasoning: string;
  duration: number;
  confidence: number;
}

/**
 * BGM 推荐端口。
 * 当前实现：BGMRecommendationService。
 * 后续可实现：RuleBasedBGMAdapter（基于规则 + 关键词，无 AI 成本）。
 */
export interface IBGMRecommendationPort {
  recommend(segmentContent: string, characterNames?: string[]): Promise<BGMRecommendation>;
  recommendSequence(segments: string[]): Promise<BGMRecommendation[]>;
  buildPrompt(category: BGMCategory, customEmotion?: string): string;
  getAllCategories(): BGMCategory[];
}

// ==========================================
// 运镜建议
// ==========================================

export type ShotType =
  | 'extreme-wide' | 'wide' | 'medium-wide' | 'medium' | 'medium-close'
  | 'close-up' | 'extreme-close' | 'over-shoulder' | 'point-of-view';

export type CameraMovement =
  | 'static' | 'pan' | 'tilt' | 'zoom-in' | 'zoom-out'
  | 'dolly' | 'tracking' | 'crane' | 'handheld';

/** 复用于 IPostProcessPort 的过渡类型别名 */
// Line 112 removed to avoid duplicate identifier - TransitionType is already exported above

export interface ShotSuggestion {
  shotType: ShotType;
  movement: CameraMovement;
  angle: 'low' | 'eye-level' | 'high' | 'overhead';
  durationSec: number;
  description: string;
  promptEnhancement: string;
}

/**
 * 运镜建议端口。
 * 当前实现：CinematographyService。
 * 后续可实现：TemplateShotAdapter（基于固定模板）。
 */
export interface ICinematographyPort {
  suggestShots(segment: StorySegment, characterNames: string[]): Promise<ShotSuggestion[]>;
  planStoryboard(segments: StorySegment[], characterNames: string[]): Promise<ShotSuggestion[][]>;
  enhancePromptWithShot(basePrompt: string, shot: ShotSuggestion): Promise<string>;
  getShotDescription(shot: ShotType, language: 'cn' | 'en'): string;
  getAllShotTypes(): ShotType[];
  getAllMovements(): CameraMovement[];
}

// ==========================================
// 自动剪辑
// ==========================================

export interface KeyframeInfo {
  timestamp: number;
  thumbnail: string;
  sceneScore: number;
  isSceneChange: boolean;
}

export interface CutSuggestion {
  startSec: number;
  endSec: number;
  reason: string;
  score: number;
}

/**
 * 自动剪辑端口。
 * 当前实现：AutoEditService（基于 FFmpeg 抽帧 + 简单差分）。
 * 后续可实现：SceneDetectionAdapter（基于深度学习）。
 */
export interface IAutoEditPort {
  detectKeyframes(video: Blob, sampleIntervalSec?: number): Promise<KeyframeInfo[]>;
  suggestCuts(video: Blob, targetDurationSec?: number): Promise<CutSuggestion[]>;
  autoTrim(video: Blob, motionThreshold?: number): Promise<Blob>;
}

// ==========================================
// 后期处理（Service 视角）
// ==========================================

export interface ExportOptions {
  outputFormat?: OutputFormat;
  includeSubtitles?: boolean;
  subtitleStyle?: SubtitleStyle;
  /** 目标分辨率 */
  width?: number;
  height?: number;
  /** 目标码率（kbps） */
  bitrate?: number;
}

/**
 * 后期处理端口。
 * 取代 PipelineService 对 PostProcessService 的具体依赖。
 *
 * 实现方契约：
 * - 所有方法均返回 Blob 或 string（不返回 URL，由调用方决定）
 * - 失败时抛出 Error（不静默）
 */
export interface IPostProcessPort {
  /** 合并视频与音轨 */
  mergeVideoAudio(ctx: MergeContext): Promise<Blob>;
  /** 拼接多个视频片段 */
  concatClips(clips: VideoClip[]): Promise<Blob>;
  /** 烧录字幕到视频 */
  burnSubtitles(video: Blob, srt: string, style?: SubtitleStyle): Promise<Blob>;
  /** 抽取单帧 */
  extractFrame(video: Blob, atSec: number, format?: 'png' | 'jpg'): Promise<Blob>;
  /** 混音（人声 + BGM） */
  mixBgm(voice: Blob, bgm: Blob, config: BgmMixConfig): Promise<Blob>;
  /** 应用转场（offsetSec 可选：前一段时长 - 转场时长，默认由实现按内部规则推导） */
  applyTransition(clip1: Blob, clip2: Blob, transition: TransitionType, duration: number, offsetSec?: number): Promise<Blob>;
  /** 编码最终视频（按 export options 合成所有要素） */
  exportFinalVideo(storyId: string, options: ExportOptions): Promise<Blob>;
  /** 检查 FFmpeg 是否已加载 */
  isFFmpegLoaded(): boolean;
  /** 确保 FFmpeg 已加载 */
  ensureLoaded(): Promise<void>;
}

// ==========================================
// 字幕服务（Service 视角）
// ==========================================

/**
 * 字幕服务端口。
 * 取代 PipelineService 对 SubtitleService 的具体依赖。
 */
export interface ISubtitlePort {
  /** 从音频和段落生成 SRT 字幕 */
  generateSrt(audio: Blob | string, segments: StorySegment[], language?: string): Promise<string>;
  /** 翻译 SRT 到目标语言 */
  translate(srt: string, targetLanguage: string): Promise<string>;
  /** 解析 SRT 为条目数组 */
  parseSrt(srt: string): SrtEntry[];
  /** 格式化 SRT 条目为字符串 */
  formatSrt(entries: SrtEntry[]): string;
}

// ==========================================
// 资产导出 / 导入
// ==========================================

/**
 * 资产备份 / 恢复端口。
 * 后续可实现：JSON 导出、ZIP 压缩、加密备份。
 */
export interface IAssetExportPort {
  exportSpaceAsJson(spaceId: string): Promise<Blob>;
  exportAllAsJson(): Promise<Blob>;
  importFromJson(blob: Blob): Promise<{ spaceId: string; imported: number }>;
}

// ==========================================
// 实体与仓储的跨域组合（便于 Service 间共享）
// ==========================================

export interface StorySpaceContext {
  story: import('../entities/models').Story;
  segments: StorySegment[];
  characters: Character[];
  backgrounds: Background[];
  timelines: Timeline[];
}
