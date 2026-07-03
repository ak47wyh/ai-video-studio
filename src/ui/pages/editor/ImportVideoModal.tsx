/**
 * ImportVideoModal —— 全局导入视频弹窗
 *
 * 提供两个导入方式：
 * - 本地上传：点击/拖拽选择文件，复用 useVideoImport
 * - 链接导入：粘贴直链或抖音分享链接，复用 useLinkImport
 *
 * 不依赖 storyId，导入视频直接保存到当前 spaceId 的素材库。
 * 导入成功后通过 onImported 回调通知父组件处理（加入时间线或仅入库）。
 */

import React, { useState } from 'react';
import { X, Link, Loader, RefreshCw, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useVideoImport } from '../../hooks/useVideoImport';
import { useLinkImport } from '../../hooks/useLinkImport';
import { VideoUploadField } from '../../components/VideoUploadField';
import type { SavedVideo } from '../../../domain/entities/models';

interface ImportVideoModalProps {
  open: boolean;
  onClose: () => void;
  spaceId: string;
  /** 导入成功回调，用于加入时间线或刷新列表 */
  onImported?: (video: SavedVideo) => void;
}

type ImportTab = 'upload' | 'link';

export const ImportVideoModal: React.FC<ImportVideoModalProps> = ({ open, onClose, spaceId, onImported }) => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<ImportTab>('upload');

  const videoImport = useVideoImport();
  const { state: importState, progress: importProgress, error: importError, importVideo } = videoImport;

  const linkImport = useLinkImport();
  const { state: linkState, progress: linkProgress, error: linkError, detectedPlatform, importFromUrl, reset: resetLinkImport } = linkImport;

  const [urlInput, setUrlInput] = useState('');

  const isImporting = ['validating', 'probing', 'extracting', 'saving'].includes(importState);
  const isLinkImporting = ['parsing', 'downloading', 'validating', 'probing', 'extracting', 'saving'].includes(linkState);

  if (!open) return null;

  const handleLocalFile = async (file: File) => {
    const result = await importVideo(file, spaceId);
    if (result) {
      onImported?.(result);
    }
  };

  const handleLinkImport = async () => {
    if (!urlInput.trim() || isLinkImporting) return;
    const result = await importFromUrl(urlInput, spaceId);
    if (result) {
      onImported?.(result);
      setUrlInput('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleLinkImport();
    }
  };

  const handleClose = () => {
    if (isImporting || isLinkImporting) return;
    videoImport.reset();
    resetLinkImport();
    setUrlInput('');
    setTab('upload');
    onClose();
  };

  const stateLabel: Record<string, string> = {
    parsing: t('editor.media.linkImport.parsing', '正在识别视频地址...'),
    downloading: t('editor.media.linkImport.downloading', '下载中'),
    validating: t('editor.media.linkImport.validating', '校验中'),
    probing: t('editor.media.linkImport.probing', '读取视频信息...'),
    extracting: t('editor.media.linkImport.extracting', '生成缩略图...'),
    saving: t('editor.media.linkImport.saving', '保存到素材库...'),
    success: t('editor.media.linkImport.success', '已导入'),
    error: '',
  };

  return (
    <div
      onClick={handleClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
      }}
    >
      <div
        className="glass-panel"
        onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 480, padding: '1.5rem', position: 'relative' }}
      >
        <button
          className="btn btn-secondary"
          style={{ position: 'absolute', top: '0.75rem', right: '0.75rem', padding: '0.3rem', border: 'none', background: 'transparent' }}
          onClick={handleClose}
          disabled={isImporting || isLinkImporting}
        >
          <X size={18} />
        </button>

        <h2 style={{ margin: '0 0 1rem', fontSize: '1.1rem' }}>
          {t('editor.media.import.title', '导入视频')}
        </h2>

        <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1rem' }}>
          <button
            onClick={() => setTab('upload')}
            style={{
              flex: 1, padding: '0.4rem', fontSize: '0.8rem',
              background: tab === 'upload' ? 'var(--primary-color)' : 'rgba(255,255,255,0.05)',
              color: tab === 'upload' ? '#fff' : 'var(--text-muted)',
              border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem',
            }}
          >
            <Upload size={12} /> {t('editor.media.upload', '本地上传')}
          </button>
          <button
            onClick={() => setTab('link')}
            style={{
              flex: 1, padding: '0.4rem', fontSize: '0.8rem',
              background: tab === 'link' ? 'var(--primary-color)' : 'rgba(255,255,255,0.05)',
              color: tab === 'link' ? '#fff' : 'var(--text-muted)',
              border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem',
            }}
          >
            <Link size={12} /> {t('editor.media.linkImport', '链接导入')}
          </button>
        </div>

        {tab === 'upload' && (
          <>
            <VideoUploadField onFile={handleLocalFile} disabled={isImporting} />

            {isImporting && (
              <div style={{
                background: 'rgba(255,255,255,0.04)', borderRadius: 'var(--radius-sm)',
                padding: '0.5rem', marginBottom: '0.5rem',
              }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                  {t('editor.media.import.uploading', '上传中')}
                </div>
                <div style={{ height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{ width: `${importProgress}%`, height: '100%', background: 'var(--primary-color)', transition: 'width 0.3s' }} />
                </div>
              </div>
            )}

            {importState === 'error' && importError && (
              <div style={{
                background: 'rgba(239,68,68,0.1)', borderRadius: 'var(--radius-sm)',
                padding: '0.5rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem',
              }}>
                <span style={{ fontSize: '0.7rem', color: '#ef9999', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {importError}
                </span>
                <button className="btn btn-secondary" style={{ fontSize: '0.65rem', padding: '0.15rem 0.4rem', flexShrink: 0 }} onClick={() => videoImport.reset()}>
                  {t('editor.media.import.retry', '重试')}
                </button>
              </div>
            )}

            {importState === 'success' && (
              <div style={{
                background: 'rgba(16,185,129,0.1)', borderRadius: 'var(--radius-sm)',
                padding: '0.5rem', marginBottom: '0.5rem',
              }}>
                ✓ {t('editor.media.import.success', '导入成功')}
              </div>
            )}
          </>
        )}

        {tab === 'link' && (
          <div style={{ marginBottom: '0.5rem' }}>
            <input
              type="text"
              placeholder={t('editor.media.linkImport.placeholder', '粘贴视频链接或分享链接...')}
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLinkImporting}
              maxLength={2048}
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '0.5rem 0.6rem',
                fontSize: '0.8rem',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                outline: 'none',
              }}
            />

            {detectedPlatform && !isLinkImporting && !(linkState === 'error') && (
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <span>检测到：{detectedPlatform}</span>
              </div>
            )}

            <button
              className="btn btn-primary"
              onClick={handleLinkImport}
              disabled={!urlInput.trim() || isLinkImporting}
              style={{ width: '100%', marginTop: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem', fontSize: '0.8rem' }}
            >
              {isLinkImporting ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <Loader size={12} className="spin" />
                  {stateLabel[linkState] || t('editor.media.linkImport.importing', '导入中')}
                </span>
              ) : linkState === 'error' ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <RefreshCw size={12} />
                  {t('editor.media.linkImport.retry', '重试')}
                </span>
              ) : (
                <span>{t('editor.media.linkImport.importBtn', '解析并导入')}</span>
              )}
            </button>

            {isLinkImporting && (
              <div style={{ marginTop: '0.5rem' }}>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>
                  {stateLabel[linkState]}
                </div>
                <div style={{ height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{ width: `${linkProgress}%`, height: '100%', background: 'var(--primary-color)', transition: 'width 0.3s' }} />
                </div>
              </div>
            )}

            {linkState === 'error' && linkError && (
              <div style={{
                marginTop: '0.5rem',
                padding: '0.4rem 0.5rem',
                background: 'rgba(239,68,68,0.1)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.7rem',
                color: '#ef9999',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.5rem',
              }}>
                <span style={{ flex: 1 }}>{linkError}</span>
                <button className="btn btn-secondary" style={{ fontSize: '0.6rem', padding: '0.1rem 0.3rem', flexShrink: 0 }} onClick={resetLinkImport}>
                  {t('editor.media.linkImport.clear', '清除')}
                </button>
              </div>
            )}

            {linkState === 'success' && (
              <div style={{
                marginTop: '0.5rem',
                padding: '0.4rem 0.5rem',
                background: 'rgba(16,185,129,0.1)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.7rem',
                color: '#10b981',
              }}>
                ✓ {t('editor.media.linkImport.success', '已导入')}
              </div>
            )}
          </div>
        )}

        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.5rem', textAlign: 'center' }}>
          {t('editor.media.import.hint', '支持 mp4/webm/mov 格式，单视频不超过 500MB')}
        </div>
      </div>
    </div>
  );
};
