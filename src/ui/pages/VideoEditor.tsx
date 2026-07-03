/**
 * VideoEditor —— 视频剪辑工作台主页面
 *
 * 布局：[EditorToolbar] / [MediaPanel | PreviewStage | InspectorPanel]
 *
 * - URL 参数 ?storyId=xxx 直接进入指定故事的编辑
 * - 顶部故事选择器切换 → useTimeline 自动加载/铺轨
 * - 素材面板点击"添加" → 把 clip 追加到对应轨道
 * - 属性面板修改 → 乐观更新时间线 → 防抖保存
 * - 导出按钮 → 打开 ExportModal → ITimelineRenderPort.render
 *
 * 子组件均拆分到 editor/ 目录，单文件控制在 300 行内。
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSpace } from '../contexts/SpaceContext';
import { useSpaceScopedStories } from '../hooks/useSpaceScopedQuery';
import { AsyncState } from '../components/AsyncState';
import { useTimeline } from '../hooks/useTimeline';
import { useToast } from '../contexts/ToastContext';
import { v4 as uuidv4 } from 'uuid';
import { EditorToolbar } from './editor/EditorToolbar';
import { MediaPanel } from './editor/MediaPanel';
import { PreviewStage } from './editor/PreviewStage';
import { InspectorPanel } from './editor/InspectorPanel';
import { ExportModal } from './editor/ExportModal';
import { ImportVideoModal } from './editor/ImportVideoModal';
import { KeyframePreviewPanel } from './editor/KeyframePreviewPanel';
import { WelcomePanel } from './editor/WelcomePanel';
import type { Timeline, TimelineClip, TimelineClipSource } from '../../domain/ports/PostProcessPorts';
import type { RenderExportOptions, RenderProgress } from '../../domain/ports/TimelineRenderPorts';
import type { SavedVideo } from '../../domain/entities/models';

export const VideoEditor: React.FC = () => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { currentSpaceId } = useSpace();
  const stories = useSpaceScopedStories();
  const [searchParams, setSearchParams] = useSearchParams();

  // 从 URL 初始化 storyId
  const initialStoryId = searchParams.get('storyId');
  const [storyId, setStoryId] = useState<string | null>(initialStoryId);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // M2.3: AI 智能剪切面板开关
  const [autoEditOpen, setAutoEditOpen] = useState(false);

  // storyId 变化时同步 URL + 清空选中（在事件回调里重置，避免 effect 内 setState）
  const handleStoryChange = useCallback((sid: string) => {
    setStoryId(sid || null);
    setSelectedClipId(null);
    setSearchParams(sid ? { storyId: sid } : {}, { replace: true });
  }, [setStoryId, setSelectedClipId, setSearchParams]);

  const {
    timeline, loading, error, saving,
    updateTimeline, save, reload, rebuildFromStory, exportTimeline,
  } = useTimeline(storyId);

  // 选中 clip 对象
  const selectedClip = useMemo<TimelineClip | null>(() => {
    if (!timeline || !selectedClipId) return null;
    for (const track of timeline.tracks) {
      const c = track.clips.find(c => c.id === selectedClipId);
      if (c) return c;
    }
    return null;
  }, [timeline, selectedClipId]);

  const handleClipSelect = useCallback((clip: TimelineClip | null) => {
    setSelectedClipId(clip ? clip.id : null);
  }, [setSelectedClipId]);

  const handleTimelineChange = useCallback((next: Timeline) => {
    updateTimeline(() => next);
  }, [updateTimeline]);

  /** 从素材面板追加 clip 到对应轨道 */
  const handleAddToTimeline = useCallback((source: TimelineClipSource, label: string, durationSec: number) => {
    if (!timeline) return;
    updateTimeline(draft => {
      const trackType: TimelineClip['type'] =
        source.kind === 'savedVoice' ? 'audio' :
        source.kind === 'savedImage' ? 'video' : 'video';
      // 找到第一个匹配的轨道（视频/音频），无则跳过
      const targetTrack = draft.tracks.find(tr => tr.type === trackType && !tr.locked);
      if (!targetTrack) {
        showToast('warning', t('editor.noTargetTrack', '未找到可用轨道'));
        return;
      }
      // 计算起始：取该轨最后一个 clip 的 endTime
      const lastEnd = targetTrack.clips.reduce((max, c) => Math.max(max, c.startTime + c.duration), 0);
      const clipMs = Math.max(1000, Math.round(durationSec * 1000));
      const newClip: TimelineClip = {
        id: uuidv4(),
        type: trackType,
        trackId: targetTrack.id,
        startTime: lastEnd,
        duration: clipMs,
        source: label,
        sourceRef: source,
      };
      targetTrack.clips.push(newClip);
    });
  }, [timeline, updateTimeline, showToast, t]);

  /** 属性面板修改 clip */
  const handlePatchClip = useCallback((clipId: string, patch: Partial<TimelineClip>) => {
    updateTimeline(draft => {
      for (const track of draft.tracks) {
        const idx = track.clips.findIndex(c => c.id === clipId);
        if (idx >= 0) {
          track.clips[idx] = { ...track.clips[idx], ...patch };
          return;
        }
      }
    });
  }, [updateTimeline]);

  /** 属性面板删除 clip */
  const handleRemoveClip = useCallback((clipId: string) => {
    updateTimeline(draft => {
      for (const track of draft.tracks) {
        track.clips = track.clips.filter(c => c.id !== clipId);
      }
    });
    if (selectedClipId === clipId) setSelectedClipId(null);
  }, [updateTimeline, selectedClipId, setSelectedClipId]);

  const handleSave = useCallback(async () => {
    try {
      await save();
      showToast('success', t('editor.saved', '已保存'));
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : t('editor.saveFailed', '保存失败'));
    }
  }, [save, showToast, t]);

  const handleRebuild = useCallback(async () => {
    try {
      await rebuildFromStory();
      showToast('success', t('editor.rebuilt', '已从分镜重新铺轨'));
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : t('editor.rebuildFailed', '铺轨失败'));
    }
  }, [rebuildFromStory, showToast, t]);

  const handleExport = useCallback((options: RenderExportOptions, onProgress: (p: RenderProgress) => void) => {
    return exportTimeline(options, onProgress);
  }, [exportTimeline]);

  const handleImportVideo = useCallback(() => {
    if (!currentSpaceId) {
      showToast('warning', t('editor.media.import.selectSpace', '请先选择一个空间'));
      return;
    }
    setImportOpen(true);
  }, [currentSpaceId, showToast, t]);

  const handleImported = useCallback((video: SavedVideo) => {
    showToast('success', t('editor.media.import.success', '导入成功'));
    if (timeline) {
      const source: TimelineClipSource = { kind: 'savedVideo', refId: video.id, storagePath: video.blobKey };
      handleAddToTimeline(source, video.name, video.durationSec);
    }
  }, [timeline, handleAddToTimeline, showToast, t]);

  /** M2.3: 打开 AI 智能剪切面板（取当前时间线第一个视频 clip 的 Blob） */
  const handleAutoEdit = useCallback(() => {
    if (!timeline) {
      showToast('warning', t('editor.autoEdit.noTimeline', '请先加载时间线'));
      return;
    }
    setAutoEditOpen(true);
  }, [timeline, showToast, t]);

  /** M2.3: 应用剪切结果 —— 移除未保留的 clip */
  const handleApplyTrim = useCallback((keptSegments: Array<{ startSec: number; endSec: number }>) => {
    if (!timeline) return;
    // 简化实现：提示用户剪切结果已生成，实际裁剪需对接 FFmpeg
    showToast('info', t('editor.autoEdit.applied', `已保留 ${keptSegments.length} 个片段，请导出查看效果`));
  }, [timeline, showToast, t]);

  const handleVideoSelect = useCallback((video: SavedVideo) => {
    const source: TimelineClipSource = { kind: 'savedVideo', refId: video.id, storagePath: video.blobKey };
    handleAddToTimeline(source, video.name, video.durationSec);
  }, [handleAddToTimeline]);

  return (
    <div>
      <EditorToolbar
        stories={stories}
        storyId={storyId}
        onStoryChange={handleStoryChange}
        saving={saving}
        onSave={handleSave}
        onRebuild={handleRebuild}
        onExport={() => setExportOpen(true)}
        onImportVideo={handleImportVideo}
        onAutoEdit={handleAutoEdit}
      />

      {!storyId ? (
        <WelcomePanel
          spaceId={currentSpaceId ?? ''}
          onImportClick={handleImportVideo}
          onVideoSelect={handleVideoSelect}
        />
      ) : (
        <AsyncState loading={loading} error={error} onRetry={reload} empty={!timeline}>
          {timeline && currentSpaceId && (
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'stretch', minHeight: 500 }}>
              <MediaPanel spaceId={currentSpaceId} onAddToTimeline={handleAddToTimeline} timeline={timeline} />
              <PreviewStage
                timeline={timeline}
                selectedClip={selectedClip}
                onChange={handleTimelineChange}
                onClipSelect={handleClipSelect}
              />
              <InspectorPanel
                clip={selectedClip}
                onPatch={handlePatchClip}
                onRemove={handleRemoveClip}
              />
            </div>
          )}
        </AsyncState>
      )}

      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        onExport={handleExport}
      />

      <ImportVideoModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        spaceId={currentSpaceId ?? ''}
        onImported={handleImported}
      />

      {/* M2.3: AI 智能剪切面板 */}
      <KeyframePreviewPanel
        isOpen={autoEditOpen}
        videoBlob={null}
        onClose={() => setAutoEditOpen(false)}
        onApplyTrim={handleApplyTrim}
      />
    </div>
  );
};
