/**
 * PdfRenderPort —— PDF 渲染端口
 *
 * Phase 2 DIP：隔离 pdfjs-dist CDN 加载与 Worker 配置，
 * 使 UI 层不再处理 @ts-expect-error + 动态 CDN import。
 *
 * 设计要点：
 * - 仅暴露 renderFirstPage：满足现有 WatermarkLab 预览需求
 * - isAvailable 用于失败降级提示
 * - CDN 加载、Worker URL、@ts-expect-error 全部局限于 adapter 文件
 */

export interface PdfFirstPageRender {
  /** PDF 第一页原始宽度（CSS px） */
  width: number;
  /** PDF 第一页原始高度（CSS px） */
  height: number;
  /** 渲染后的 PNG dataURL（供 <img> src 直接使用） */
  dataUrl: string;
}

export interface IPdfRenderPort {
  /**
   * 渲染 PDF 第一页。
   *
   * 失败时抛 Error（包含原始错误信息），由 UI 层 toast 提示。
   */
  renderFirstPage(file: File): Promise<PdfFirstPageRender>;
  /** 是否可用（CDN 加载成功后才返回 true） */
  isAvailable(): boolean;
}
