/**
 * MediaPanel —— 剪辑工作台左侧素材面板
 *
 * 列出当前空间的素材库：
 * - 已保存视频（SavedVideo）：含上传导入入口（PRD F-01~F-09）
 * - 成片（FinalCut）
 * - 已保存语音（SavedVoice）
 *
 * 视频Tab顶部为 VideoUploadField（点击 + 拖拽），上传后自动刷新列表。
 * 列表项含缩略图 + 删除按钮（PRD F-07 / F-09，删除前检查时间线引用计数）。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Film, Mic, FolderOpen, Plus, Trash2, Film as FilmIcon, Link as LinkIcon, Loader, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { assetLibraryService, getFileStorage } from '../../../dependencies';
import { useSpaceScopedFinalCuts } from '../../hooks/useSpaceScopedQuery';
import { useSavedVoices, useSavedVideos } from '../../hooks/useSavedAssets';
import { useVideoImport } from '../../hooks/useVideoImport';
import { useLinkImport } from '../../hooks/useLinkImport';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useToast } from '../../contexts/ToastContext';
import { VideoUploadField } from '../../components/VideoUploadField';
import type { TimelineClipSource, Timeline } from '../../../domain/ports/PostProcessPorts';

interface MediaPanelProps {
  spaceId: string;
  onAddToTimeline: (source: TimelineClipSource, label: string, durationSec: number) => void;
  /** 当前时间线（用于删除视频前检查引用计数，PRD F-09） */
  timeline?: Timeline | null;
}

type Tab = 'videos' | 'finalcuts' | 'voices';
type VideoSubTab = 'upload' | 'link';

export const MediaPanel: React.FC<MediaPanelProps> = ({ spaceId, onAddToTimeline, timeline }) => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const [tab, setTab] = useState<Tab>('videos');
  const [videoSubTab, setVideoSubTab] = useState<VideoSubTab>('upload');

  const { videos, refetch: refetchVideos } = useSavedVideos(spaceId);
  const { voices } = useSavedVoices(spaceId);
  const finalCuts = useSpaceScopedFinalCuts();

  const videoImport = useVideoImport();
  const { state: importState, progress, error: importError, importedName } = videoImport;

  const linkImport = useLinkImport();
  const { reset: resetLinkImport } = linkImport;

  // 派生 finalCuts 的 duration（来自 finalCut.duration，毫秒）
  const cutDurations = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of finalCuts) {
      if (c.duration > 0) map[c.id] = c.duration / 1000;
    }
    return map;
  }, [finalCuts]);

  /** 处理上传文件（PRD F-01~F-05） */
  const handleFile = useCallback(async (file: File) => {
    const result = await videoImport.importVideo(file, spaceId);
    if (result) {
      showToast('success', t('editor.media.import.success', '导入成功'));
      await refetchVideos();
      videoImport.reset();
    }
    // 失败时错误已在 upload zone UI 显示，不重复 Toast
  }, [videoImport, spaceId, showToast, t, refetchVideos]);

  /** 删除视频（PRD F-09，含引用计数检查） */
  const handleDeleteVideo = useCallback(async (videoId: string) => {
    // 统计时间线引用数
    let refCount = 0;
    if (timeline) {
      for (const track of timeline.tracks) {
        for (const clip of track.clips) {
          if (clip.sourceRef?.kind === 'savedVideo' && clip.sourceRef.refId === videoId) {
            refCount++;
          }
        }
      }
    }
    const message = refCount > 0
      ? t('editor.media.delete.confirmWithRef', '该视频已被时间线引用 {{count}} 处，删除后时间线对应片段将显示空素材，确认继续？', { count: refCount })
      : t('editor.media.delete.confirmNoRef', '删除后无法恢复，确认删除该视频？');
    const ok = await confirm({
      title: t('editor.media.delete.confirmTitle', '删除视频'),
      message,
      danger: true,
    });
    if (!ok) return;
    try {
      await assetLibraryService.deleteVideo(videoId);
      showToast('success', t('editor.media.delete.success', '已删除'));
      await refetchVideos();
    } catch (e) {
      showToast('error', t('editor.media.delete.failed', '删除失败：{{reason}}', { reason: e instanceof Error ? e.message : String(e) }));
    }
  }, [timeline, confirm, t, showToast, refetchVideos]);

  const isImporting = ['validating', 'probing', 'extracting', 'saving'].includes(importState);

  return (
    <div style={{
      width: 260, flexShrink: 0, display: 'flex', flexDirection: 'column',
      background: 'rgba(0,0,0,0.2)', borderRadius: 'var(--radius-md)', overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <TabBtn active={tab === 'videos'} onClick={() => setTab('videos')} icon={<Film size={14} />} label={t('editor.media.videos', '视频')} />
        <TabBtn active={tab === 'finalcuts'} onClick={() => setTab('finalcuts')} icon={<FolderOpen size={14} />} label={t('editor.media.finalCuts', '成片')} />
        <TabBtn active={tab === 'voices'} onClick={() => setTab('voices')} icon={<Mic size={14} />} label={t('editor.media.voices', '语音')} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem' }}>
        {tab === 'videos' && (
          <>
            {/* 视频子 Tab：本地上传 / 链接导入 */}
            <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.5rem' }}>
              <button
                onClick={() => setVideoSubTab('upload')}
                style={{
                  flex: 1, padding: '0.35rem', fontSize: '0.7rem',
                  background: videoSubTab === 'upload' ? 'var(--primary-color)' : 'rgba(255,255,255,0.05)',
                  color: videoSubTab === 'upload' ? '#fff' : 'var(--text-muted)',
                  border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem',
                }}
              >
                <Film size={12} /> {t('editor.media.upload', '本地上传')}
              </button>
              <button
                onClick={() => setVideoSubTab('link')}
                style={{
                  flex: 1, padding: '0.35rem', fontSize: '0.7rem',
                  background: videoSubTab === 'link' ? 'var(--primary-color)' : 'rgba(255,255,255,0.05)',
                  color: videoSubTab === 'link' ? '#fff' : 'var(--text-muted)',
                  border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem',
                }}
              >
                <LinkIcon size={12} /> {t('editor.media.linkImport', '链接导入')}
              </button>
            </div>

            {/* 本地上传 */}
            {videoSubTab === 'upload' && (
              <>
                <VideoUploadField onFile={handleFile} disabled={isImporting} />
                {isImporting && (
                  <div style={{
                    background: 'rgba(255,255,255,0.04)', borderRadius: 'var(--radius-sm)',
                    padding: '0.5rem', marginBottom: '0.5rem',
                  }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                      {t('editor.media.import.uploading', '上传中：{{name}}', { name: importedName })}
                    </div>
                    <div style={{ height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{ width: `${progress}%`, height: '100%', background: 'var(--primary-color)', transition: 'width 0.3s' }} />
                    </div>
                  </div>
                )}
                {importState === 'error' && (
                  <div style={{
                    background: 'var(--color-danger-bg)', borderRadius: 'var(--radius-sm)',
                    padding: '0.5rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem',
                  }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-danger)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t(importError ?? 'editor.media.import.failed', importError ?? '上传失败')}
                    </span>
                    <button className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.15rem 0.4rem', flexShrink: 0 }} onClick={() => videoImport.reset()}>
                      {t('editor.media.import.retry', '重试')}
                    </button>
                  </div>
                )}
              </>
            )}

            {/* 链接导入 */}
            {videoSubTab === 'link' && (
              <LinkImportPanel
                spaceId={spaceId}
                linkImport={linkImport}
                onImportSuccess={async () => {
                  showToast('success', t('editor.media.linkImport.success', '导入成功'));
                  await refetchVideos();
                  resetLinkImport();
                }}
              />
            )}

            <MediaList
              items={videos.map(v => ({
                id: v.id,
                label: v.name,
                sub: `${Math.round(v.durationSec)}s · ${v.width ?? '?'}x${v.height ?? '?'}`,
                thumbnailBlobKey: v.thumbnailBlobKey,
                onAdd: () => onAddToTimeline(
                  { kind: 'savedVideo', refId: v.id, storagePath: v.blobKey },
                  v.name,
                  v.durationSec,
                ),
                onDelete: () => handleDeleteVideo(v.id),
              }))}
              emptyText={t('editor.media.noVideos', '暂无视频素材')}
            />
          </>
        )}

        {tab === 'finalcuts' && (
          <MediaList
            items={finalCuts.map(c => ({
              id: c.id,
              label: t('editor.media.finalCutLabel', '成片') + ' · ' + new Date(c.createdAt).toLocaleDateString(),
              sub: `${(cutDurations[c.id] ?? 0).toFixed(1)}s`,
              onAdd: () => onAddToTimeline(
                { kind: 'finalCut', refId: c.id, storagePath: c.videoStoragePath },
                t('editor.media.finalCutLabel', '成片'),
                cutDurations[c.id] ?? 0,
              ),
            }))}
            emptyText={t('editor.media.noFinalCuts', '暂无成片')}
          />
        )}

        {tab === 'voices' && (
          <MediaList
            items={voices.map(v => ({
              id: v.id,
              label: v.name,
              sub: v.sampleText?.slice(0, 30) ?? '',
              onAdd: () => onAddToTimeline(
                { kind: 'savedVoice', refId: v.id, storagePath: v.audioBlobKey },
                v.name,
                0,
              ),
            }))}
            emptyText={t('editor.media.noVoices', '暂无语音素材')}
          />
        )}
      </div>
    </div>
  );
};

const TabBtn: React.FC<{ active: boolean; onClick: () => void; icon: React.ReactNode; label: string }> = ({ active, onClick, icon, label }) => (
  <button
    onClick={onClick}
    style={{
      flex: 1, padding: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem',
      fontSize: '0.75rem', color: active ? 'var(--primary-color)' : 'var(--text-muted)',
      background: active ? 'rgba(255,255,255,0.04)' : 'transparent',
      border: 'none', borderBottom: active ? '2px solid var(--primary-color)' : '2px solid transparent',
      cursor: 'pointer',
    }}
  >
    {icon}
    {label}
  </button>
);

interface MediaItem {
  id: string;
  label: string;
  sub?: string;
  thumbnailBlobKey?: string;
  onAdd: () => void;
  onDelete?: () => void;
}

const MediaList: React.FC<{ items: MediaItem[]; emptyText: string }> = ({ items, emptyText }) => {
  if (items.length === 0) {
    return <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '2rem 0.5rem' }}>{emptyText}</div>;
  }
  return (
    <>
      {items.map(item => (
        <div
          key={item.id}
          className="media-item-row"
          style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem',
            background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-sm)', marginBottom: '0.3rem',
          }}
        >
          {item.thumbnailBlobKey !== undefined && <VideoThumbnail blobKey={item.thumbnailBlobKey} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</div>
            {item.sub && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{item.sub}</div>}
          </div>
          {item.onDelete && (
            <button
              className="btn btn-secondary media-delete-btn"
              style={{ padding: '0.2rem 0.4rem', flexShrink: 0, color: 'var(--color-danger)' }}
              onClick={item.onDelete}
              title="删除"
            >
              <Trash2 size={12} />
            </button>
          )}
          <button
            className="btn btn-secondary media-add-btn"
            style={{ padding: '0.2rem 0.4rem', flexShrink: 0 }}
            onClick={item.onAdd}
            title="添加到时间线"
          >
            <Plus size={12} />
          </button>
        </div>
      ))}
    </>
  );
};

/** 视频缩略图组件：异步从 OPFS 解析 Object URL（PRD F-07） */
const VideoThumbnail: React.FC<{ blobKey?: string }> = ({ blobKey }) => {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let revoked = false;
    let createdUrl: string | null = null;
    if (!blobKey) return;
    (async () => {
      try {
        const u = await getFileStorage().getObjectUrl(blobKey);
        if (!revoked) {
          createdUrl = u;
          setUrl(u);
        }
      } catch {
        // 加载失败显示默认占位
      }
    })();
    return () => {
      revoked = true;
      if (createdUrl?.startsWith('blob:')) URL.revokeObjectURL(createdUrl);
    };
  }, [blobKey]);

  if (!blobKey) {
    return <FilmIcon size={20} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />;
  }
  return url ? (
    <img src={url} alt="" style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 'var(--radius-sm)', flexShrink: 0 }} />
  ) : (
    <div style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: 'rgba(255,255,255,0.05)', borderRadius: 'var(--radius-sm)' }}>
      <FilmIcon size={16} style={{ color: 'var(--text-muted)' }} />
    </div>
  );
};

// ============================================================
// LinkImportPanel — 链接导入 Tab UI（PRD §4.1）
// ============================================================
interface LinkImportPanelProps {
  spaceId: string;
  linkImport: ReturnType<typeof useLinkImport>;
  onImportSuccess: () => void;
}

const LinkImportPanel: React.FC<LinkImportPanelProps> = ({ spaceId, linkImport, onImportSuccess }) => {
  const { t } = useTranslation();
  const { state, progress, error, detectedPlatform, importFromUrl, reset } = linkImport;
  const [urlInput, setUrlInput] = useState('');

  const isProcessing = ['parsing', 'downloading', 'validating', 'probing', 'extracting', 'saving'].includes(state);
  const isSuccess = state === 'success';
  const isError = state === 'error';

  const handleImport = async () => {
    if (!urlInput.trim() || isProcessing) return;
    const result = await importFromUrl(urlInput, spaceId);
    if (result) {
      onImportSuccess();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleImport();
    }
  };

  /** 状态文案（PRD §4.2） */
  const stateLabel: Record<string, string> = {
    parsing: t('editor.media.linkImport.parsing', '正在识别视频地址...'),
    downloading: t('editor.media.linkImport.downloading', '下载中'),
    validating: t('editor.media.linkImport.validating', '校验中'),
    probing: t('editor.media.linkImport.probing', '读取视频信息...'),
    extracting: t('editor.media.linkImport.extracting', '生成缩略图...'),
    saving: t('editor.media.linkImport.saving', '保存到素材库...'),
    success: t('editor.media.linkImport.success', '已导入，可在列表中查看'),
    error: '',
  };

  return (
    <div style={{ marginBottom: '0.5rem' }}>
      {/* URL 输入框 */}
      <input
        type="text"
        placeholder={t('editor.media.linkImport.placeholder', '粘贴视频链接或分享链接...')}
        value={urlInput}
        onChange={e => setUrlInput(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={isProcessing}
        maxLength={2048}
        style={{
          width: '100%', boxSizing: 'border-box',
          padding: '0.4rem 0.6rem',
          fontSize: '0.75rem',
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--text-primary)',
          outline: 'none',
        }}
      />

      {/* 平台识别提示 */}
      {detectedPlatform && !isProcessing && !isError && (
        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          <span>检测到：{detectedPlatform}</span>
        </div>
      )}

      {/* 导入按钮 */}
      <button
        className="btn btn-primary"
        onClick={handleImport}
        disabled={!urlInput.trim() || isProcessing}
        style={{ width: '100%', marginTop: '0.4rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem', fontSize: '0.75rem' }}
      >
        {isProcessing ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Loader size={12} className="spin" />
            {stateLabel[state] || t('editor.media.linkImport.importing', '导入中')}
          </span>
        ) : isError ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <RefreshCw size={12} />
            {t('editor.media.linkImport.retry', '重试')}
          </span>
        ) : (
          <span>{t('editor.media.linkImport.importBtn', '解析并导入')}</span>
        )}
      </button>

      {/* 进度条 */}
      {isProcessing && (
        <div style={{ marginTop: '0.4rem' }}>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>
            {stateLabel[state]}
          </div>
          <div style={{ height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{ width: `${progress}%`, height: '100%', background: 'var(--primary-color)', transition: 'width 0.3s' }} />
          </div>
        </div>
      )}

      {/* 错误提示 */}
      {isError && error && (
        <div style={{
          marginTop: '0.4rem',
          padding: '0.4rem 0.5rem',
          background: 'var(--color-danger-bg)',
          borderRadius: 'var(--radius-sm)',
          fontSize: '0.75rem',
          color: 'var(--color-danger)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
        }}>
          <span style={{ flex: 1 }}>{t(error, error)}</span>
          <button className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.1rem 0.3rem', flexShrink: 0 }} onClick={reset}>
            {t('editor.media.linkImport.clear', '清除')}
          </button>
        </div>
      )}

      {/* 成功提示 */}
      {isSuccess && (
        <div style={{
          marginTop: '0.4rem',
          padding: '0.4rem 0.5rem',
          background: 'var(--color-success-bg)',
          borderRadius: 'var(--radius-sm)',
          fontSize: '0.75rem',
          color: 'var(--color-success)',
        }}>
          ✓ {t('editor.media.linkImport.success', '已导入，可在列表中查看')}
        </div>
      )}
    </div>
  );
};
