import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText } from 'lucide-react';
import { useEnhancement, buildPdfOptions } from '../../hooks/useEnhancement';
import { useToast } from '../../contexts/ToastContext';
import {
  EnhanceUploadZone,
  EnhanceParamSlider,
  EnhanceProgressBar,
  EnhanceRetryHint,
  EnhanceActionButtons,
  EnhanceAsyncWrapper,
} from '../../components/enhance/EnhanceParts';
import type { EnhanceMode, PdfOutputForm, PdfPageRange } from '../../../domain/ports/EnhancementPorts';

const MAX_DIMENSION = 560;

export const PdfEnhancePanel: React.FC = () => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const {
    progress, isProcessing, error, resultUrl,
    processPdf, cancel, reset, retry, retryCount, isFallbackRetry,
  } = useEnhancement();

  const [file, setFile] = useState<File | null>(null);
  const [firstPageUrl, setFirstPageUrl] = useState<string | null>(null);
  const [displaySize, setDisplaySize] = useState({ w: 400, h: 560 });
  const [dpi, setDpi] = useState<96 | 150 | 300>(150);
  const [mode, setMode] = useState<EnhanceMode>('all');
  const [sharpen, setSharpen] = useState(50);
  const [pageRangeMode, setPageRangeMode] = useState<'all' | 'custom'>('all');
  const [pageFrom, setPageFrom] = useState(1);
  const [pageTo, setPageTo] = useState(10);
  const [outputForm, setOutputForm] = useState<PdfOutputForm>('rasterized');

  const handleFileSelect = useCallback(async (f: File) => {
    if (f.type !== 'application/pdf') {
      showToast('error', t('enhanceLab.selectPdf', '请选择 PDF 文件'));
      return;
    }
    setFile(f);
    reset();
    try {
      // @ts-expect-error - CDN 动态导入，无类型声明
      const pdfjs = await import(/* @vite-ignore */ 'https://unpkg.com/pdfjs-dist@4.8.69/build/pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@4.8.69/build/pdf.worker.min.mjs';
      const buf = await f.arrayBuffer();
      const doc = await pdfjs.getDocument({ data: buf }).promise;
      const page = await doc.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      const ratio = viewport.width / viewport.height;
      const dh = MAX_DIMENSION;
      const dw = dh * ratio;
      setDisplaySize({ w: Math.round(dw), h: dh });

      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      setFirstPageUrl(canvas.toDataURL('image/png'));
    } catch (_e) {
      showToast('error', t('enhanceLab.pdfPreviewFailed', 'PDF 预览失败'));
    }
  }, [reset, showToast, t]);

  const handleProcess = () => {
    if (!file) return;
    const range: PdfPageRange = pageRangeMode === 'all' ? 'all' : { from: pageFrom, to: pageTo };
    processPdf(file, buildPdfOptions(dpi, mode, sharpen, range, outputForm));
  };

  const handleDownload = () => {
    if (!resultUrl) return;
    const a = document.createElement('a');
    a.href = resultUrl;
    a.download = `enhanced_${file?.name || 'result.pdf'}`;
    a.click();
  };

  return (
    <div className="enhance-panel">
      {!file ? (
        <EnhanceUploadZone
          icon={<FileText size={40} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />}
          hint={t('enhanceLab.pdfUploadHint', '拖拽 PDF 到此处或点击上传')}
          hint2={t('enhanceLab.pdfUploadHint2', '支持标准 PDF · 最大 50 页 · 最大 50MB')}
          accept="application/pdf"
          onFile={handleFileSelect}
        />
      ) : (
        <div className="enhance-editor-layout">
          <div className="enhance-canvas-area">
            {resultUrl ? (
              <iframe
                src={resultUrl}
                style={{ width: displaySize.w, height: displaySize.h, border: 'none', borderRadius: 'var(--radius-md)' }}
                title="PDF Result"
              />
            ) : firstPageUrl ? (
              <img
                src={firstPageUrl}
                alt={t('enhanceLab.pdfPreview', 'PDF 预览')}
                style={{ width: displaySize.w, height: displaySize.h, objectFit: 'contain', borderRadius: 'var(--radius-md)' }}
              />
            ) : null}
            {!resultUrl && (
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                {t('enhanceLab.pdfPageHint', '提示：预览为第一页，增强处理将应用到所选页范围')}
              </p>
            )}
          </div>

          <div className="enhance-params-panel">
            <div className="form-group">
              <label className="form-label">{t('enhanceLab.outputDpi', '输出 DPI')}</label>
              <select className="form-select" value={dpi} onChange={(e) => setDpi(Number(e.target.value) as 96 | 150 | 300)} disabled={isProcessing}>
                <option value={96}>{t('enhanceLab.dpi96', '96（快速）')}</option>
                <option value={150}>{t('enhanceLab.dpi150', '150（推荐）')}</option>
                <option value={300}>{t('enhanceLab.dpi300', '300（高清）')}</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">{t('enhanceLab.enhanceMode', '增强模式')}</label>
              <select className="form-select" value={mode} onChange={(e) => setMode(e.target.value as EnhanceMode)} disabled={isProcessing}>
                <option value="sharpen">{t('enhanceLab.modeTextSharpen', '文字锐化')}</option>
                <option value="denoise">{t('enhanceLab.modeDenoise', '去噪')}</option>
                <option value="all">{t('enhanceLab.modeAllPdf', '综合（推荐）')}</option>
              </select>
            </div>

            {(mode === 'sharpen' || mode === 'all') && (
              <EnhanceParamSlider
                label={t('enhanceLab.sharpenStrength', '锐化强度')}
                value={sharpen}
                disabled={isProcessing}
                tooltip={t('enhanceLab.pdfSharpenTooltip', 'USM 锐化：提升文字边缘清晰度')}
                onChange={setSharpen}
              />
            )}

            <div className="form-group">
              <label className="form-label">{t('enhanceLab.pageRange', '处理范围')}</label>
              <select className="form-select" value={pageRangeMode} onChange={(e) => setPageRangeMode(e.target.value as 'all' | 'custom')} disabled={isProcessing}>
                <option value="all">{t('enhanceLab.allPages', '全部页')}</option>
                <option value="custom">{t('enhanceLab.customRange', '指定页范围')}</option>
              </select>
            </div>

            {pageRangeMode !== 'all' && (
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="number"
                  className="form-select"
                  min={1}
                  value={pageFrom}
                  onChange={(e) => setPageFrom(Number(e.target.value))}
                  disabled={isProcessing}
                  placeholder={t('enhanceLab.pageFrom', '起始页')}
                  style={{ flex: 1 }}
                />
                <input
                  type="number"
                  className="form-select"
                  min={1}
                  value={pageTo}
                  onChange={(e) => setPageTo(Number(e.target.value))}
                  disabled={isProcessing}
                  placeholder={t('enhanceLab.pageTo', '结束页')}
                  style={{ flex: 1 }}
                />
              </div>
            )}

            <div className="form-group">
              <label className="form-label">{t('enhanceLab.outputForm', '输出形式')}</label>
              <select className="form-select" value={outputForm} onChange={(e) => setOutputForm(e.target.value as PdfOutputForm)} disabled={isProcessing}>
                <option value="rasterized">{t('enhanceLab.formRasterized', '图像型 PDF（扫描件推荐）')}</option>
                <option value="preserve_text">{t('enhanceLab.formPreserveText', '保留文字层（数字 PDF）')}</option>
              </select>
            </div>

            <EnhanceRetryHint retryCount={retryCount} isFallbackRetry={isFallbackRetry} isProcessing={isProcessing} />

            <EnhanceAsyncWrapper
              isProcessing={isProcessing}
              progress={progress}
              error={error}
              onRetry={retry}
              hasResult={!!resultUrl}
            >
              <EnhanceActionButtons
                isProcessing={isProcessing}
                hasResult={!!resultUrl}
                canProcess={!!file}
                onProcess={handleProcess}
                onCancel={cancel}
                onDownload={handleDownload}
                onReset={() => { reset(); }}
              />
            </EnhanceAsyncWrapper>

            {isProcessing && <EnhanceProgressBar progress={progress} />}

            <button
              className="btn btn-secondary"
              style={{ marginTop: '0.5rem', fontSize: '0.75rem' }}
              onClick={() => { setFile(null); setFirstPageUrl(null); reset(); }}
            >
              {t('enhanceLab.changePdf', '更换 PDF')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
