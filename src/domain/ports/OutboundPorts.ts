import type { Character, Background, Story, StorySegment, StorySpace, VideoTask, VideoTaskStatus, FinalCut } from '../entities/models';

// --- Repositories ---

export interface IStorySpaceRepository {
  save(space: StorySpace): Promise<void>;
  findById(id: string): Promise<StorySpace | null>;
  findAll(): Promise<StorySpace[]>;
  delete(id: string): Promise<void>;
}

export interface ICharacterRepository {
  save(character: Character): Promise<void>;
  findById(id: string): Promise<Character | null>;
  findAll(): Promise<Character[]>;
  findBySpaceId(spaceId: string): Promise<Character[]>;
  delete(id: string): Promise<void>;
}

export interface IBackgroundRepository {
  save(background: Background): Promise<void>;
  findById(id: string): Promise<Background | null>;
  findAll(): Promise<Background[]>;
  findBySpaceId(spaceId: string): Promise<Background[]>;
  delete(id: string): Promise<void>;
}

export interface IStoryRepository {
  save(story: Story): Promise<void>;
  findById(id: string): Promise<Story | null>;
  findAll(): Promise<Story[]>;
  findBySpaceId(spaceId: string): Promise<Story[]>;
  delete(id: string): Promise<void>;
}

export interface IStorySegmentRepository {
  save(segment: StorySegment): Promise<void>;
  findById(id: string): Promise<StorySegment | null>;
  findByStoryId(storyId: string): Promise<StorySegment[]>;
  deleteByStoryId(storyId: string): Promise<void>;
}

export interface IVideoTaskRepository {
  save(task: VideoTask): Promise<void>;
  findById(taskId: string): Promise<VideoTask | null>;
  findBySegmentId(segmentId: string): Promise<VideoTask[]>;
  findLatestBySegmentId(segmentId: string): Promise<VideoTask | null>;
  findByStatuses(statuses: VideoTaskStatus[]): Promise<VideoTask[]>;
  deleteBySegmentIds(segmentIds: string[]): Promise<void>;
  updateStatus(taskId: string, status: VideoTaskStatus, videoUrl?: string, error?: string): Promise<void>;
}

export interface IFinalCutRepository {
  save(cut: FinalCut): Promise<void>;
  findById(id: string): Promise<FinalCut | undefined>;
  findByStoryIds(storyIds: string[]): Promise<FinalCut[]>;
  delete(id: string): Promise<void>;
}

// --- Video Generation ---
// 类型统一定义在 entities/models.ts，此处 re-export 保持向后兼容
export type { VideoModel, VideoResolution, VideoGenerationMode } from '../entities/models';
import type { VideoModel, VideoResolution, VideoGenerationMode } from '../entities/models';

export interface VideoSubjectReference {
  type: string;
  image: string[];
}

export interface VideoPromptContext {
  mode?: VideoGenerationMode;
  model?: VideoModel;
  prompt: string;
  promptOptimizer?: boolean;
  fastPretreatment?: boolean;
  duration?: 6 | 10;
  resolution?: VideoResolution;
  callbackUrl?: string;
  firstFrameImage?: string;
  lastFrameImage?: string;
  subjectReference?: VideoSubjectReference[];
  characterVoiceIds?: Record<string, string>;
  bgmAudioUrl?: string;
  actionContent?: string;
  characters?: import('../entities/models').Character[];
  background?: import('../entities/models').Background;
  videoStyle?: string;
  aigcWatermark?: boolean;
}

export interface VideoTaskResult {
  status: VideoTaskStatus;
  videoUrl?: string;
  videoWidth?: number;
  videoHeight?: number;
  fileId?: string;
  errorMessage?: string;
}

export interface VideoDownloadResult {
  downloadUrl: string;
  filename: string;
  bytes: number;
  createdAt: number;
}

export interface IVideoGeneratorPort {
  submitVideoTask(context: VideoPromptContext): Promise<string>;
  queryTaskStatus(externalTaskId: string): Promise<VideoTaskResult>;
  downloadVideo(fileId: string): Promise<VideoDownloadResult>;
}

export interface IVideoAgentCapable extends IVideoGeneratorPort {
  createAgentTask(context: VideoAgentContext): Promise<string>;
  queryAgentTask(taskId: string): Promise<VideoAgentTaskResult>;
}

// --- Video Agent ---

export interface VideoAgentTextInput {
  value: string;
}

export interface VideoAgentMediaInput {
  value: string;
}

export interface VideoAgentContext {
  templateId: string;
  textInputs?: VideoAgentTextInput[];
  mediaInputs?: VideoAgentMediaInput[];
  callbackUrl?: string;
}

export interface VideoAgentTaskResult {
  status: 'Preparing' | 'Processing' | 'Success' | 'Fail';
  videoUrl?: string;
  errorMessage?: string;
}

export interface SegmentDraft {
  content: string;
  mentionedCharacters: string[];
  suggestedBackgroundName?: string;
}

export interface ITextSplitterPort {
  splitStoryToSegments(text: string, knownCharacterNames: string[]): Promise<SegmentDraft[]>;
}

// --- Story Breakdown (One-click decompose) ---

export interface CharacterDraft {
  name: string;
  appearancePrompt: string;
  personalityPrompt: string;
  characterBackground: string;
  referenceImageUrl?: string;
  voiceId?: string;
}

export interface BackgroundDraft {
  name: string;
  environmentPrompt: string;
  referenceImageUrl?: string;
}

export interface BreakdownSegmentDraft {
  content: string;
  mentionedCharacterNames: string[];
  suggestedBackgroundName: string;
}

export interface StoryBreakdownResult {
  characters: CharacterDraft[];
  backgrounds: BackgroundDraft[];
  segments: BreakdownSegmentDraft[];
}

export interface IStoryBreakdownPort {
  breakdownStory(text: string): Promise<StoryBreakdownResult>;
}

// --- Image Generation ---

export type ImageModel = 'image-01' | 'image-01-live';
export type ImageResponseFormat = 'url' | 'base64';
export type ImageAspectRatio = '1:1' | '16:9' | '4:3' | '3:2' | '2:3' | '3:4' | '9:16' | '21:9';

export interface ImageSubjectReference {
  type: string;
  image_file: string;
}

export interface ImageStyle {
  [key: string]: string;
}

export interface ImageGenerationContext {
  prompt: string;
  model?: ImageModel;
  aspectRatio?: ImageAspectRatio;
  width?: number;
  height?: number;
  responseFormat?: ImageResponseFormat;
  seed?: number;
  n?: number;
  promptOptimizer?: boolean;
  aigcWatermark?: boolean;
  subjectReference?: ImageSubjectReference[];
  style?: ImageStyle;
  subjectReferenceUrl?: string;
}

export interface ImageGenerationResult {
  imageDataUri?: string;
  imageUrls?: string[];
  metadata?: {
    successCount: number;
    failedCount: number;
  };
}

export interface IImageGeneratorPort {
  generateImage(context: ImageGenerationContext): Promise<ImageGenerationResult>;
}

// --- Voice ---

export type T2ASyncModel =
  // MiniMax 系列
  | 'speech-2.8-hd' | 'speech-2.8-turbo' | 'speech-02-hd' | 'speech-02-turbo' | 'speech-01-hd' | 'speech-01-turbo'
  // 火山引擎豆包 TTS 系列
  | 'doubao-tts-base' | 'doubao-tts-pro' | 'doubao-tts-pro-max';

export interface VoiceModify {
  pitch?: number;
  intensity?: number;
  timbre?: number;
  sound_effects?: string;
}

export interface PronunciationDict {
  tone: string[];
}

export interface VoiceSubtitle {
  text: string;
  startTime: number;
  endTime: number;
}

export interface VoiceCloneContext {
  fileId: string;
  voiceId: string;
  text?: string;
  model?: string;
  promptAudioFileId?: string;
  promptText?: string;
  languageBoost?: string;
  needNoiseReduction?: boolean;
  needVolumeNormalization?: boolean;
  aigcWatermark?: boolean;
}

export interface VoiceCloneResult {
  voiceId: string;
  previewAudioUrl?: string;
  previewAudioHex?: string;
  inputSensitive?: boolean;
  inputSensitiveType?: number;
  usageCharacters?: number;
  audioLength?: number;
}

export interface T2AAsyncContext {
  text?: string;
  textFileId?: string;
  voiceId: string;
  model?: string;
  speed?: number;
  vol?: number;
  pitch?: number;
  audioFormat?: string;
  sampleRate?: number;
  channel?: number;
  languageBoost?: string;
  pronunciationDict?: PronunciationDict;
  voiceModify?: VoiceModify;
  aigcWatermark?: boolean;
}

export interface T2AAsyncResult {
  taskId: string;
  taskToken?: string;
  fileId?: string;
  usageCharacters?: number;
}

export interface T2AAsyncStatus {
  status: 'processing' | 'success' | 'failed' | 'expired';
  fileId?: string;
  audioUrl?: string;
  audioDuration?: number;
  errorMessage?: string;
}

export interface T2ASyncContext {
  model?: T2ASyncModel;
  text: string;
  voiceId: string;
  speed?: number;
  volume?: number;
  pitch?: number;
  emotion?: string;
  audioFormat?: string;
  sampleRate?: number;
  stream?: boolean;
  outputFormat?: 'hex' | 'url';
  languageBoost?: string;
  aigcWatermark?: boolean;
  pronunciationDict?: PronunciationDict;
  voiceModify?: VoiceModify;
  subtitleEnable?: boolean;
  subtitleType?: 'sentence' | 'word' | 'word_streaming';
  channel?: number;
}

export interface T2ASyncResult {
  audioHex?: string;
  audioUrl?: string;
  audioLength?: number;
  audioSize?: number;
  usageCharacters?: number;
  subtitles?: VoiceSubtitle[];
}

export interface VoiceDesignResult {
  voiceId: string;
  trialAudioHex: string;
}

// --- 声音转换 (Voice Conversion) ---

/**
 * 声音转换上下文。
 * 与声音克隆不同：克隆是「采样→建模→复用」，转换是「已有音频→实时换音色」。
 * 适用于配音替换、变声等场景，输入为源音频，输出为目标音色的音频。
 */
export interface VoiceConversionContext {
  /** 源音频（任意浏览器可解码格式：mp3/wav/m4a 等） */
  audio: Blob | string;
  /** 目标音色 ID（系统音色或已克隆音色 S_ 开头） */
  targetVoiceType: string;
  /** 输出音频编码格式，默认 mp3 */
  outputEncoding?: 'wav' | 'pcm' | 'mp3' | 'ogg_opus';
  /** 输出采样率，默认 24000 */
  outputRate?: 16000 | 24000 | 32000 | 48000;
  /** 音调调整 [0.1-3.0]，默认 1.0 */
  pitchRatio?: number;
  /** 音量调整 [0.1-3.0]，默认 1.0 */
  volumeRatio?: number;
}

/** 声音转换结果：返回可直接播放/下载的 Blob URL */
export interface VoiceConversionResult {
  /** 转换后音频的 Blob URL（可直接用于 <audio> 播放） */
  audioUrl: string;
  /** 音频字节大小 */
  audioSize: number;
  /** 输出音频格式 */
  encoding: string;
}

export type VoiceType = 'system' | 'voice_cloning' | 'voice_generation' | 'all';

export interface VoiceInfo {
  voiceId: string;
  description: string;
  voiceName: string;
  createdTime?: string;
  type: 'system' | 'voice_cloning' | 'voice_generation';
  isActive?: boolean;
  usedByCharacters?: string[];
}

export interface VoiceListResult {
  systemVoices?: VoiceInfo[];
  clonedVoices?: VoiceInfo[];
  designedVoices?: VoiceInfo[];
}

export interface FileUploadResult {
  fileId: string;
}

export interface T2AStreamCallbacks {
  onAudioChunk: (chunk: ArrayBuffer) => void;
  onComplete?: (totalLength?: number) => void;
  onError?: (error: Error) => void;
  onSubtitle?: (subtitle: VoiceSubtitle) => void;
}

export interface T2AStreamHandle {
  close: () => void;
  sendText?: (text: string) => void;
  finish?: () => void;
}

export interface IVoicePort {
  /**
   * 该平台支持的能力子集。调用方应在使用相关方法前检查，
   * 不支持的能力直接抛 CapabilityNotSupportedError 而不是抛 NotImplementedError。
   */
  readonly voiceCapabilities: VoiceCapabilities;

  uploadFile(file: File, purpose: 'voice_clone' | 'prompt_audio' | 't2a_async_input'): Promise<FileUploadResult>;
  createT2ATask(context: T2AAsyncContext): Promise<T2AAsyncResult>;
  queryT2ATask(taskId: string): Promise<T2AAsyncStatus>;
  getFileUrl(fileId: string): string;
  /** 带 Bearer 认证下载音频文件，返回 Blob URL（可直接用于 <audio> 播放和下载） */
  fetchAudioAsBlobUrl(audioUrl: string): Promise<string>;
  synthesizeSpeechSync(context: T2ASyncContext): Promise<T2ASyncResult>;
  getAvailableVoices(voiceType: VoiceType): Promise<VoiceListResult>;
}

export interface IVoiceCloneCapable extends IVoicePort {
  cloneVoice(context: VoiceCloneContext): Promise<VoiceCloneResult>;
}

export interface IVoiceDesignCapable extends IVoicePort {
  designVoice(prompt: string, previewText: string, voiceId?: string, aigcWatermark?: boolean): Promise<VoiceDesignResult>;
  deleteVoice(voiceType: 'voice_cloning' | 'voice_generation', voiceId: string): Promise<void>;
}

export interface IVoiceStreamCapable extends IVoicePort {
  synthesizeSpeechStream(context: T2ASyncContext, callbacks: T2AStreamCallbacks): T2AStreamHandle;
}

export interface IVoiceConversionCapable extends IVoicePort {
  convertVoice(context: VoiceConversionContext): Promise<VoiceConversionResult>;
}

/**
 * IVoicePort 子能力声明（接口隔离原则）。
 * 调用方（如 VoiceService）应在使用某方法前检查 supportsClone / supportsDesign。
 * 不支持的能力由适配器内部抛 CapabilityNotSupportedError 而非返回 undefined。
 */
export interface VoiceCapabilities {
  /** 是否支持声音克隆（上传样本 → 复刻音色） */
  supportsClone: boolean;
  /** 是否支持声音设计（文本描述 → 生成音色） */
  supportsDesign: boolean;
  /** 是否支持删除已创建的音色 */
  supportsDelete: boolean;
  /** 是否支持流式 WebSocket 合成 */
  supportsStream: boolean;
  /** 是否支持声音转换（已有音频 → 换音色） */
  supportsConversion: boolean;
}

/**
 * 语音子能力不支持错误（re-export）。
 *
 * 原本此处定义了独立的 `CapabilityNotSupportedError extends Error`，
 * 与 `errors/UnsupportedCapabilityError` 存在重复定义（Architecture_Refactor_Design §9.1）。
 * 现统一到 `errors/` 目录：
 *   - `UnsupportedCapabilityError` 处理"整个能力域不支持"
 *   - `VoiceSubCapabilityNotSupportedError` 处理"语音子能力不支持"（继承 DomainError）
 * 两者 `code === 'UNSUPPORTED_CAPABILITY'`，UI 可按 code 统一分派。
 *
 * 保留 `CapabilityNotSupportedError` 命名以兼容既有 Adapter 抛出点。
 */
export { VoiceSubCapabilityNotSupportedError as CapabilityNotSupportedError } from '../errors/VoiceSubCapabilityNotSupportedError';

// --- Music Generation ---

export type MusicModel = 'music-2.6' | 'music-2.6-free' | 'music-cover' | 'music-cover-free';

export interface MusicGenerationContext {
  prompt: string;
  lyrics?: string;
  isInstrumental?: boolean;
  lyricsOptimizer?: boolean;
  model?: MusicModel;
  outputFormat?: 'url' | 'hex';
  stream?: boolean;
  aigcWatermark?: boolean;
  audioSetting?: {
    sampleRate?: number;
    bitrate?: number;
    format?: string;
  };
  audioUrl?: string;
  audioBase64?: string;
  coverFeatureId?: string;
}

export interface MusicGenerationResult {
  audioUrl?: string;
  audioHex?: string;
  duration?: number;
  sampleRate?: number;
  bitrate?: number;
  channel?: number;
  size?: number;
  status?: number;
}

export interface LyricsGenerationContext {
  mode: 'write_full_song' | 'edit';
  prompt?: string;
  lyrics?: string;
  title?: string;
}

export interface LyricsGenerationResult {
  songTitle: string;
  styleTags: string;
  lyrics: string;
}

export interface CoverPreprocessResult {
  coverFeatureId: string;
  formattedLyrics: string;
  structureResult: string;
  audioDuration: number;
}

export interface IMusicPort {
  generateMusic(context: MusicGenerationContext): Promise<MusicGenerationResult>;
  generateLyrics(context: LyricsGenerationContext): Promise<LyricsGenerationResult>;
  preprocessCover(audioUrl: string): Promise<CoverPreprocessResult>;
}

// --- Text Generation ---

/**
 * 文本模型 ID。
 *
 * 设计决策：多平台化后，各平台（MiniMax/VolcArk/Wan/Zhipu/Hunyuan 等）模型 ID 各异，
 * 封闭联合类型会迫使每加一个平台模型就改 Port 类型，造成 6+ Service 集中报错。
 * 因此放宽为 `string`，由 PlatformModelRegistry 在运行时按平台解析具体模型 ID。
 *
 * MiniMax 平台默认值仍由 PlatformModelRegistry 提供（M3/M2.7/M2.5 系列）。
 */
export type TextModel = string;

export interface TextGenerationCacheControl {
  type: 'ephemeral';
}

export interface TextGenerationSystemBlock {
  type: 'text';
  text: string;
  cache_control?: TextGenerationCacheControl;
}

export type TextContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'url'; url: string } | { type: 'base64'; media_type: string; data: string } };

export interface TextGenerationMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | TextContentBlock[];
  cache_control?: TextGenerationCacheControl;
}

export interface TextStreamCallbacks {
  onTextDelta: (text: string) => void;
  onThinkingDelta: (thinking: string) => void;
  onComplete: (result: TextGenerationResult) => void;
  onError: (error: Error) => void;
}

export interface TextGenerationContext {
  model?: TextModel;
  messages: TextGenerationMessage[];
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stream?: boolean;
  thinking?: {
    type: 'adaptive' | 'disabled';
    budget_tokens?: number;
  };
  serviceTier?: 'standard' | 'priority';
  tools?: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
  useAnthropicEndpoint?: boolean;
  systemBlocks?: TextGenerationSystemBlock[];
}

export interface TextGenerationResult {
  content: string;
  thinking?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    cachedTokens?: number;
    cacheCreationTokens?: number;
  };
}

export interface RefineResult {
  content: string;
  cachedTokens?: number;
  totalTokens?: number;
}

export interface ITextGenerationPort {
  chatCompletion(context: TextGenerationContext): Promise<TextGenerationResult>;
  chatCompletionStream(context: TextGenerationContext, callbacks: TextStreamCallbacks): AbortController;
}

// --- Model Management ---

export interface ModelInfo {
  id: string;
  createdAt: string;
  displayName: string;
  type: string;
}

export interface ModelListResult {
  models: ModelInfo[];
  firstId?: string;
  lastId?: string;
  hasMore: boolean;
}

export interface IModelManagementPort {
  listModels(limit?: number, afterId?: string): Promise<ModelListResult>;
  retrieveModel(modelId: string): Promise<ModelInfo>;
}
