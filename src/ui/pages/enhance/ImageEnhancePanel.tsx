import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useEnhancement, buildImageOptions } from '../../hooks/useEnhancement';
import { useToast } from '../../contexts/ToastContext';
import { useSpace } from '../../contexts/SpaceContext';
import { assetLibraryService } from '../../../dependencies';
import { EnhanceCompare } from '../../components/enhance/EnhanceCompare';
import {
  EnhanceUploadZone,
  EnhanceParamSlider,
  EnhanceProgressBar,
  EnhanceRetryHint,
  EnhanceActionButtons,
  EnhanceAsyncWrapper,
} from '../../components/enhance/EnhanceParts';
import type { EnhanceMode, ImageScale, ImageOutputFormat } from '../../../domain/ports/EnhancementPorts';

const MAX_DIMENSION = 600;

export const ImageEnhancePanel: React.FC = () => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { currentSpaceId } = useSpace();
  const {
    progress, isProcessing, error, resultUrl, resultBlob,
    processImage, cancel, reset, retry, retryCount, isFallbackRetry,
  } = useEnhancement();

  const [file, setFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [displaySize, setDisplaySize] = useState({ w: 400, h: 300 });
  const [mode, setMode] = useState<EnhanceMode>('all');
  const [scale, setScale] = useState<ImageScale>(2);
  const [sharpen, setSharpen] = useState(40);
  const [denoise, setDenoise] = useState(30);
  const [outputFormat, setOutputFormat] = useState<ImageOutputFormat>('png');

  const handleFileSelect = useCallback((f: File) => {
    if (!f.type.startsWith('image/')) {
      showToast('error', t('enhanceLab.selectImage', '请选择图片文件'));
      return;
    }
    setFile(f);
    const url = URL.createObjectURL(f);
    setImageUrl(url);
    reset();

    const img = new Image();
    img.onload = () => {
      const ratio = img.naturalWidth / img.naturalHeight;
      let dw = MAX_DIMENSION;
      let dh = MAX_DIMENSION / ratio;
      if (dh > MAX_DIMENSION) {
        dh = MAX_DIMENSION;
        dw = MAX_DIMENSION * ratio;
      }
      setDisplaySize({ w: Math.round(dw), h: Math.round(dh) });
    };
    img.src = url;
  }, [reset, showToast, t]);

  const handleProcess = () => {
    if (!file) return;
    processImage(file, buildImageOptions(mode, scale, sharpen, denoise, outputFormat));
  };

  const handleDownload = () => {
    if (!resultBlob) return;
    const url = URL.createObjectURL(resultBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `enhanced_${file?.name?.replace(/\.[^.]+$/, '') || 'result'}.${outputFormat === 'png' ? 'png' : 'jpg'}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveToLibrary = async () => {
    if (!resultBlob || !currentSpaceId || !file) return;
    try {
      await assetLibraryService.saveImageFromBlob({
        spaceId: currentSpaceId,
        name: `${t('enhanceLab.enhancePrefix', '增强')}_${file.name}`,
        blob: resultBlob,
        prompt: `${t('enhanceLab.enhanceDesc', '清晰度提升')}-${mode}`,
        model: 'enhance-local',
        aspectRatio: `${displaySize.w}:${displaySize.h}`,
        tags: [t('enhanceLab.enhancePrefix', '清晰度提升'), `${t('enhanceLab.modeTag', '模式')}-${mode}`, `${t('enhanceLab.scaleTag', '放大')}-${scale}x`],
        sourceType: 'lab',
      });
      showToast('success', t('enhanceLab.savedToLibrary', '已保存到素材库'));
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : t('enhanceLab.saveFailed', '保存失败'));
    }
  };

  return (
    <div className="enhance-panel">
      {!file ? (
        <EnhanceUploadZone
          hint={t('enhanceLab.imageUploadHint', '拖拽图片到此处或点击上传')}
          hint2={t('enhanceLab.imageUploadHint2', '支持 JPG / PNG / WEBP / BMP · 最大 4096×4096 · 最大 20MB')}
          accept="image/*"
          onFile={handleFileSelect}
        />
      ) : (
        <div className="enhance-editor-layout">
          {/* 左侧：预览区 */}
          <div className="enhance-canvas-area">
            {resultUrl && imageUrl ? (
              <EnhanceCompare
                originalUrl={imageUrl}
                resultUrl={resultUrl}
                displayWidth={displaySize.w}
                displayHeight={displaySize.h}
                resultLabel={t('enhanceLab.enhanced', '增强后')}
              />
            ) : imageUrl ? (
              <img
                src={imageUrl}
                alt={t('enhanceLab.original', '原图')}
                style={{
                  width: displaySize.w,
                  height: displaySize.h,
                  objectFit: 'contain',
                  borderRadius: 'var(--radius-md)',
                }}
              />
            ) : null}
          </div>

          {/* 右侧：参数面板 */}
          <div className="enhance-params-panel">
            <div className="form-group">
              <label className="form-label">{t('enhanceLab.processMode', '处理模式')}</label>
              <select className="form-select" value={mode} onChange={(e) => setMode(e.target.value as EnhanceMode)} disabled={isProcessing}>
                <option value="sharpen">{t('enhanceLab.modeSharpen', '锐化')}</option>
                <option value="denoise">{t('enhanceLab.modeDenoise', '去噪')}</option>
                <option value="upscale">{t('enhanceLab.modeUpscale', '超分放大')}</option>
                <option value="all">{t('enhanceLab.modeAll', '综合增强（推荐）')}</option>
              </select>
            </div>

            {(mode === 'upscale' || mode === 'all') && (
              <div className="form-group">
                <label className="form-label">{t('enhanceLab.scaleFactor', '放大倍数')}</label>
                <select className="form-select" value={scale} onChange={(e) => setScale(Number(e.target.value) as ImageScale)} disabled={isProcessing}>
                  <option value={1}>{t('enhanceLab.scale1x', '1x（不放大）')}</option>
                  <option value={2}>{t('enhanceLab.scale2x', '2x（推荐）')}</option>
                  <option value={3}>{t('enhanceLab.scale3x', '3x')}</option>
                  <option value={4}>{t('enhanceLab.scale4x', '4x')}</option>
                </select>
              </div>
            )}

            {(mode === 'sharpen' || mode === 'all') && (
              <EnhanceParamSlider
                label={t('enhanceLab.sharpenStrength', '锐化强度')}
                value={sharpen}
                disabled={isProcessing}
                tooltip={t('enhanceLab.sharpenTooltip', 'USM 锐化：增强边缘对比度，适合发糊照片')}
                onChange={setSharpen}
              />
            )}

            {(mode === 'denoise' || mode === 'all') && (
              <EnhanceParamSlider
                label={t('enhanceLab.denoiseStrength', '去噪强度')}
                value={denoise}
                disabled={isProcessing}
                tooltip={t('enhanceLab.denoiseTooltip', '双边滤波：保边平滑，去除压缩噪点')}
                onChange={setDenoise}
              />
            )}

            <div className="form-group">
              <label className="form-label">{t('enhanceLab.outputFormat', '输出格式')}</label>
              <select className="form-select" value={outputFormat} onChange={(e) => setOutputFormat(e.target.value as ImageOutputFormat)} disabled={isProcessing}>
                <option value="png">{t('enhanceLab.formatPng', 'PNG（无损）')}</option>
                <option value="jpeg">{t('enhanceLab.formatJpeg', 'JPG（压缩 85%）')}</option>
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
                onSaveToLibrary={handleSaveToLibrary}
                onReset={() => { reset(); }}
              />
            </EnhanceAsyncWrapper>

            {isProcessing && <EnhanceProgressBar progress={progress} />}

            <button
              className="btn btn-secondary"
              style={{ marginTop: '0.5rem', fontSize: '0.75rem' }}
              onClick={() => { setFile(null); setImageUrl(null); reset(); }}
            >
              {t('enhanceLab.changeImage', '更换图片')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
