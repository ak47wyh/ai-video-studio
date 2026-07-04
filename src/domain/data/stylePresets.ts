import type { VideoStyle } from '../entities/models';

/** 风格元信息 */
export interface VideoStyleMeta {
  id: VideoStyle;
  /** i18n key，如 storyFilm.styleCinematic */
  nameKey: string;
  /** 拼接到 prompt 后的风格描述 */
  promptSuffix: string;
  /** 风格图标 emoji */
  icon: string;
}

/** 全量风格预设表 */
export const VIDEO_STYLE_PRESETS: VideoStyleMeta[] = [
  {
    id: 'cinematic',
    nameKey: 'storyFilm.styleCinematic',
    promptSuffix: ', cinematic lighting, film grain, dramatic shadows, shallow depth of field',
    icon: '🎬',
  },
  {
    id: 'anime',
    nameKey: 'storyFilm.styleAnime',
    promptSuffix: ', anime style, cel shading, vibrant colors, clean line art',
    icon: '🌸',
  },
  {
    id: 'watercolor',
    nameKey: 'storyFilm.styleWatercolor',
    promptSuffix: ', watercolor illustration, soft edges, pastel tones, artistic brushstrokes',
    icon: '🎨',
  },
  {
    id: 'gufeng',
    nameKey: 'storyFilm.styleGufeng',
    promptSuffix: ', Chinese ink painting style, traditional aesthetic, elegant composition',
    icon: '🏯',
  },
  {
    id: '3dcartoon',
    nameKey: 'storyFilm.style3dCartoon',
    promptSuffix: ', 3D rendered, Pixar style, soft lighting, smooth textures',
    icon: '🧸',
  },
  {
    id: 'scifi',
    nameKey: 'storyFilm.styleScifi',
    promptSuffix: ', futuristic, neon lights, cyberpunk aesthetic, holographic elements',
    icon: '🔮',
  },
  {
    id: 'documentary',
    nameKey: 'storyFilm.styleDocumentary',
    promptSuffix: ', documentary photography, natural lighting, realistic, high detail',
    icon: '📷',
  },
  {
    id: 'fairy_tale',
    nameKey: 'storyFilm.styleFairyTale',
    promptSuffix: ', ethereal, dreamy, magical atmosphere, soft glow, enchanted',
    icon: '✨',
  },
];

/** 根据 VideoStyle 获取 prompt 后缀 */
export function getStylePromptSuffix(style: VideoStyle): string {
  return VIDEO_STYLE_PRESETS.find(s => s.id === style)?.promptSuffix ?? '';
}

/** 根据 VideoStyle 获取元信息 */
export function getStyleMeta(style: VideoStyle): VideoStyleMeta | undefined {
  return VIDEO_STYLE_PRESETS.find(s => s.id === style);
}
