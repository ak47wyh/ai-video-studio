/**
 * 统一抽象图片风格预设 —— 平台无关的 UI 层数据源。
 *
 * 设计原则：
 *   - UI 层只面向统一抽象 key,不感知平台差异
 *   - 各 Adapter 内部维护 `abstractStyle → platformNativeStyle` 映射表
 *   - 平台不支持的画风由 Adapter 降级为空字符串(等同默认)
 *
 * 与 `stylePresets.ts`(视频风格)并列,互不依赖。
 */

/** 统一抽象图片风格 key(UI 层使用,与平台无关) */
export type ImageStyleKey =
  | 'photorealistic'   // 写实
  | 'anime'            // 动漫
  | 'oil_painting'     // 油画
  | 'watercolor'       // 水彩
  | 'sketch'           // 素描
  | '3d_render'        // 3D 渲染
  | 'chinese_painting' // 国画
  | 'cyberpunk'        // 赛博朋克
  | 'pixel_art'        // 像素艺术
  | '';                // 默认(无风格)

/** 风格预设(UI 下拉框选项) */
export interface ImageStylePreset {
  /** 统一抽象 key */
  key: ImageStyleKey;
  /** i18n key,如 'imageStyle.photorealistic' */
  label: string;
}

/** 统一风格列表(UI 渲染数据源) */
export const IMAGE_STYLE_PRESETS: readonly ImageStylePreset[] = [
  { key: '', label: 'imageStyle.default' },
  { key: 'photorealistic', label: 'imageStyle.photorealistic' },
  { key: 'anime', label: 'imageStyle.anime' },
  { key: 'oil_painting', label: 'imageStyle.oilPainting' },
  { key: 'watercolor', label: 'imageStyle.watercolor' },
  { key: 'sketch', label: 'imageStyle.sketch' },
  { key: '3d_render', label: 'imageStyle.3dRender' },
  { key: 'chinese_painting', label: 'imageStyle.chinesePainting' },
  { key: 'cyberpunk', label: 'imageStyle.cyberpunk' },
  { key: 'pixel_art', label: 'imageStyle.pixelArt' },
];
