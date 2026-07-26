/**
 * 平台能力矩阵 —— 单一数据源。
 *
 * 用于：
 *   1. UI 层 Lab 入口的可用性判断（不支持的能力置灰）
 *   2. Settings 页平台徽标的能力摘要
 *   3. 切换平台时决定哪些适配器需要实例化
 *   4. 图片模型 ID 的唯一权威来源(imageModels[] + defaultImageModel)
 *
 * 修改能力支持情况时只需更新此文件。
 */
import type { PlatformId, VolcArkProtocol } from '../entities/platform';
import type { ImageAspectRatio } from '../ports/OutboundPorts';

/** 能力类型 */
export type Capability =
  | 'video'        // 视频生成（T2V / I2V）
  | 'videoFl2v'    // 视频首尾帧
  | 'videoS2v'     // 视频参考生
  | 'image'        // 图片生成
  | 'text'         // 文本生成
  | 'voice'        // 语音合成
  | 'music';       // 音乐生成

/** 图片模型能力标志 */
export interface ImageModelCapabilities {
  /** 支持文生图 */
  t2i: boolean;
  /** 支持图生图 */
  i2i: boolean;
  /** 支持流式生成 */
  stream: boolean;
  /** 支持自定义尺寸 */
  customSize: boolean;
  /** 支持风格选择 */
  style: boolean;
}

/** 图片模型描述符(注册表条目) */
export interface ImageModelDescriptor {
  /** 真实模型 ID(发送给 API 的值) */
  id: string;
  /** 显示名称(中文) */
  label: string;
  /** 模型系列/品牌简述 */
  description: string;
  /** 能力标志 */
  capabilities: ImageModelCapabilities;
  /** 支持的宽高比列表(空数组表示全支持) */
  supportedAspectRatios: ImageAspectRatio[];
  /** 最大生成数量 */
  maxN: number;
  /** 是否推荐(排序权重,推荐模型排前) */
  recommended: boolean;
}

/** 文本模型描述符(注册表条目) */
export interface TextModelDescriptor {
  /** 真实模型 ID(发送给 API 的值) */
  id: string;
  /** 显示名称 */
  label: string;
  /** 简短描述 */
  description: string;
  /** 是否支持多模态输入(图片理解) */
  multimodal: boolean;
  /** 是否支持 Thinking(深度思考) */
  thinking: 'adaptive' | 'always' | 'none';
  /** 是否支持工具调用 */
  tools: boolean;
  /** 推荐场景描述 */
  rec: string;
}

/** 平台元信息 */
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
  capabilities: Capability[];
  /** 默认视频模型列表（用于 VideoLab 模型选择器） */
  videoModels: string[];
  /** 该平台支持的图片模型列表(单一数据源,替代旧 imageModel: string) */
  imageModels: ImageModelDescriptor[];
  /** 默认图片模型 ID(从 imageModels 中选一个,对应 ApiConfig 默认值) */
  defaultImageModel: string;
  /** @deprecated 使用 imageModels + defaultImageModel */
  imageModel?: string;
  /** 该平台支持的文本模型列表(用于 TextLab 模型选择器) */
  textModels: TextModelDescriptor[];
  /** 默认文本模型 */
  textModel?: string;
}

/** 全量平台元信息表（含已集成的 minimax / volcengine） */
export const PLATFORM_METADATA: Record<PlatformId, PlatformMeta> = {
  minimax: {
    id: 'minimax',
    name: '海螺',
    brand: 'MiniMax',
    icon: '🎬',
    accentColor: '#6366f1',
    description: '视频/图片/文本/语音/音乐 · 全模态',
    externalLink: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    docLink: 'https://platform.minimaxi.com/document/Platform%20Introduction',
    capabilities: ['video', 'videoFl2v', 'videoS2v', 'image', 'text', 'voice', 'music'],
    videoModels: ['MiniMax-Hailuo-2.3', 'MiniMax-Hailuo-02', 'T2V-01-Director', 'I2V-01'],
    imageModels: [
      {
        id: 'image-01',
        label: 'Image-01 (写实/通用)',
        description: '写实风格 · 支持自定义尺寸与 21:9',
        capabilities: { t2i: true, i2i: true, stream: false, customSize: true, style: false },
        supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'],
        maxN: 9,
        recommended: true,
      },
      {
        id: 'image-01-live',
        label: 'Image-01-Live (二次元/动漫)',
        description: '动漫画风增强 · 支持风格设置',
        capabilities: { t2i: true, i2i: true, stream: false, customSize: false, style: true },
        supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'],
        maxN: 9,
        recommended: false,
      },
    ],
    defaultImageModel: 'image-01',
    imageModel: 'image-01',
    textModels: [
      { id: 'MiniMax-M3', label: 'MiniMax-M3', description: '多模态+深度思考', multimodal: true, thinking: 'adaptive', tools: true, rec: '深度思考、多模态' },
      { id: 'MiniMax-M2.7', label: 'M2.7', description: '高质量文本', multimodal: false, thinking: 'always', tools: true, rec: '高质量文本' },
      { id: 'MiniMax-M2.7-highspeed', label: 'M2.7-fast', description: '快速文本', multimodal: false, thinking: 'always', tools: true, rec: '快速文本' },
      { id: 'MiniMax-M2.5', label: 'M2.5', description: '性价比文本', multimodal: false, thinking: 'always', tools: true, rec: '性价比文本' },
      { id: 'MiniMax-M2.5-highspeed', label: 'M2.5-fast', description: '快速文本', multimodal: false, thinking: 'always', tools: true, rec: '快速文本' },
      { id: 'MiniMax-M2.1', label: 'M2.1', description: '基础文本', multimodal: false, thinking: 'always', tools: true, rec: '基础文本' },
      { id: 'MiniMax-M2.1-highspeed', label: 'M2.1-fast', description: '快速基础', multimodal: false, thinking: 'always', tools: true, rec: '快速基础' },
      { id: 'MiniMax-M2', label: 'M2', description: '入门级', multimodal: false, thinking: 'always', tools: true, rec: '入门级' },
    ],
    textModel: 'MiniMax-M3',
  },
  volcengine: {
    id: 'volcengine',
    name: '即梦',
    brand: 'Volcengine',
    icon: '🌋',
    accentColor: '#f97316',
    description: 'Seedance · 视频/图片/文本/语音/3D',
    externalLink: 'https://console.volcengine.com/ark',
    docLink: 'https://www.volcengine.com/docs/82379',
    // 双协议并存：Video/Image 永远走 OpenAI 协议，Text 根据 volcArkProtocol 选择
    capabilities: ['video', 'videoFl2v', 'videoS2v', 'image', 'text', 'voice'],
    videoModels: [
      'doubao-seedance-2-0-260128',
      'doubao-seedance-2-0-fast-260128',
      'doubao-seedance-2-0-mini-260615',
      'doubao-seedance-1-0-pro-250528',
    ],
    imageModels: [
      // Agent Plan 套餐唯一支持的图片生成模型（官方文档 82379/2366394）
      {
        id: 'doubao-seedream-5.0-lite',
        label: 'Seedream 5.0 Lite',
        description: 'Agent Plan 套餐支持 · 2K/4K · 流式输出 · 多图批量',
        capabilities: { t2i: true, i2i: true, stream: true, customSize: true, style: false },
        supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'],
        maxN: 4,
        recommended: true,
      },
    ],
    defaultImageModel: 'doubao-seedream-5.0-lite',
    imageModel: 'doubao-seedream-5.0-lite',
    textModels: [
      { id: 'doubao-seed-2.0-pro', label: 'Doubao Seed 2.0 Pro', description: '旗舰推理模型', multimodal: false, thinking: 'adaptive', tools: true, rec: '深度推理' },
      { id: 'doubao-pro-32k', label: 'Doubao Pro 32K', description: '高质量文本', multimodal: false, thinking: 'always', tools: true, rec: '通用文本' },
      { id: 'doubao-lite-32k', label: 'Doubao Lite 32K', description: '轻量快速', multimodal: false, thinking: 'always', tools: true, rec: '快速文本' },
      { id: 'doubao-pro-128k', label: 'Doubao Pro 128K', description: '长文本', multimodal: false, thinking: 'always', tools: true, rec: '长文本处理' },
    ],
    textModel: 'doubao-pro-32k',
  },
  kling: {
    id: 'kling',
    name: '可灵',
    brand: 'Kling',
    icon: '🎥',
    accentColor: '#10b981',
    description: '快手 · 视频/图片 · JWT 鉴权',
    externalLink: 'https://klingai.kuaishou.com/',
    docLink: 'https://docs.qingque.cn/d/home/eZQBmTMbY0cTSoxYLxgT5RTgn',
    capabilities: ['video', 'videoS2v', 'image'],
    videoModels: ['kling-v2.1', 'kling-v2-master', 'kling-v1.6'],
    imageModels: [],
    defaultImageModel: 'kling-v1',
    imageModel: 'kling-v1',
    textModels: [],
  },
  wan: {
    id: 'wan',
    name: '万相',
    brand: 'Wan',
    icon: '🌈',
    accentColor: '#06b6d4',
    description: '阿里 DashScope · 视频/图片/文本/语音',
    externalLink: 'https://help.aliyun.com/zh/model-studio/',
    docLink: 'https://help.aliyun.com/zh/model-studio/developer-reference/use-qwen-by-calling-api',
    capabilities: ['video', 'videoFl2v', 'videoS2v', 'image', 'text', 'voice'],
    videoModels: ['wanx2.1-t2v-turbo', 'wanx2.1-t2v-plus', 'wanx2.1-i2v-turbo', 'wanx2.1-i2v-plus'],
    imageModels: [],
    defaultImageModel: 'wanx2.1-t2i-turbo',
    imageModel: 'wanx2.1-t2i-turbo',
    textModels: [
      { id: 'qwen-plus', label: 'Qwen Plus', description: '高质量文本', multimodal: false, thinking: 'always', tools: true, rec: '通用文本' },
      { id: 'qwen-turbo', label: 'Qwen Turbo', description: '快速文本', multimodal: false, thinking: 'always', tools: true, rec: '快速文本' },
      { id: 'qwen-max', label: 'Qwen Max', description: '旗舰模型', multimodal: false, thinking: 'adaptive', tools: true, rec: '深度推理' },
    ],
    textModel: 'qwen-plus',
  },
  hunyuan: {
    id: 'hunyuan',
    name: '混元',
    brand: 'Hunyuan',
    icon: '🔮',
    accentColor: '#3b82f6',
    description: '腾讯云 · 视频/文本/语音 · TC3 签名',
    externalLink: 'https://cloud.tencent.com/document/product/1729',
    docLink: 'https://cloud.tencent.com/document/product/1729/97731',
    capabilities: ['video', 'text', 'voice'],
    videoModels: ['hunyuan-video', 'hunyuan-video-i2v'],
    imageModels: [],
    defaultImageModel: '',
    textModels: [
      { id: 'hunyuan-turbos-latest', label: 'Hunyuan TurboS', description: '快速文本', multimodal: false, thinking: 'always', tools: true, rec: '快速文本' },
    ],
    textModel: 'hunyuan-turbos-latest',
  },
  zhipu: {
    id: 'zhipu',
    name: '智谱',
    brand: 'Zhipu',
    icon: '✨',
    accentColor: '#ec4899',
    description: 'CogVideoX/GLM · 视频/图片/文本/语音',
    externalLink: 'https://docs.bigmodel.cn/',
    docLink: 'https://docs.bigmodel.cn/cn/guide/start/quick-start',
    capabilities: ['video', 'videoS2v', 'image', 'text', 'voice'],
    videoModels: ['cogvideox-2', 'cogvideox-flash'],
    imageModels: [],
    defaultImageModel: 'cogview-3-plus',
    imageModel: 'cogview-3-plus',
    textModels: [
      { id: 'glm-4-plus', label: 'GLM-4 Plus', description: '高质量文本', multimodal: false, thinking: 'always', tools: true, rec: '通用文本' },
      { id: 'glm-4-flash', label: 'GLM-4 Flash', description: '快速文本', multimodal: false, thinking: 'always', tools: true, rec: '快速文本' },
    ],
    textModel: 'glm-4-plus',
  },
  vidu: {
    id: 'vidu',
    name: 'Vidu',
    brand: 'Vidu',
    icon: '🎯',
    accentColor: '#f59e0b',
    description: '生数科技 · 仅视频 · 参考生/首尾帧',
    externalLink: 'https://docs.vidu.cn',
    docLink: 'https://docs.vidu.cn/page/start',
    capabilities: ['video', 'videoFl2v', 'videoS2v', 'image'],
    videoModels: ['viduq1', 'vidu-1', 'vidu-2'],
    imageModels: [],
    defaultImageModel: 'viduq1',
    imageModel: 'viduq1',
    textModels: [],
  },
};

/** 判断平台是否具备指定能力 */
export function hasCapability(platform: PlatformId, capability: Capability): boolean {
  return PLATFORM_METADATA[platform]?.capabilities.includes(capability) ?? false;
}

/** 获取平台支持的能力摘要文本（用于 Lab 页顶栏） */
export function getCapabilitySummary(platform: PlatformId): string {
  const caps = PLATFORM_METADATA[platform]?.capabilities ?? [];
  if (caps.length === 0) return '无生成能力';
  const labels: Record<Capability, string> = {
    video: '视频',
    videoFl2v: '首尾帧',
    videoS2v: '参考生',
    image: '图片',
    text: '文本',
    voice: '语音',
    music: '音乐',
  };
  return caps.map(c => labels[c]).join(' / ');
}

/** 获取所有支持视频生成的平台（用于 Settings 下拉过滤） */
export function getVideoCapablePlatforms(): PlatformMeta[] {
  return Object.values(PLATFORM_METADATA).filter(p => p.capabilities.includes('video'));
}

/**
 * 获取指定平台的图片模型列表(按 recommended 排序,推荐模型排前)。
 * 仅返回注册表中声明的模型,未声明模型的平台返回空数组。
 */
export function getImageModels(platform: PlatformId): ImageModelDescriptor[] {
  const meta = PLATFORM_METADATA[platform];
  if (!meta?.imageModels?.length) return [];
  return [...meta.imageModels].sort((a, b) => Number(b.recommended) - Number(a.recommended));
}

/**
 * 获取指定平台的默认图片模型 ID。
 * 优先取 defaultImageModel,其次回退到 deprecated imageModel 字段。
 */
export function getDefaultImageModel(platform: PlatformId): string {
  const meta = PLATFORM_METADATA[platform];
  if (!meta) return '';
  return meta.defaultImageModel || meta.imageModel || '';
}

/**
 * 根据平台 + 模型 ID 查找描述符。
 * 用于 UI 层根据当前选中模型查询其能力标志(如 customSize/style)。
 */
export function findImageModel(platform: PlatformId, modelId: string): ImageModelDescriptor | undefined {
  return PLATFORM_METADATA[platform]?.imageModels?.find(m => m.id === modelId);
}

/**
 * 获取指定平台的文本模型列表(用于 TextLab 模型选择器)。
 * 不支持 text 能力的平台返回空数组。
 */
export function getTextModels(platform: PlatformId): TextModelDescriptor[] {
  const meta = PLATFORM_METADATA[platform];
  if (!meta?.textModels?.length || !meta.capabilities.includes('text')) return [];
  return meta.textModels;
}

/**
 * 获取指定平台的默认文本模型 ID。
 */
export function getDefaultTextModel(platform: PlatformId): string {
  const meta = PLATFORM_METADATA[platform];
  if (!meta) return 'MiniMax-M3';
  return meta.textModel || meta.textModels?.[0]?.id || 'MiniMax-M3';
}

/**
 * 根据火山方舟接入协议获取实际可用能力。
 *
 * 双协议并存架构（澄清项 1）：
 *   - Video/Image 永远走 OpenAI 协议（火山方舟视频/图片生成仅支持 OpenAI 兼容端点），
 *     与 volcArkTextProtocol 选择无关。
 *   - Text 根据 protocol 选择 OpenAI 兼容 (/chat/completions) 或 Anthropic Messages (/v1/messages)。
 *   - Voice 走原生语音端点（openspeech.bytedance.com），与方舟协议无关。
 *
 * 因此 protocol 参数实际上不影响 capabilities 集合，仅影响 VolcengineTextAdapter 内部
 * 的端点选择。本函数保留 protocol 参数仅为向后兼容签名。
 */
export function getVolcengineCapabilities(_protocol: VolcArkProtocol): {
  capabilities: Capability[];
  supportsAgentTemplate: boolean;
} {
  return {
    capabilities: PLATFORM_METADATA.volcengine.capabilities,
    supportsAgentTemplate: false,
  };
}

/**
 * 判断火山方舟在指定协议下是否具备某能力。
 * 其他平台忽略 protocol 参数，直接查 PLATFORM_METADATA。
 */
export function hasCapabilityWithProtocol(
  platform: PlatformId,
  capability: Capability,
  protocol?: VolcArkProtocol,
): boolean {
  if (platform === 'volcengine' && protocol) {
    return getVolcengineCapabilities(protocol).capabilities.includes(capability);
  }
  return PLATFORM_METADATA[platform]?.capabilities.includes(capability) ?? false;
}
