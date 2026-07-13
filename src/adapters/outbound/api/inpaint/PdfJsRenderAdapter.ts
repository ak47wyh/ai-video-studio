/**
 * PdfJsRenderAdapter —— IPdfRenderPort 的 pdfjs-dist 实现
 *
 * Phase 2 DIP：将 CDN 动态 import 与 Worker 配置局限于此文件，
 * UI 通过 Port 调用，不再直接处理 @ts-expect-error。
 *
 * 实现要点：
 * - 首次调用 renderFirstPage 时惰性 import pdfjs-dist from CDN
 * - 加载成功后缓存模块引用，后续调用直接复用
 * - isAvailable 在首次加载成功后返回 true；失败/未加载时返回 false
 * - 加载/渲染失败时抛 Error（保留原始消息供 UI 提示）
 */

import type { IPdfRenderPort, PdfFirstPageRender } from '../../../../domain/ports/PdfRenderPort';

/** CDN 上的 pdfjs-dist 模块 URL（与原 WatermarkLab 内联代码保持一致） */
const PDFJS_CDN_URL = 'https://unpkg.com/pdfjs-dist@4.8.69/build/pdf.min.mjs';
const PDFJS_WORKER_URL = 'https://unpkg.com/pdfjs-dist@4.8.69/build/pdf.worker.min.mjs';

/** pdfjs-dist 模块的最小类型形状 */
interface PdfJsModule {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(args: { data: ArrayBuffer }): { promise: PdfDocument };
}

interface PdfDocument {
  getPage(n: number): Promise<PdfPage>;
}

interface PdfPage {
  getViewport(args: { scale: number }): { width: number; height: number };
  render(args: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }): { promise: Promise<void> };
}

export class PdfJsRenderAdapter implements IPdfRenderPort {
  private pdfjs: PdfJsModule | null = null;
  private loadFailed = false;

  async renderFirstPage(file: File): Promise<PdfFirstPageRender> {
    const pdfjs = await this.ensureLoaded();
    const buf = await file.arrayBuffer();
    const doc = await pdfjs.getDocument({ data: buf }).promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('PDF 渲染失败：无法创建 canvas 2d 上下文');
    }
    await page.render({ canvasContext: ctx, viewport }).promise;

    return {
      width: viewport.width,
      height: viewport.height,
      dataUrl: canvas.toDataURL('image/png'),
    };
  }

  isAvailable(): boolean {
    return this.pdfjs !== null && !this.loadFailed;
  }

  /** 惰性加载 pdfjs-dist 模块；失败时设置 loadFailed 并抛错 */
  private async ensureLoaded(): Promise<PdfJsModule> {
    if (this.pdfjs) return this.pdfjs;
    if (this.loadFailed) {
      throw new Error('PDF 渲染模块加载已失败，请刷新页面重试');
    }
    try {
      // CDN 动态导入，无类型声明；@vite-ignore 防 Vite 处理；类型断言在下方
      const mod = await import(/* @vite-ignore */ PDFJS_CDN_URL);
      mod.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      this.pdfjs = mod as PdfJsModule;
      return this.pdfjs;
    } catch (e) {
      this.loadFailed = true;
      throw new Error(`PDF 渲染模块加载失败：${e instanceof Error ? e.message : String(e)}`, { cause: e });
    }
  }
}

/** 单例：默认导出，由 dependencies.ts 装配 */
export const pdfJsRenderAdapter = new PdfJsRenderAdapter();
