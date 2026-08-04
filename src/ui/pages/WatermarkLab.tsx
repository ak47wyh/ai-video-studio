import React, { useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Eraser, Image as ImageIcon, FileText, Film, Upload, Download, Trash2, Undo2, Redo2, Wand2, Loader2, X, Save, Link2, Plus, Grid3x3, AlertCircle, CheckCircle2, XCircle, Layers } from 'lucide-react';
import { LabPageLayout } from '../components/LabPageLayout';
import { AsyncState } from '../components/AsyncState';
import { RegionSelector, type SelectionMode } from '../components/watermark/RegionSelector';
import { useWatermarkRemoval } from '../hooks/useWatermarkRemoval';
import { useBatchImageInpaint } from '../hooks/useBatchImageInpaint';
import { useToast } from '../contexts/ToastContext';
import { useSpace } from '../contexts/SpaceContext';
import { assetLibraryService, videoAddressResolver, pdfRenderPort } from '../../dependencies';
import type { InpaintRegion, InpaintAlgorithm, VideoInpaintMode } from '../../domain/ports/WatermarkRemovalPorts';
import { detectVideoAddressType, fetchVideoAsFile } from '../utils/videoAddress';
import './WatermarkLab.css';

type LabTab = 'image' | 'pdf' | 'video';

const TABS = [
  { key: 'image' as LabTab, labelKey: 'watermarkLab.tabImage', icon: <ImageIcon size={14} /> },
  { key: 'pdf' as LabTab, labelKey: 'watermarkLab.tabPdf', icon: <FileText size={14} /> },
  { key: 'video' as LabTab, labelKey: 'watermarkLab.tabVideo', icon: <Film size={14} /> },
];

const MAX_DIMENSION = 600;

export const WatermarkLab: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<LabTab>('image');

  const tabs = TABS.map(tab => ({ ...tab, label: t(tab.labelKey) }));

  return (
    <LabPageLayout
      icon={<Eraser size={22} />}
      iconBg="color-mix(in srgb, var(--lab-color-watermark) 10%, transparent)"
      iconColor="var(--lab-color-watermark)"
      title={t('watermarkLab.title', '去水印实验室')}
      subtitle={t('watermarkLab.subtitle', '浏览器端本地处理 · 图片 / PDF / 视频去水印 · 隐私安全零上传')}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={(tab) => setActiveTab(tab as LabTab)}
    >
      {activeTab === 'image' && <BatchImageWatermarkPanel />}
      {activeTab === 'pdf' && <PdfWatermarkPanel />}
      {activeTab === 'video' && <VideoWatermarkPanel />}
    </LabPageLayout>
  );
};

// ==================== 批量图片去水印面板 ====================
const BatchImageWatermarkPanel: React.FC = () => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { currentSpaceId } = useSpace();
  const batch = useBatchImageInpaint();
  const [mode, setMode] = useState<SelectionMode>('rect');
  const [brushSize, setBrushSize] = useState(30);
  const [history, setHistory] = useState<InpaintRegion[][]>([]);
  const [redoStack, setRedoStack] = useState<InpaintRegion[][]>([]);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 第一张图作为统一选区编辑的基准
  const baseTask = batch.tasks[0];

  const handleFileSelect = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    batch.addFiles(Array.from(files));
  }, [batch]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) batch.addFiles(files);
  };

  const handleRegionsChange = (newRegions: InpaintRegion[]) => {
    setHistory(prev => [...prev, batch.unifiedRegions]);
    setRedoStack([]);
    batch.setUnifiedRegions(newRegions);
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setRedoStack(r => [...r, batch.unifiedRegions]);
    batch.setUnifiedRegions(prev);
    setHistory(h => h.slice(0, -1));
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setHistory(h => [...h, batch.unifiedRegions]);
    batch.setUnifiedRegions(next);
    setRedoStack(r => r.slice(0, -1));
  };

  const handleDownloadOne = (taskId: string) => {
    const task = batch.tasks.find(task => task.id === taskId);
    if (!task?.resultBlob) return;
    const url = URL.createObjectURL(task.resultBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inpaint_${task.file.name}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadAll = () => {
    const successTasks = batch.tasks.filter(task => task.state === 'success' && task.resultBlob);
    successTasks.forEach((task, idx) => {
      setTimeout(() => {
        const url = URL.createObjectURL(task.resultBlob!);
        const a = document.createElement('a');
        a.href = url;
        a.download = `inpaint_${task.file.name}`;
        a.click();
        URL.revokeObjectURL(url);
      }, idx * 200);
    });
    showToast('success', t('watermarkLab.batchDownloadStart', '开始下载 {{count}} 张图片', { count: successTasks.length }));
  };

  const handleSaveAllToLibrary = async () => {
    if (!currentSpaceId) return;
    const successTasks = batch.tasks.filter(task => task.state === 'success' && task.resultBlob);
    let saved = 0;
    for (const task of successTasks) {
      try {
        await assetLibraryService.saveImageFromBlob({
          spaceId: currentSpaceId,
          name: `${t('watermarkLab.watermarkPrefix', '去水印')}_${task.file.name}`,
          blob: task.resultBlob!,
          prompt: t('watermarkLab.batchProcessDesc', '批量去水印处理'),
          model: 'inpaint-local',
          aspectRatio: `${task.naturalSize.w}:${task.naturalSize.h}`,
          tags: [t('watermarkLab.watermarkPrefix', '去水印'), t('watermarkLab.batchTag', '批量')],
          sourceType: 'lab',
        });
        saved++;
      } catch {
        // 跳过失败的
      }
    }
    showToast(saved > 0 ? 'success' : 'error', t('watermarkLab.savedCount', '已保存 {{count}} 张到素材库', { count: saved }));
  };

  // 单独编辑模态
  const editingTask = editingTaskId ? batch.tasks.find(task => task.id === editingTaskId) : null;

  return (
    <div className="watermark-panel">
      {/* 上传区 / 任务列表 */}
      {batch.tasks.length === 0 ? (
        <div
          className="watermark-upload-zone"
          role="button"
          tabIndex={0}
          aria-label={t('watermarkLab.imageUploadHint', '拖拽图片到此处或点击上传（支持多选）')}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
        >
          <Upload size={40} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
            {t('watermarkLab.imageUploadHint', '拖拽图片到此处或点击上传（支持多选）')}
          </p>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', opacity: 0.7 }}>
            {t('watermarkLab.imageUploadHint2', '支持 JPG / PNG / WEBP / BMP · 可批量选择 · 最大 4096×4096 · 最大 20MB/张')}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => handleFileSelect(e.target.files)}
          />
        </div>
      ) : (
        <div className="watermark-editor-layout">
          {/* 左侧：统一选区编辑 / 任务列表 */}
          <div className="watermark-canvas-area">
            {/* 统一选区编辑（基于第一张图） */}
            {baseTask && (
              <div className="batch-unified-section">
                <div className="batch-section-title">
                  <Layers size={14} />
                  {t('watermarkLab.unifiedRegionTitle', '统一水印选区（基于首图 · 应用到全部）')}
                  {batch.tasks.some(task => task.regions) && (
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                      · {batch.tasks.filter(task => task.regions).length} {t('watermarkLab.individuallyAdjusted', '张已单独调整')}
                    </span>
                  )}
                </div>
                <RegionSelector
                  displayWidth={baseTask.displaySize.w}
                  displayHeight={baseTask.displaySize.h}
                  naturalWidth={baseTask.naturalSize.w}
                  naturalHeight={baseTask.naturalSize.h}
                  regions={batch.unifiedRegions}
                  onRegionsChange={handleRegionsChange}
                  mode={mode}
                  brushSize={brushSize}
                  imageSrc={baseTask.thumbnailUrl}
                  disabled={batch.isProcessing}
                />
                <div className="watermark-toolbar">
                  <button
                    className={`btn ${mode === 'rect' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
                    onClick={() => setMode('rect')}
                  >
                    {t('watermarkLab.rectSelect', '矩形框选')}
                  </button>
                  <button
                    className={`btn ${mode === 'brush' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
                    onClick={() => setMode('brush')}
                  >
                    {t('watermarkLab.brushSelect', '涂抹')}
                  </button>
                  {mode === 'brush' && (
                    <input
                      type="range"
                      min={5}
                      max={100}
                      value={brushSize}
                      onChange={(e) => setBrushSize(Number(e.target.value))}
                      style={{ width: 80 }}
                    />
                  )}
                  <button className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }} onClick={handleUndo} disabled={history.length === 0} aria-label={t('watermarkLab.undo', '撤销')}>
                    <Undo2 size={14} aria-hidden="true" />
                  </button>
                  <button className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }} onClick={handleRedo} disabled={redoStack.length === 0} aria-label={t('watermarkLab.redo', '重做')}>
                    <Redo2 size={14} aria-hidden="true" />
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', color: 'var(--color-danger)' }}
                    onClick={() => { batch.setUnifiedRegions([]); setHistory([]); setRedoStack([]); }}
                  >
                    <Trash2 size={14} /> {t('watermarkLab.clearSelection', '清除选区')}
                  </button>
                </div>
              </div>
            )}

            {/* 任务列表网格 */}
            <div className="batch-section-title" style={{ marginTop: '1rem' }}>
              <Grid3x3 size={14} />
              {t('watermarkLab.taskListSummary', '任务列表（{{total}} 张 · 成功 {{success}} · 失败 {{failed}}）', { total: batch.tasks.length, success: batch.completedCount, failed: batch.failedCount })}
            </div>
            <div className="batch-task-grid">
              {batch.tasks.map(task => (
                <div
                  key={task.id}
                  className={`batch-task-card ${task.state}`}
                  onClick={() => !batch.isProcessing && setEditingTaskId(task.id)}
                >
                  <div className="batch-task-thumb">
                    <img src={task.thumbnailUrl} alt={task.file.name} />
                    {task.state === 'processing' && (
                      <div className="batch-task-overlay" role="status" aria-live="polite">
                        <Loader2 size={20} className="spin" aria-hidden="true" />
                        <span>{Math.round(task.progress * 100)}%</span>
                      </div>
                    )}
                    {task.state === 'success' && (
                      <div className="batch-task-overlay success">
                        <CheckCircle2 size={20} />
                      </div>
                    )}
                    {task.state === 'error' && (
                      <div className="batch-task-overlay error">
                        <XCircle size={20} />
                      </div>
                    )}
                    {task.regions && (
                      <div className="batch-task-badge" title={t('watermarkLab.individuallyAdjustedTitle', '已单独调整选区')}>{t('watermarkLab.individualBadge', '单独')}</div>
                    )}
                  </div>
                  <div className="batch-task-name" title={task.file.name}>{task.file.name}</div>
                  {task.state === 'success' && task.resultUrl && (
                    <button
                      className="btn btn-secondary batch-download-btn"
                      style={{ fontSize: '0.7rem', padding: '0.2rem 0.4rem' }}
                      onClick={(e) => { e.stopPropagation(); handleDownloadOne(task.id); }}
                    >
                      <Download size={12} /> {t('watermarkLab.download', '下载')}
                    </button>
                  )}
                </div>
              ))}
              {/* 添加更多 */}
              <div
                className="batch-add-card"
                role="button"
                tabIndex={0}
                aria-label={t('watermarkLab.addImages', '添加图片')}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
              >
                <Plus size={24} />
                <span style={{ fontSize: '0.7rem' }}>{t('watermarkLab.addImages', '添加图片')}</span>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => handleFileSelect(e.target.files)}
              />
            </div>
          </div>

          {/* 右侧：参数面板 */}
          <div className="watermark-params-panel">
            <div className="form-group">
              <label className="form-label">{t('watermarkLab.algorithm', '去水印算法')}</label>
              <select
                className="form-select"
                value={batch.algorithm}
                onChange={(e) => batch.setAlgorithm(e.target.value as InpaintAlgorithm)}
                disabled={batch.isProcessing}
              >
                <option value="fast_fill">{t('watermarkLab.algoFastFill', '快速填充（纯色背景）')}</option>
                <option value="edge_interpolation">{t('watermarkLab.algoEdgeInterpolation', '边缘插值（推荐）')}</option>
                <option value="texture_synthesis">{t('watermarkLab.algoTextureSynthesis', '纹理合成（复杂背景）')}</option>
                <option value="telea">{t('watermarkLab.algoTelea', 'Telea 快速行进法')}</option>
                <option value="navier_stokes">{t('watermarkLab.algoNavierStokes', 'Navier-Stokes 流体扩散')}</option>
                <option value="content_aware">{t('watermarkLab.algoContentAware', '内容感知填充（质量最高）')}</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">{t('watermarkLab.concurrency', '并发数')}</label>
              <select
                className="form-select"
                value={batch.concurrency}
                onChange={(e) => batch.setConcurrency(Number(e.target.value))}
                disabled={batch.isProcessing}
              >
                <option value={1}>{t('watermarkLab.concurrency1', '1（串行，最稳定）')}</option>
                <option value={3}>{t('watermarkLab.concurrency3', '3（推荐）')}</option>
                <option value={5}>{t('watermarkLab.concurrency5', '5（最快，占内存大）')}</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">{t('watermarkLab.unifiedRegions', '统一选区')}</label>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {batch.unifiedRegions.length} {t('watermarkLab.regionsCount', '个区域')}
              </div>
            </div>

            {/* 进度统计 */}
            {batch.isProcessing && (
              <div className="watermark-retry-hint" style={{ color: 'var(--text-secondary)' }} role="status" aria-live="polite">
                {t('watermarkLab.processingProgress', '处理中... {{completed}}/{{total}}', { completed: batch.completedCount, total: batch.tasks.length })}
              </div>
            )}

            <button
              className="btn btn-primary btn-generate"
              disabled={batch.unifiedRegions.length === 0 || batch.isProcessing || batch.tasks.length === 0}
              onClick={batch.processAll}
            >
              {batch.isProcessing ? <Loader2 size={18} className="spin" /> : <Wand2 size={18} />}
              {batch.isProcessing ? t('watermarkLab.processing', '处理中...') : t('watermarkLab.batchRemoveWatermark', '批量去水印（{{count}}张）', { count: batch.tasks.length })}
            </button>

            {batch.isProcessing && (
              <button className="btn btn-secondary" style={{ marginTop: '0.5rem' }} onClick={batch.cancel}>
                <X size={14} /> {t('common.cancel', '取消')}
              </button>
            )}

            {batch.failedCount > 0 && !batch.isProcessing && (
              <button className="btn btn-secondary" style={{ marginTop: '0.5rem' }} onClick={batch.retryFailed}>
                <Wand2 size={14} /> {t('watermarkLab.retryFailed', '重试失败（{{count}}张）', { count: batch.failedCount })}
              </button>
            )}

            {batch.completedCount > 0 && !batch.isProcessing && (
              <>
                <button className="btn btn-primary btn-generate" style={{ marginTop: '0.5rem' }} onClick={handleDownloadAll}>
                  <Download size={16} /> {t('watermarkLab.downloadAll', '全部下载')}
                </button>
                <button className="btn btn-secondary" style={{ marginTop: '0.5rem' }} onClick={handleSaveAllToLibrary}>
                  <Save size={16} /> {t('watermarkLab.saveAllToLibrary', '全部保存到素材库')}
                </button>
              </>
            )}

            <button
              className="btn btn-secondary"
              style={{ marginTop: '0.5rem', fontSize: '0.75rem' }}
              onClick={batch.clearAll}
            >
              {t('watermarkLab.clearAll', '清空全部')}
            </button>
          </div>
        </div>
      )}

      {/* 单独编辑模态 */}
      {editingTask && (
        <div
          className="batch-edit-modal"
          role="dialog"
          aria-modal="true"
          aria-label={`${t('watermarkLab.editIndividualRegion', '单独编辑选区')} - ${editingTask.file.name}`}
          onClick={() => setEditingTaskId(null)}
          onKeyDown={(e) => { if (e.key === 'Escape') setEditingTaskId(null); }}
        >
          <div className="batch-edit-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="batch-edit-modal-header">
              <span>{t('watermarkLab.editIndividualRegion', '单独编辑选区')} - {editingTask.file.name}</span>
              <button className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.2rem 0.4rem' }} onClick={() => setEditingTaskId(null)} aria-label={t('common.close', '关闭')}>
                <X size={14} aria-hidden="true" />
              </button>
            </div>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 300 }}>
                <RegionSelector
                  displayWidth={editingTask.displaySize.w}
                  displayHeight={editingTask.displaySize.h}
                  naturalWidth={editingTask.naturalSize.w}
                  naturalHeight={editingTask.naturalSize.h}
                  regions={batch.getEffectiveRegions(editingTask.id)}
                  onRegionsChange={(r) => batch.setTaskRegions(editingTask.id, r)}
                  mode={mode}
                  brushSize={brushSize}
                  imageSrc={editingTask.thumbnailUrl}
                />
              </div>
              <div style={{ width: 200, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {t('watermarkLab.currentRegions', '当前选区：{{count}} 个区域', { count: batch.getEffectiveRegions(editingTask.id).length })}
                </div>
                {editingTask.regions && (
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: '0.75rem' }}
                    onClick={() => batch.clearTaskRegions(editingTask.id)}
                  >
                    {t('watermarkLab.restoreUnified', '恢复为统一选区')}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ==================== PDF 去水印面板 ====================
const PdfWatermarkPanel: React.FC = () => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const {
    progress, isProcessing, error, resultUrl, resultBlob,
    processPdf, cancel, reset, retry, retryCount, isFallbackRetry,
  } = useWatermarkRemoval();
  const [file, setFile] = useState<File | null>(null);
  const [firstPageUrl, setFirstPageUrl] = useState<string | null>(null);
  const [regions, setRegions] = useState<InpaintRegion[]>([]);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [displaySize, setDisplaySize] = useState({ w: 400, h: 560 });
  const [mode, setMode] = useState<SelectionMode>('rect');
  const [dpi, setDpi] = useState(150);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (f: File) => {
    if (f.type !== 'application/pdf') {
      showToast('error', t('watermarkLab.selectPdf', '请选择 PDF 文件'));
      return;
    }
    setFile(f);
    setRegions([]);
    reset();
    try {
      // Phase 2 DIP：通过 pdfRenderPort 隔离 pdfjs-dist CDN 加载
      const { width, height, dataUrl } = await pdfRenderPort.renderFirstPage(f);
      setNaturalSize({ w: width, h: height });
      const ratio = width / height;
      const dh = MAX_DIMENSION;
      const dw = dh * ratio;
      setDisplaySize({ w: Math.round(dw), h: Math.round(dh) });
      setFirstPageUrl(dataUrl);
    } catch (_e) {
      showToast('error', t('watermarkLab.pdfPreviewFailed', 'PDF 预览失败'));
    }
  };

  const handleProcess = () => {
    if (!file || regions.length === 0) return;
    processPdf(file, regions, dpi);
  };

  const handleDownload = () => {
    if (!resultBlob) return;
    const url = URL.createObjectURL(resultBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `watermark_removed_${file?.name || 'result.pdf'}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="watermark-panel">
      {!file ? (
        <div
          className="watermark-upload-zone"
          role="button"
          tabIndex={0}
          aria-label={t('watermarkLab.pdfUploadHint', '拖拽 PDF 到此处或点击上传')}
          onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files[0]) handleFileSelect(e.dataTransfer.files[0]); }}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
        >
          <Upload size={40} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>{t('watermarkLab.pdfUploadHint', '拖拽 PDF 到此处或点击上传')}</p>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', opacity: 0.7 }}>
            {t('watermarkLab.pdfUploadHint2', '支持标准 PDF · 最大 50 页 · 最大 50MB')}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            style={{ display: 'none' }}
            onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
          />
        </div>
      ) : (
        <div className="watermark-editor-layout">
          <div className="watermark-canvas-area">
            {resultUrl ? (
              <iframe src={resultUrl} style={{ width: displaySize.w, height: displaySize.h, border: 'none' }} title="PDF Result" />
            ) : firstPageUrl ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <RegionSelector
                  displayWidth={displaySize.w}
                  displayHeight={displaySize.h}
                  naturalWidth={naturalSize.w}
                  naturalHeight={naturalSize.h}
                  regions={regions}
                  onRegionsChange={setRegions}
                  mode={mode}
                  brushSize={30}
                  imageSrc={firstPageUrl}
                />
                <div className="watermark-toolbar">
                  <button className={`btn ${mode === 'rect' ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }} onClick={() => setMode('rect')}>{t('watermarkLab.rectSelect', '矩形框选')}</button>
                  <button className={`btn ${mode === 'brush' ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }} onClick={() => setMode('brush')}>{t('watermarkLab.brushSelect', '涂抹')}</button>
                  <button className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', color: '#ef4444' }} onClick={() => setRegions([])}>
                    <Trash2 size={14} /> {t('watermarkLab.clear', '清除')}
                  </button>
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {t('watermarkLab.pdfRegionHint', '提示：框选的水印区域将应用到所有页（全页统一模式）')}
                </p>
              </div>
            ) : (
              <AsyncState loading emptyText={t('watermarkLab.loadingPreview', '加载预览...')} minHeight={300} />
            )}
          </div>

          <div className="watermark-params-panel">
            <div className="form-group">
              <label className="form-label">{t('watermarkLab.renderDpi', '渲染分辨率 (DPI)')}</label>
              <select className="form-select" value={dpi} onChange={(e) => setDpi(Number(e.target.value))} disabled={isProcessing}>
                <option value={96}>{t('watermarkLab.dpi96', '96 (快速)')}</option>
                <option value={150}>{t('watermarkLab.dpi150', '150 (推荐)')}</option>
                <option value={300}>{t('watermarkLab.dpi300', '300 (高清)')}</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">{t('watermarkLab.selectedRegions', '已选区域')}</label>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{regions.length} {t('watermarkLab.regionsCount', '个区域')}</div>
            </div>
            {retryCount > 0 && isProcessing && (
              <div className="watermark-retry-hint">
                {isFallbackRetry ? t('watermarkLab.fallbackRetry', '主算法失败，正在尝试备选算法') : t('watermarkLab.retrying', '正在重试 · 第 {{count}} 次尝试', { count: retryCount + 1 })}
              </div>
            )}
            <AsyncState loading={isProcessing} loadingText={t('watermarkLab.processingPercent', '处理中... {{percent}}%', { percent: Math.round(progress * 100) })} error={error} onRetry={retry} minHeight={80}>
              {!resultUrl ? (
                <>
                  <button className="btn btn-primary btn-generate" disabled={regions.length === 0 || isProcessing} onClick={handleProcess}>
                    {isProcessing ? <Loader2 size={18} className="spin" /> : <Wand2 size={18} />}
                    {isProcessing ? t('watermarkLab.processing', '处理中...') : t('watermarkLab.startRemoveWatermark', '开始去水印')}
                  </button>
                  {isProcessing && <button className="btn btn-secondary" style={{ marginTop: '0.5rem' }} onClick={cancel}><X size={14} /> {t('common.cancel', '取消')}</button>}
                </>
              ) : (
                <>
                  <button className="btn btn-primary btn-generate" onClick={handleDownload}><Download size={18} /> {t('watermarkLab.downloadPdf', '下载 PDF')}</button>
                  <button className="btn btn-secondary" style={{ marginTop: '0.5rem' }} onClick={() => { reset(); setRegions([]); }}><Trash2 size={16} /> {t('watermarkLab.reprocess', '重新处理')}</button>
                </>
              )}
            </AsyncState>
            {isProcessing && (
              <div className="watermark-progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}><div className="watermark-progress-bar" style={{ width: `${progress * 100}%` }} /></div>
            )}
            <button className="btn btn-secondary" style={{ marginTop: '0.5rem', fontSize: '0.75rem' }} onClick={() => { setFile(null); setFirstPageUrl(null); setRegions([]); reset(); }}>
              {t('watermarkLab.changePdf', '更换 PDF')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ==================== 视频去水印面板 ====================
type VideoInputMode = 'address' | 'upload';

const VideoWatermarkPanel: React.FC = () => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { currentSpaceId } = useSpace();
  const {
    progress, isProcessing, error, resultUrl, resultBlob,
    processVideo, cancel, reset, retry, retryCount, isFallbackRetry,
  } = useWatermarkRemoval();

  const [inputMode, setInputMode] = useState<VideoInputMode>('address');
  const [address, setAddress] = useState('');
  const [addressLoading, setAddressLoading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [firstFrameUrl, setFirstFrameUrl] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [displaySize, setDisplaySize] = useState({ w: 480, h: 270 });
  const [regions, setRegions] = useState<InpaintRegion[]>([]);
  const [mode, setMode] = useState<SelectionMode>('rect');
  const [videoMode, setVideoMode] = useState<VideoInpaintMode>('fast');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadVideoFile = useCallback((f: File) => {
    if (!f.type.startsWith('video/')) {
      showToast('error', t('watermarkLab.selectVideo', '请选择视频文件'));
      return;
    }
    setFile(f);
    const url = URL.createObjectURL(f);
    setRegions([]);
    reset();

    const video = document.createElement('video');
    video.src = url;
    video.onloadedmetadata = () => {
      setNaturalSize({ w: video.videoWidth, h: video.videoHeight });
      const ratio = video.videoWidth / video.videoHeight;
      const dw = MAX_DIMENSION;
      const dh = dw / ratio;
      setDisplaySize({ w: Math.round(dw), h: Math.round(dh) });
    };
    video.onloadeddata = () => {
      video.currentTime = 0;
    };
    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(video, 0, 0);
      setFirstFrameUrl(canvas.toDataURL('image/png'));
    };
  }, [reset, showToast, t]);

  const handleAddressResolve = async () => {
    const trimmed = address.trim();
    if (!trimmed) {
      showToast('error', t('watermarkLab.enterVideoAddress', '请输入视频地址'));
      return;
    }

    const addrType = detectVideoAddressType(trimmed);
    setAddressLoading(true);

    try {
      if (addrType === 'direct') {
        // 直链：fetch 下载为 File
        showToast('info', t('watermarkLab.downloadingVideo', '正在下载视频...'));
        const videoFile = await fetchVideoAsFile(trimmed);
        loadVideoFile(videoFile);
        showToast('success', t('watermarkLab.videoDownloaded', '视频下载完成'));
      } else if (addrType === 'share') {
        // 平台分享链接：调用解析端口（当前为未实现）
        try {
          const resolved = await videoAddressResolver.resolve(trimmed);
          // 解析成功后下载直链
          showToast('info', t('watermarkLab.resolvedDownloading', '解析成功，正在下载...'));
          const videoFile = await fetchVideoAsFile(resolved.directUrl);
          loadVideoFile(videoFile);
          showToast('success', t('watermarkLab.videoDownloaded', '视频下载完成'));
        } catch (e) {
          showToast('error', e instanceof Error ? e.message : t('watermarkLab.addressResolveFailed', '地址解析失败'));
        }
      } else {
        // 本地文件路径：浏览器无法直接读取
        showToast('warning', t('watermarkLab.localPathNotSupported', '浏览器安全限制无法直接读取本地路径，请使用上传方式'));
        setInputMode('upload');
      }
    } catch (e) {
      if (e instanceof TypeError && e.message.includes('Failed to fetch')) {
        showToast('error', t('watermarkLab.downloadFailedCors', '下载失败：跨域限制，请尝试下载后上传'));
      } else {
        showToast('error', e instanceof Error ? e.message : t('watermarkLab.addressProcessFailed', '地址处理失败'));
      }
    } finally {
      setAddressLoading(false);
    }
  };

  const handleFileSelect = (f: File) => {
    loadVideoFile(f);
  };

  const handleProcess = () => {
    if (!file || regions.length === 0) return;
    // 涂抹模式强制使用高质量模式
    processVideo(file, regions, effectiveVideoMode);
  };

  const handleDownload = () => {
    if (!resultBlob) return;
    const url = URL.createObjectURL(resultBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `watermark_removed_${file?.name || 'result.mp4'}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveToLibrary = async () => {
    if (!resultBlob || !currentSpaceId || !file) return;
    try {
      await assetLibraryService.saveVideoFromBlob({
        spaceId: currentSpaceId,
        name: `${t('watermarkLab.watermarkPrefix', '去水印')}_${file.name.replace(/\.[^.]+$/, '')}`,
        blob: resultBlob,
        durationSec: 0,
        width: naturalSize.w || undefined,
        height: naturalSize.h || undefined,
        mimeType: 'video/mp4',
        tags: [t('watermarkLab.watermarkPrefix', '去水印')],
        sourceType: 'lab',
      });
      showToast('success', t('watermarkLab.savedToLibrary', '已保存到素材库'));
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : t('watermarkLab.saveFailed', '保存失败'));
    }
  };

  // 涂抹模式下强制使用高质量模式
  const effectiveVideoMode: VideoInpaintMode = mode === 'brush' ? 'quality' : videoMode;

  return (
    <div className="watermark-panel">
      {!file ? (
        <div className="video-input-section">
          {/* 输入方式切换 */}
          <div className="video-input-tabs">
            <button
              className={`btn ${inputMode === 'address' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '0.8rem' }}
              onClick={() => setInputMode('address')}
            >
              <Link2 size={14} /> {t('watermarkLab.pasteAddress', '粘贴地址')}
            </button>
            <button
              className={`btn ${inputMode === 'upload' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '0.8rem' }}
              onClick={() => setInputMode('upload')}
            >
              <Upload size={14} /> {t('watermarkLab.uploadFile', '上传文件')}
            </button>
          </div>

          {/* 地址输入 */}
          {inputMode === 'address' && (
            <div className="video-address-input">
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  className="form-select"
                  style={{ flex: 1 }}
                  placeholder={t('watermarkLab.addressPlaceholder', '粘贴视频直链（如 https://example.com/video.mp4）或平台分享链接')}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddressResolve()}
                  disabled={addressLoading}
                />
                <button
                  className="btn btn-primary"
                  disabled={addressLoading || !address.trim()}
                  onClick={handleAddressResolve}
                >
                  {addressLoading ? <Loader2 size={16} className="spin" /> : <Link2 size={16} />}
                  {t('watermarkLab.resolve', '解析')}
                </button>
              </div>
              <div className="video-address-tips">
                <p>· <strong>{t('watermarkLab.directLinkLabel', '直链视频')}</strong>{t('watermarkLab.directLinkDesc', '（如 .mp4/.webm/.mov）：直接下载处理')}</p>
                <p>· <strong>{t('watermarkLab.shareLinkLabel', '平台分享链接')}</strong>{t('watermarkLab.shareLinkDesc', '（抖音/B站等）：需后端解析服务，当前未实现')}</p>
                <p>· <strong>{t('watermarkLab.localPathLabel', '本地文件路径')}</strong>{t('watermarkLab.localPathDesc', '：浏览器安全限制无法直接读取，请使用上传方式')}</p>
              </div>
            </div>
          )}

          {/* 上传 */}
          {inputMode === 'upload' && (
            <div
              className="watermark-upload-zone"
              role="button"
              tabIndex={0}
              aria-label={t('watermarkLab.videoUploadHint', '拖拽视频到此处或点击上传')}
              onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files[0]) handleFileSelect(e.dataTransfer.files[0]); }}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
            >
              <Upload size={40} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
              <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>{t('watermarkLab.videoUploadHint', '拖拽视频到此处或点击上传')}</p>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', opacity: 0.7 }}>
                {t('watermarkLab.videoUploadHint2', '支持 MP4 / WebM / MOV · 最大 10 分钟 · 最大 200MB')}
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                style={{ display: 'none' }}
                onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="watermark-editor-layout">
          <div className="watermark-canvas-area">
            {resultUrl ? (
              <video src={resultUrl} controls style={{ width: displaySize.w, height: displaySize.h, borderRadius: 'var(--radius-md)' }} />
            ) : firstFrameUrl ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <RegionSelector
                  displayWidth={displaySize.w}
                  displayHeight={displaySize.h}
                  naturalWidth={naturalSize.w}
                  naturalHeight={naturalSize.h}
                  regions={regions}
                  onRegionsChange={setRegions}
                  mode={mode}
                  brushSize={30}
                  imageSrc={firstFrameUrl}
                />
                <div className="watermark-toolbar">
                  <button className={`btn ${mode === 'rect' ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }} onClick={() => setMode('rect')}>{t('watermarkLab.rectSelect', '矩形框选')}</button>
                  <button className={`btn ${mode === 'brush' ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }} onClick={() => setMode('brush')}>{t('watermarkLab.brushSelect', '涂抹')}</button>
                  <button className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', color: '#ef4444' }} onClick={() => setRegions([])}>
                    <Trash2 size={14} /> {t('watermarkLab.clear', '清除')}
                  </button>
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {t('watermarkLab.videoRegionHint', '提示：框选水印位置，将应用到视频所有帧（静态水印模式）')}
                </p>
              </div>
            ) : (
              <AsyncState loading emptyText={t('watermarkLab.loadingVideoPreview', '加载视频预览...')} minHeight={300} />
            )}
          </div>

          <div className="watermark-params-panel">
            <div className="form-group">
              <label className="form-label">{t('watermarkLab.selectedRegions', '已选区域')}</label>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{regions.length} {t('watermarkLab.regionsCount', '个区域')}</div>
            </div>

            {/* 处理方式选择 */}
            <div className="form-group">
              <label className="form-label">{t('watermarkLab.processMode', '处理方式')}</label>
              <div className="video-mode-select">
                <label className={`video-mode-option ${mode === 'brush' ? 'disabled' : ''}`}>
                  <input
                    type="radio"
                    name="videoMode"
                    value="fast"
                    checked={videoMode === 'fast'}
                    onChange={() => setVideoMode('fast')}
                    disabled={mode === 'brush'}
                  />
                  <div className="video-mode-content">
                    <div className="video-mode-title">{t('watermarkLab.fastMode', '快速模式')}</div>
                    <div className="video-mode-desc">{t('watermarkLab.fastModeDesc', 'delogo 滤镜单次处理 · 速度快 · 仅矩形')}</div>
                  </div>
                </label>
                <label className="video-mode-option">
                  <input
                    type="radio"
                    name="videoMode"
                    value="quality"
                    checked={videoMode === 'quality'}
                    onChange={() => setVideoMode('quality')}
                  />
                  <div className="video-mode-content">
                    <div className="video-mode-title">{t('watermarkLab.qualityMode', '高质量模式')}</div>
                    <div className="video-mode-desc">{t('watermarkLab.qualityModeDesc', '逐帧精修 · 支持涂抹 · 速度较慢')}</div>
                  </div>
                </label>
              </div>
              {mode === 'brush' && (
                <div className="watermark-retry-hint" style={{ fontSize: '0.7rem' }}>
                  <AlertCircle size={12} style={{ display: 'inline' }} /> {t('watermarkLab.brushQualityOnly', '涂抹模式仅支持高质量处理')}
                </div>
              )}
            </div>

            {retryCount > 0 && isProcessing && (
              <div className="watermark-retry-hint">
                {isFallbackRetry ? t('watermarkLab.fallbackRetry', '主算法失败，正在尝试备选算法') : t('watermarkLab.retrying', '正在重试 · 第 {{count}} 次尝试', { count: retryCount + 1 })}
              </div>
            )}
            <AsyncState loading={isProcessing} loadingText={t('watermarkLab.processingPercent', '处理中... {{percent}}%', { percent: Math.round(progress * 100) })} error={error} onRetry={retry} minHeight={80}>
              {!resultUrl ? (
                <>
                  <button className="btn btn-primary btn-generate" disabled={regions.length === 0 || isProcessing} onClick={handleProcess}>
                    {isProcessing ? <Loader2 size={18} className="spin" /> : <Wand2 size={18} />}
                    {isProcessing ? t('watermarkLab.processing', '处理中...') : t('watermarkLab.startRemoveWatermark', '开始去水印')}
                  </button>
                  {isProcessing && <button className="btn btn-secondary" style={{ marginTop: '0.5rem' }} onClick={cancel}><X size={14} /> {t('common.cancel', '取消')}</button>}
                </>
              ) : (
                <>
                  <button className="btn btn-primary btn-generate" onClick={handleDownload}><Download size={18} /> {t('watermarkLab.downloadVideo', '下载视频')}</button>
                  <button className="btn btn-secondary" style={{ marginTop: '0.5rem' }} onClick={handleSaveToLibrary}><Save size={16} /> {t('watermarkLab.saveToLibrary', '保存到素材库')}</button>
                  <button className="btn btn-secondary" style={{ marginTop: '0.5rem' }} onClick={() => { reset(); setRegions([]); }}><Trash2 size={16} /> {t('watermarkLab.reprocess', '重新处理')}</button>
                </>
              )}
            </AsyncState>
            {isProcessing && (
              <div className="watermark-progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}><div className="watermark-progress-bar" style={{ width: `${progress * 100}%` }} /></div>
            )}
            <button className="btn btn-secondary" style={{ marginTop: '0.5rem', fontSize: '0.75rem' }} onClick={() => { setFile(null); setFirstFrameUrl(null); setRegions([]); reset(); setAddress(''); }}>
              {t('watermarkLab.changeVideo', '更换视频')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
