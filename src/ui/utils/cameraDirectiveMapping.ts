/**
 * 运镜指令双向映射 —— CameraDirectivePanel 中文字符串 ↔ CinematographyService 英文枚举
 *
 * 设计目的：消除两套平行的运镜体系概念割裂。
 *   - CameraDirectivePanel 使用 15 种中文指令（如"左摇"、"推进"），插入 prompt 文本
 *   - CinematographyService 使用 9 种英文 CameraMovement 枚举（如 'pan'、'zoom-in'）
 *
 * 映射策略：中文粒度更细（区分左/右、上/下），英文枚举更粗。
 *   - 左移/右移 → dolly（移动）；上升/下降 → crane（升降）；左摇/右摇 → pan（水平摇）
 *   - 多对一映射，反向一对一取首个中文标签
 */

import type { CameraMovement } from '../../domain/services/CinematographyService';

/** 中文运镜指令 → 英文 CameraMovement 枚举 */
const CHINESE_TO_MOVEMENT: Record<string, CameraMovement> = {
  '左移': 'dolly',
  '右移': 'dolly',
  '左摇': 'pan',
  '右摇': 'pan',
  '推进': 'zoom-in',
  '拉远': 'zoom-out',
  '上升': 'crane',
  '下降': 'crane',
  '上摇': 'tilt',
  '下摇': 'tilt',
  '变焦推近': 'zoom-in',
  '变焦拉远': 'zoom-out',
  '晃动': 'handheld',
  '跟随': 'tracking',
  '固定': 'static',
};

/** 英文 CameraMovement 枚举 → 首选中文指令 */
const MOVEMENT_TO_CHINESE: Record<CameraMovement, string> = {
  'static': '固定',
  'pan': '左摇',
  'tilt': '上摇',
  'zoom-in': '推进',
  'zoom-out': '拉远',
  'dolly': '左移',
  'tracking': '跟随',
  'crane': '上升',
  'handheld': '晃动',
};

/** 中文运镜指令 → 英文枚举（无匹配返回 undefined） */
export function chineseToMovement(directive: string): CameraMovement | undefined {
  return CHINESE_TO_MOVEMENT[directive];
}

/** 英文枚举 → 首选中文指令 */
export function movementToChinese(movement: CameraMovement): string {
  return MOVEMENT_TO_CHINESE[movement] ?? movement;
}

/**
 * 从 prompt 文本中提取所有 [中文指令] 标签并转为 CameraMovement 数组。
 * 用于将用户通过 CameraDirectivePanel 插入的指令解析为结构化数据，
 * 供 CinematographyService 后续处理。
 */
export function extractMovementsFromPrompt(prompt: string): CameraMovement[] {
  const matches = prompt.matchAll(/\[([^\]]+)\]/g);
  const movements: CameraMovement[] = [];
  for (const match of matches) {
    const directive = match[1].trim();
    const movement = chineseToMovement(directive);
    if (movement) movements.push(movement);
  }
  return movements;
}
