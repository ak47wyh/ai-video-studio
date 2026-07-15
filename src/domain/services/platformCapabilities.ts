/**
 * 平台能力矩阵 —— 单一数据源。
 *
 * 用于：
 *   1. UI 层 Lab 入口的可用性判断（不支持的能力置灰）
 *   2. Settings 页平台徽标的能力摘要
 *   3. 切换平台时决定哪些适配器需要实例化
 *
 * 修改能力支持情况时只需更新此文件。
 */
import type { PlatformId, VolcArkProtocol } from '../entities/platform';

/** 能力类型 */
export type Capability =
  | 'video'        // 视频生成（T2V / I2V）
  | 'videoFl2v'    // 视频首尾帧
  | 'videoS2v'     // 视频参考生
  | 'image'        // 图片生成
  | 'text'         // 文本生成
  | 'voice'        // 语音合成
  | 'music';       // 音乐生成

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
  /** 默认图片模型 */
  imageModel?: string;
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
    imageModel: 'image-01',
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
      'doubao-seedance-1-0-pro-250528',
      'doubao-seedance-1-0-pro-fast-251015',
      'doubao-seedance-1-0-lite-t2v-250428',
      'doubao-seedance-1-0-lite-i2v-250428',
    ],
    imageModel: 'doubao-seedream-4-5-251128',
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
    imageModel: 'kling-v1',
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
    imageModel: 'wanx2.1-t2i-turbo',
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
    imageModel: 'cogview-3-plus',
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
    imageModel: 'viduq1',
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
