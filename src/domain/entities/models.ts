import type { PlatformId } from './platform';

export interface StorySpace {
  id: string;
  name: string;
  description: string;
  createdAt: number;
}

export interface Character {
  id: string;
  spaceId: string;
  name: string;
  appearancePrompt: string;
  personalityPrompt: string;
  characterBackground: string;
  referenceImageUrl?: string;
  voiceId?: string;
  createdAt: number;
  /** 参考图 OPFS 存储路径（Phase 2-C 持久化，referenceImageUrl 过期/体积大时优化） */
  referenceImageStoragePath?: string;
}

export interface Background {
  id: string;
  spaceId: string;
  name: string;
  environmentPrompt: string;
  referenceImageUrl?: string;
  createdAt: number;
  /** 参考图 OPFS 存储路径（Phase 2-C 持久化） */
  referenceImageStoragePath?: string;
}

export type StoryStatus = 'DRAFT' | 'SPLIT';

export interface Story {
  id: string;
  spaceId: string;
  title: string;
  originalText: string;
  status: StoryStatus;
  createdAt: number;
}

export interface StorySegment {
  id: string;
  storyId: string;
  sequenceOrder: number;
  content: string;
  mentionedCharacters: string[];
  selectedBackgroundId?: string;
  bgmAudioUrl?: string;
  bgmPrompt?: string;
  bgmLyrics?: string;
  bgmIsInstrumental?: boolean;
  actionContent?: string;
  firstFrameImage?: string;
  /** 旁白音频的 OPFS 存储路径（Phase 2-A 持久化） */
  narrationAudioStoragePath?: string;
  /** BGM 音频的 OPFS 存储路径（Phase 2-B 持久化，bgmAudioUrl 过期时降级） */
  bgmStoragePath?: string;
  /** 分镜视频 URL（P0-2 回写：VideoLab 生成物直接绑定到分镜） */
  videoUrl?: string;
}

export type VideoTaskStatus = 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED';

export type VideoModel = 'MiniMax-Hailuo-2.3' | 'MiniMax-Hailuo-2.3-Fast' | 'MiniMax-Hailuo-02' | 'T2V-01-Director' | 'T2V-01' | 'I2V-01-Director' | 'I2V-01-live' | 'I2V-01' | 'S2V-01';
export type VideoResolution = '512P' | '720P' | '768P' | '1080P';
export type VideoGenerationMode = 't2v' | 'i2v' | 'fl2v' | 's2v';

export interface VideoTask {
  id: string;
  segmentId: string;
  /** 目标平台 ID（任务创建时的激活平台，用于历史溯源与跨平台切换提示） */
  targetPlatform: PlatformId;
  status: VideoTaskStatus;
  videoUrl?: string;
  errorMessage?: string;
  externalTaskId?: string;
  createdAt: number;
  updatedAt?: number;
  mode?: VideoGenerationMode;
  model?: VideoModel;
  resolution?: VideoResolution;
  duration?: 6 | 10;
  fileId?: string;
  videoWidth?: number;
  videoHeight?: number;
  promptOptimizer?: boolean;
  firstFrameImage?: string;
  lastFrameImage?: string;
  /** 生成视频的 OPFS 存储路径（Phase 2-B 持久化，videoUrl 过期时降级） */
  videoStoragePath?: string;
}

// --- Final Cut & Pipeline (v7) ---

export type PipelineStatus =
  | 'idle'
  | 'splitting'
  | 'generating_images'
  | 'generating_audio'
  | 'generating_bgm'
  | 'generating_videos'
  | 'post_processing'
  | 'generating_srt'
  | 'burning_subtitles'
  | 'complete'
  | 'failed';

export interface PipelineStep {
  name: PipelineStatus;
  status: 'pending' | 'running' | 'done' | 'failed';
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

export interface PipelineTask {
  id: string;
  storyId: string;
  status: PipelineStatus;
  progress: number;
  currentStep: string;
  steps: PipelineStep[];
  finalVideoUrl?: string;
  createdAt: number;
  completedAt?: number;
  error?: string;
}

export interface FinalCut {
  id: string;
  storyId: string;
  pipelineTaskId?: string;
  videoBlob: Blob;
  thumbnailUrl?: string;
  duration: number;
  size: number;
  hasSubtitles: boolean;
  srtContent?: string;
  createdAt: number;
  /** 缩略图 OPFS 存储路径（Phase 2-C 持久化，thumbnailUrl 失效时降级） */
  thumbnailStoragePath?: string;
  /** 最终成片 OPFS 存储路径（Phase 2-C 持久化，videoBlob 庞大时可消除 Dexie 压力） */
  videoStoragePath?: string;
  // ===== M2.4 统一成片路径（EVOLUTION_DESIGN.md §6.4）=====
  /** 成片来源（区分 pipeline / timeline / manual 三种成片路径） */
  source?: FinalCutSource;
  /** 来源时间线 ID（source='timeline' 时有值） */
  timelineId?: string;
  /** 来源平台（记录成片由哪个 AI 平台生成，便于成本统计） */
  sourcePlatform?: string;
}

/** 成片来源类型 */
export type FinalCutSource = 'pipeline' | 'timeline' | 'manual';

// --- 视频风格预设（AI 故事成片） ---

/** 画面风格预设 */
export type VideoStyle =
  | 'cinematic'     // 电影质感
  | 'anime'         // 日系动漫
  | 'watercolor'    // 水彩绘本
  | 'gufeng'        // 古风国潮
  | '3dcartoon'     // 3D 卡通
  | 'scifi'         // 科幻未来
  | 'documentary'   // 纪录片
  | 'fairy_tale';   // 梦幻童话

// --- Asset Library (v8) ---

export type SavedImageSource = 'lab' | 'pipeline' | 'character' | 'background';
export type SavedVoiceSource = 'lab' | 'clone' | 'pipeline';
export type PromptCategory = 'image' | 'voice' | 'story' | 'scene' | 'narration' | 'other';
export type SavedPromptSource = 'lab' | 'pipeline' | 'manual';
export type SavedVideoSource = 'lab' | 'pipeline' | 'editor' | 'import';

export interface SavedImage {
  id: string;
  spaceId: string;
  name: string;
  prompt: string;
  model: string;
  aspectRatio: string;
  blobKey: string;
  thumbnailBlobKey?: string;
  tags: string[];
  sourceType: SavedImageSource;
  sourceId?: string;
  createdAt: number;
}

export interface SavedVoice {
  id: string;
  spaceId: string;
  name: string;
  voiceId: string;
  model: string;
  speed: number;
  sampleText: string;
  audioBlobKey: string;
  tags: string[];
  sourceType: SavedVoiceSource;
  sourceId?: string;
  createdAt: number;
}

export interface SavedPrompt {
  id: string;
  spaceId: string;
  name: string;
  content: string;
  category: PromptCategory;
  tags: string[];
  sourceType: SavedPromptSource;
  createdAt: number;
}

/**
 * 已保存视频资产（剪辑渲染产物 / 用户导入视频统一入口）。
 *
 * 二进制走 OPFS（video/ 目录），元数据进 Dexie savedVideos 表。
 * blobKey 指向 OPFS 路径，如 `video/abc123.mp4`。
 */
export interface SavedVideo {
  id: string;
  spaceId: string;
  name: string;
  /** 视频时长（秒） */
  durationSec: number;
  width?: number;
  height?: number;
  mimeType: string;
  /** OPFS 存储路径 */
  blobKey: string;
  /** 缩略图 OPFS 路径（可选） */
  thumbnailBlobKey?: string;
  tags: string[];
  sourceType: SavedVideoSource;
  sourceId?: string;
  createdAt: number;
}

// ==========================================
// 3D 生成相关
// ==========================================

export type ThreeDPlatformId = 'volcengine-seed3d' | 'volcengine-yingmou' | 'volcengine-shumei';
export type ThreeDTaskStatusType = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type ThreeDOutputFormat = 'glb' | 'gltf' | 'fbx' | 'obj';

export interface ThreeDSubmitParams {
  /** 文本提示（影眸支持英文文本→3D） */
  prompt?: string;
  /** 输入图片 URL 列表（单图或多图） */
  imageUrls?: string[];
  /** 模型端点 ID（由 PlatformRouter 根据 platform3d 配置注入） */
  modelEndpointId?: string;
  /** Seed3D 特有：是否启用两步生成 */
  coarseToFine?: boolean;
  /** Seed3D 特有：是否输出完整 PBR 贴图 */
  pbrOutput?: boolean;
}

export interface ThreeDTaskResult {
  taskId: string;
  status: ThreeDTaskStatusType;
  platform: ThreeDPlatformId;
}

export interface ThreeDTaskStatus {
  taskId: string;
  status: ThreeDTaskStatusType;
  /** 生成成功时的模型文件 URL */
  modelUrl?: string;
  /** 生成成功时的预览图 URL */
  previewImageUrl?: string;
  /** 输出格式 */
  format?: ThreeDOutputFormat;
  /** 错误信息 */
  error?: { code: string; message: string };
  createdAt?: number;
  completedAt?: number;
}

export interface ThreeDTaskListResult {
  total: number;
  items: ThreeDTaskStatus[];
}

// ==========================================
// 上下文缓存相关
// ==========================================

export interface CacheCreateParams {
  /** 模型端点 ID */
  model: string;
  /** 待缓存的消息数组 */
  messages: CacheMessage[];
  /** 缓存有效期（秒），最大 604800（7 天） */
  ttl?: number;
}

export interface CacheMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CacheResult {
  cacheId: string;
  model: string;
  createdAt: number;
  expiresAt: number;
}

export interface CacheChatParams {
  model: string;
  cacheId: string;
  messages: CacheMessage[];
  stream?: boolean;
}

// ==========================================
// 模型响应相关
// ==========================================

export interface ResponseCreateParams {
  model: string;
  input: string | ResponseInputMessage[];
  stream?: boolean;
  previousResponseId?: string;
  caching?: { type: 'enabled' };
  store?: boolean;
  thinking?: { type: 'enabled'; budgetTokens: number };
  temperature?: number;
  expireAt?: number;
}

export interface ResponseInputMessage {
  role: 'user' | 'system' | 'developer';
  content: string;
}

export interface ResponseResult {
  id: string;
  model: string;
  output: ResponseOutputItem[];
  status: string;
  usage?: TokenUsageInfo;
  createdAt: number;
  expireAt?: number;
}

export interface ResponseOutputItem {
  type: string;
  role?: string;
  content?: string;
  status?: string;
}

export interface ResponseStreamChunk {
  type: string;
  delta?: string;
  output?: ResponseOutputItem;
  usage?: TokenUsageInfo;
}

export interface ResponseContextResult {
  responseId: string;
  context: string;
}

export interface TokenUsageInfo {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

// ==========================================
// 通用
// ==========================================

export interface TaskListFilter {
  pageNum?: number;
  pageSize?: number;
  status?: string;
}

// ==========================================
// 文件存储 (v10) — OPFS 统一文件管理
// ==========================================

export type GeneratedFileType = 'image' | 'audio' | 'video' | 'other';

export interface GeneratedFile {
  id: string;
  /** 所属工作空间 */
  spaceId: string;
  /** 文件分类 */
  fileType: GeneratedFileType;
  /** MIME 类型, e.g. 'image/png', 'audio/mpeg', 'video/mp4' */
  mimeType: string;
  /** 可读文件名 */
  fileName: string;
  /** 文件大小（字节） */
  fileSize: number;
  /** OPFS 相对路径, e.g. 'images/abc123.png' */
  storagePath: string;
  /** 来源 URL（若从远程下载） */
  originalUrl?: string;
  /** 来源平台: 'minimax' | 'volcengine' | ... */
  sourcePlatform?: string;
  /** 关联实体 ID（segmentId, characterId 等） */
  sourceEntityId?: string;
  /** 关联实体类型: 'video_task' | 'saved_image' | ... */
  sourceEntityType?: string;
  tags: string[];
  /** 最近访问时间（LRU 淘汰用） */
  lastAccessedAt: number;
  createdAt: number;
  /** 压缩前体积（仅压缩替换时记录，便于展示压缩效果） */
  originalSize?: number;
  /** 压缩时间戳 */
  compressedAt?: number;
  /** 压缩率（0-1，如 0.21 表示压缩后为原图的 21%） */
  compressionRatio?: number;
}
