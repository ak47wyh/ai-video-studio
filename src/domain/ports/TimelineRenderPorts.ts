/**
 * TimelineRenderPorts —— 时间线渲染端口
 *
 * 把"按 Timeline 编排 → 渲染成片"的能力抽象为 Port，
 * 使剪辑工作台可以不依赖具体的 FFmpeg 实现。
 *
 * 当前实现：TimelineRenderService（基于 FFmpeg.wasm 原子操作编排）。
 * 后续可实现：远程渲染服务适配器、WebCodecs 适配器。
 */

import type { Timeline } from './PostProcessPorts';

// ==========================================
// 渲染选项
// ==========================================

export type ExportResolution = 'original' | '1080p' | '720p' | '480p' | '4k' | 'vertical_1080x1920';
export type ExportFormat = 'mp4' | 'gif' | 'webp' | 'mov' | 'webm';
export type ExportQuality = 'high' | 'medium' | 'low';

/**
 * 渲染导出选项（剪辑工作台导出弹窗使用）。
 *
 * - resolution: 目标分辨率（E-2 扩展 480p/4k/竖屏）；original 表示保持源分辨率
 * - format: 目标格式（E-1 扩展 gif/webp/mov/webm）
 * - quality: 压缩预设，映射 CRF（high=18 / medium=23 / low=28）
 * - burnSubtitles: 是否烧录字幕轨
 * - subtitleStyle: 字幕样式预设
 */
export interface RenderExportOptions {
  resolution: ExportResolution;
  format: ExportFormat;
  quality: ExportQuality;
  burnSubtitles?: boolean;
  subtitleStyle?: import('./PostProcessPorts').SubtitleStyle;
}

/** 渲染阶段 i18n key（T-3：domain 不硬编码中文，UI 用 t(stage) 翻译） */
export type RenderStageKey =
  | 'render.stage.loadingEngine'
  | 'render.stage.parsingClips'
  | 'render.stage.concatVideo'
  | 'render.stage.mixingAudio'
  | 'render.stage.burningSubtitles'
  | 'render.stage.postProcess'
  | 'render.stage.finalizing';

/** 渲染进度回调 */
export interface RenderProgress {
  /** 0~100 */
  percent: number;
  /** 当前阶段 i18n key（RenderStageKey） */
  stage: RenderStageKey;
}

/**
 * 时间线渲染端口。
 *
 * 渲染流程：
 * 1. 解析 Timeline 各轨 clip 的 sourceRef → Blob
 * 2. 视频轨：trim（裁切）→ applyTransition（段间转场）→ concat
 * 3. 音频轨：旁白轨 + BGM 轨 mixMultipleAudio → 与视频 merge
 * 4. 字幕轨：生成 SRT → burnSubtitles
 * 5. 后处理：resize / compress / convertFormat
 * 6. 产物返回 Blob（由调用方决定落盘位置）
 *
 * 失败时抛出 Error（不静默 Mock）。
 */
export interface ITimelineRenderPort {
  /**
   * 按 Timeline 编排渲染最终视频。
   * @param timeline 时间线
   * @param options 渲染选项
   * @param onProgress 进度回调（可选）
   */
  render(
    timeline: Timeline,
    options: RenderExportOptions,
    onProgress?: (p: RenderProgress) => void,
  ): Promise<Blob>;

  /** 探测 Blob 视频时长（秒），用于转场 offset 计算与时间轴铺轨 */
  probeDuration(blob: Blob): Promise<number>;
}
