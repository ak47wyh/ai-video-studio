/**
 * PlatformPorts —— 平台相关 Port 抽象
 *
 * 把"读取平台能力"与"读写 API 配置"从具体实现中解耦，
 * 使 Domain Core / Service / UI 都可以通过接口依赖，
 * 而不是直接 import ApiConfigStore 类或 platformCapabilities 常量。
 *
 * 关键约束：
 * - 实现方必须保证：API Key、Token 永不写入 console / 日志
 * - Token 不可明文存入 localStorage（应至少做一次可逆编码或加密）
 * - 切换 activePlatform 时通过 onPlatformChange 通知订阅者
 */

// ==========================================
// 平台能力
// ==========================================

export type PlatformCapability =
  | 'video'        // 视频生成（T2V / I2V）
  | 'videoFl2v'    // 视频首尾帧
  | 'videoS2v'     // 视频参考生
  | 'image'        // 图片生成
  | 'text'         // 文本生成
  | 'voice'        // 语音合成
  | 'music'        // 音乐生成
  | 'threeD'       // 3D 模型
  | 'cache'        // 上下文缓存
  | 'modelResponse'; // Responses API

/**
 * 平台能力元数据端口。
 * 取代 platformCapabilities.ts 中的静态常量导出，
 * 使 UI 层、Service 层、测试代码统一通过此 Port 查询。
 */
export interface IPlatformCapabilitiesPort {
  getMeta(platform: PlatformId): PlatformMeta;
  hasCapability(platform: PlatformId, capability: PlatformCapability): boolean;
  listAll(): PlatformMeta[];
  getCapabilitySummary(platform: PlatformId): string;
}

// ==========================================
// API 配置
// ==========================================

/**
 * 平台切换事件回调。
 * next / prev 均为 PlatformId 字符串。
 */
export type PlatformChangeListener = (next: PlatformId, prev: PlatformId) => void;

/**
 * 配置变更事件回调。
 * 用于在用户编辑某个平台的 API Key 时通知 Service 层。
 */
export type ConfigChangeListener = (config: ApiConfig) => void;

/**
 * API 配置读写端口。
 * 取代对 ApiConfigStore 单例对象的直接依赖。
 *
 * 实现方契约（强制）：
 * 1. getApiKeyMasked 返回脱敏值（首 4 + 尾 4 + 中间星号）
 * 2. getToken 禁止在内部 console.log 出原始值
 * 3. onPlatformChange 在 activePlatform 变更时同步触发
 * 4. setActivePlatform 必须触发持久化（save）
 */
export interface IApiConfigStore {
  /** 加载完整配置（内存副本，禁止修改后回传） */
  load(): ApiConfig;
  /** 保存完整配置（合并默认值） */
  save(config: ApiConfig): Promise<void>;
  /** 自动保存（防抖包装；与 save 等价，仅为语义区分） */
  autoSave(config: ApiConfig): void;
  /** 获取当前激活平台 */
  getActivePlatform(): PlatformId;
  /** 切换激活平台（持久化 + 触发 onPlatformChange） */
  setActivePlatform(platform: PlatformId): Promise<void>;
  /** 获取某个平台的 API Key 脱敏值（用于 UI 显示，绝不返回明文） */
  getApiKeyMasked(platform: PlatformId): string;
  /** 获取某个平台的 Token（实现方有责任不打印） */
  getToken(platform: PlatformId): string | undefined;
  /** 判断指定平台是否已配置（有有效 Key/Token） */
  isPlatformConfigured(platform: PlatformId): boolean;
  /** 火山引擎语音技术（AppID/Token/Cluster）是否已配置完整 */
  isVolcVoiceConfigured(): boolean;
  /** 订阅平台切换事件，返回取消订阅函数 */
  onPlatformChange(listener: PlatformChangeListener): () => void;
  /** 订阅配置变更事件（含 Key/Token 更新），返回取消订阅函数 */
  onConfigChange(listener: ConfigChangeListener): () => void;
}

// ==========================================
// 平台元数据类型
// ==========================================

import type { PlatformId, ApiConfig } from '../entities/platform';
export type { PlatformId, ApiConfig };

export interface PlatformMeta {
  id: PlatformId;
  /** 显示名称（中文） */
  name: string;
  /** 显示名称（英文/品牌名） */
  brand: string;
  /** 图标 emoji */
  icon: string;
  /** 品牌主色 */
  accentColor: string;
  /** 简介描述 */
  description: string;
  /** 申请 Token 的外链 */
  externalLink: string;
  /** API 文档链接 */
  docLink: string;
  /** 该平台支持的能力集合 */
  capabilities: PlatformCapability[];
  /** 默认视频模型列表 */
  videoModels: string[];
  /** 默认图片模型 */
  imageModel?: string;
  /** 默认文本模型 */
  textModel?: string;
}

// ==========================================
// 模型注册表（M3.3 模型 ID 走 PlatformRouter）
// ==========================================

/**
 * 文本模型用途分类。
 * 不同业务场景使用不同档位的模型：
 * - chat: Agent 对话 / 用户交互（需强推理能力）
 * - recommendation: BGM 推荐 / 内容分类（中等档位）
 * - translation: 文学→镜头描述翻译（中等档位，重速度）
 * - alignment: 字幕时间轴对齐（轻量档位，重速度）
 * - splitter: 故事拆分（中等档位）
 */
export type TextModelCategory =
  | 'chat'
  | 'recommendation'
  | 'translation'
  | 'alignment'
  | 'splitter';

/**
 * 模型注册表端口。
 *
 * 取代 Service 层硬编码的模型 ID（EVOLUTION_DESIGN.md §7.3）：
 *   - BGMRecommendationService 硬编码 'MiniMax-M2.5'
 *   - SubtitleService 硬编码 'MiniMax-M2.5-highspeed'
 *   - AgentService 硬编码 'MiniMax-M3'
 *   - PromptContextBuilder 硬编码 'MiniMax-M2.5-highspeed'
 *
 * 实现方根据当前 activePlatform 的 PlatformMeta 返回对应模型 ID，
 * 使切换平台后所有 Service 自动使用新平台的模型。
 *
 * 实现示例：
 * - PlatformModelRegistry（基于 platformCapabilities + IApiConfigStore）
 * - StaticModelRegistry（测试用，固定返回某个模型）
 */
export interface IModelRegistry {
  /** 按用途解析文本模型 ID */
  resolveTextModel(category: TextModelCategory): string;
  /** 解析当前平台的图片模型 */
  resolveImageModel(): string;
  /** 解析当前平台的默认视频模型 */
  resolveVideoModel(): string;
}
