/**
 * SUBTITLE_PRESETS —— 字幕样式预设库（SU-2）
 *
 * 与 SubtitleStyle 字段一一对应，供 SubtitleStyleEditor 一键应用。
 */
import type { SubtitleStyle } from '../ports/PostProcessPorts';

export const SUBTITLE_PRESETS: Record<string, SubtitleStyle> = {
  douyin: { fontFamily: 'Arial', fontSize: 32, primaryColor: '#FFFFFF', outlineColor: '#000000', outlineWidth: 3, position: 'bottom', marginV: 60, bold: true },
  bilibili: { fontFamily: 'Arial', fontSize: 24, primaryColor: '#FFFFFF', outlineColor: '#000000', outlineWidth: 2, position: 'bottom', marginV: 40, bold: false },
  cinematic: { fontFamily: 'Georgia', fontSize: 28, primaryColor: '#F5F5DC', outlineColor: '#000000', outlineWidth: 1, position: 'bottom', marginV: 50, bold: false },
};

export type SubtitlePresetId = keyof typeof SUBTITLE_PRESETS;

/** 预设名（UI 展示键），key 即 preset id */
export const SUBTITLE_PRESET_IDS = Object.keys(SUBTITLE_PRESETS) as SubtitlePresetId[];

/** 判断 style 是否等于某预设（浅比较核心字段） */
export function matchesPreset(style: SubtitleStyle, presetId: SubtitlePresetId): boolean {
  const p = SUBTITLE_PRESETS[presetId];
  return (
    style.fontFamily === p.fontFamily
    && style.fontSize === p.fontSize
    && style.primaryColor === p.primaryColor
    && style.outlineColor === p.outlineColor
    && style.outlineWidth === p.outlineWidth
    && style.position === p.position
    && style.marginV === p.marginV
    && style.bold === p.bold
  );
}
