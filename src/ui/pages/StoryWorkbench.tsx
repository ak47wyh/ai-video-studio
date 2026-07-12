import React, { useMemo, useEffect, useCallback, useReducer } from 'react';
import { storyService, videoGenerationService, imageAdapter, voiceService, musicService, textGenerationService, pipelineService, assetLibraryService, apiConfigStoreAdapter, bgmRecommendationService } from '../../dependencies';
import { Spline, Sparkles, AlertTriangle, ImagePlus, PlayCircle, Film, Scissors } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { VideoTask, Character, SavedImage, SavedPrompt } from '../../domain/entities/models';
import type { ImageGenerationContext } from '../../domain/ports/OutboundPorts';
import { useSpace } from '../contexts/SpaceContext';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { getErrorMessage } from '../utils/errorUtils';
import { useSpaceScopedCharacters, useSpaceScopedBackgrounds, useSpaceScopedStories, useStoryScopedSegments, useSegmentScopedVideoTasks } from '../hooks/useSpaceScopedQuery';
import { StoryListPanel } from '../components/StoryListPanel';
import { BreakdownPreview } from '../components/BreakdownPreview';
import { SegmentCard } from '../components/SegmentCard';
import { PipelinePanel } from '../components/PipelinePanel';
import { workbenchReducer, initialWorkbenchState, breakdownReducer, initialBreakdownState, bgmReducer, initialBGMState } from '../hooks/useWorkbenchState';
import { AssetPicker } from '../components/AssetPicker';
import { AsyncState } from '../components/AsyncState';
import { useAssetPicker } from '../hooks/useAssetPicker';

export const StoryWorkbench: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { currentSpaceId } = useSpace();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const { state: assetPickerState, openPicker, closePicker } = useAssetPicker();

  // 数据层：通过 hooks 获取，不直调 db
  const stories = useSpaceScopedStories();
  const backgrounds = useSpaceScopedBackgrounds();
  const characters = useSpaceScopedCharacters();

  // 3 个领域 reducer 替代 30+ useState
  const [ws, wsDispatch] = useReducer(workbenchReducer, initialWorkbenchState);
  const [bd, bdDispatch] = useReducer(breakdownReducer, initialBreakdownState);
  const [bgm, bgmDispatch] = useReducer(bgmReducer, initialBGMState);

  // 段落和视频任务通过 hooks 获取
  const segments = useStoryScopedSegments(ws.selectedStoryId);
  const segmentIds = useMemo(() => segments.map(s => s.id), [segments]);
  const videoTasks = useSegmentScopedVideoTasks(segmentIds);

  // V2 P2-2.6.6：narrationPollersRef 死代码清理
  //   原本声明了 Map<string, setInterval> 用于旁白轮询清理，但整个组件从未写入任何 poller，
  //   仅有清理路径（卸载 / switchStory）——即"永远清空空 Map"，属彻底死代码。
  //   VoiceLab 相关的旁白/长文本 TTS 轮询已迁到 useAsyncTaskTracker（P4-3），
  //   本页无需再自行管理。若未来需要，请在 VoiceService 层暴露 destroy() 而不是在组件内维护 Map。

  const latestTaskMap = useMemo(() => {
    const map = new Map<string, VideoTask>();
    const sorted = [...videoTasks].sort((a, b) => b.createdAt - a.createdAt);
    for (const task of sorted) {
      if (!map.has(task.segmentId)) map.set(task.segmentId, task);
    }
    return map;
  }, [videoTasks]);

  const characterMap = useMemo(() => {
    const map = new Map<string, Character>();
    for (const c of characters) map.set(c.id, c);
    return map;
  }, [characters]);

  const selectedStory = useMemo(
    () => stories.find(s => s.id === ws.selectedStoryId) ?? null,
    [stories, ws.selectedStoryId]
  );

  const progressStats = useMemo(() => {
    if (segments.length === 0) return null;
    let success = 0, processing = 0, pending = 0, failed = 0, ready = 0;
    for (const seg of segments) {
      const task = latestTaskMap.get(seg.id);
      if (!task) { ready++; } else {
        switch (task.status) {
          case 'SUCCESS': success++; break;
          case 'PROCESSING': processing++; break;
          case 'PENDING': pending++; break;
          case 'FAILED': failed++; break;
        }
      }
    }
    return { total: segments.length, success, processing, pending, failed, ready };
  }, [segments, latestTaskMap]);

  const switchStory = useCallback((storyId: string | null) => {
    wsDispatch({ type: 'SELECT_STORY', storyId });
    // V2 P2-2.6.6：narrationPollersRef 已删除（死代码），无需清理
    wsDispatch({ type: 'CLEAR_NARRATION' });
    bgmDispatch({ type: 'RESET' });
  }, []);

  // P0 修复：读取 Dashboard 跳转携带的 ?story=xxx 参数并自动切换
  useEffect(() => {
    const storyIdFromUrl = searchParams.get('story');
    if (!storyIdFromUrl) return;
    // 已选中则仅清除 URL 参数，避免重复触发
    if (ws.selectedStoryId === storyIdFromUrl) {
      navigate('/workbench', { replace: true });
      return;
    }
    // stories 列表未加载完成时等待
    if (stories.length === 0) return;
    if (stories.some(s => s.id === storyIdFromUrl)) {
      switchStory(storyIdFromUrl);
    }
    // 切换后清除 URL 参数，避免刷新再次触发
    navigate('/workbench', { replace: true });
  }, [searchParams, stories, ws.selectedStoryId, switchStory, navigate]);

  // ---- Story CRUD ----

  const handleCreateStory = async () => {
    if (!currentSpaceId) return;
    wsDispatch({ type: 'SET_SPLITTING', value: true });
    let createdId: string | null = null;
    try {
      const story = await storyService.createStory('', '', currentSpaceId);
      createdId = story.id;
      switchStory(story.id);
      await storyService.splitStory(story.id);
    } catch {
      if (createdId) { try { await storyService.deleteStory(createdId); } catch { /* rollback */ } switchStory(null); }
      showToast('error', t('workbench.splitFailed'));
    } finally {
      wsDispatch({ type: 'SET_SPLITTING', value: false });
    }
  };

  const handleCreateAndBreakdown = async () => {
    if (!currentSpaceId) return;
    wsDispatch({ type: 'SET_BREAKING_DOWN', value: true });
    bdDispatch({ type: 'RESET' });
    let createdId: string | null = null;
    try {
      const story = await storyService.createStory('', '', currentSpaceId);
      createdId = story.id;
      switchStory(story.id);
      const result = await storyService.previewBreakdown(story.id);
      bdDispatch({ type: 'SET_DRAFTS', characters: result.characters, backgrounds: result.backgrounds, segments: result.segments });
      bdDispatch({ type: 'SHOW_PREVIEW' });
    } catch {
      if (createdId) { try { await storyService.deleteStory(createdId); } catch { /* rollback */ } switchStory(null); }
      showToast('error', t('workbench.breakdownFailed'));
    } finally {
      wsDispatch({ type: 'SET_BREAKING_DOWN', value: false });
    }
  };

  const handleQuickSplit = async (storyId: string) => {
    switchStory(storyId);
    wsDispatch({ type: 'SET_SPLITTING', value: true });
    try { await storyService.splitStory(storyId); }
    catch { showToast('error', t('workbench.splitFailed')); }
    finally { wsDispatch({ type: 'SET_SPLITTING', value: false }); }
  };

  const handleDeleteStory = async (storyId: string) => {
    const ok = await confirm({ title: t('workbench.confirmDeleteTitle'), message: t('workbench.confirmDelete'), confirmLabel: t('workbench.deleteConfirmBtn'), danger: true });
    if (!ok) return;
    await storyService.deleteStory(storyId);
    showToast('success', t('workbench.deleteSuccess'));
    if (ws.selectedStoryId === storyId) switchStory(null);
  };

  const handleSaveStory = async (storyId: string, title: string, originalText: string) => {
    try { await storyService.updateStory(storyId, title, originalText); showToast('success', t('workbench.saveSuccess')); }
    catch (e) { showToast('error', getErrorMessage(e)); }
  };

  const handleReSplit = async () => {
    if (!ws.selectedStoryId) return;
    const ok = await confirm({ title: t('workbench.confirmReSplitTitle'), message: t('workbench.confirmReSplit'), confirmLabel: t('workbench.reSplitBtn'), danger: true });
    if (!ok) return;
    wsDispatch({ type: 'SET_SPLITTING', value: true });
    try { await storyService.splitStory(ws.selectedStoryId); }
    catch { showToast('error', t('workbench.splitFailed')); }
    finally { wsDispatch({ type: 'SET_SPLITTING', value: false }); }
  };

  const handleReBreakdown = async () => {
    if (!ws.selectedStoryId) return;
    const ok = await confirm({ title: t('workbench.confirmReBreakdownTitle'), message: t('workbench.confirmReBreakdown'), confirmLabel: t('workbench.reBreakdownBtn'), danger: true });
    if (!ok) return;
    wsDispatch({ type: 'SET_BREAKING_DOWN', value: true });
    bdDispatch({ type: 'RESET' });
    try {
      const result = await storyService.previewBreakdown(ws.selectedStoryId);
      bdDispatch({ type: 'SET_DRAFTS', characters: result.characters, backgrounds: result.backgrounds, segments: result.segments });
      bdDispatch({ type: 'SHOW_PREVIEW' });
    } catch { showToast('error', t('workbench.breakdownFailed')); }
    finally { wsDispatch({ type: 'SET_BREAKING_DOWN', value: false }); }
  };

  // ---- Breakdown ----

  const handleCloseBreakdownPreview = async () => {
    const ok = await confirm({ title: t('workbench.confirmClosePreviewTitle'), message: t('workbench.confirmClosePreview'), confirmLabel: t('workbench.closePreview'), danger: true });
    if (!ok) return;
    bdDispatch({ type: 'RESET' });
  };

  const handleApplyBreakdown = async () => {
    if (!ws.selectedStoryId) return;
    bdDispatch({ type: 'SET_APPLYING', value: true });
    try {
      const confirmedChars = bd.draftCharacters.filter((_, i) => bd.confirmedCharIndices.has(i));
      const confirmedBgs = bd.draftBackgrounds.filter((_, i) => bd.confirmedBgIndices.has(i));
      await storyService.applyBreakdown(ws.selectedStoryId, confirmedChars, confirmedBgs, bd.draftSegments);
      bdDispatch({ type: 'RESET' });
      showToast('success', t('workbench.breakdownApplied'));
    } catch { showToast('error', t('workbench.breakdownApplyFailed')); }
    finally { bdDispatch({ type: 'SET_APPLYING', value: false }); }
  };

  // ---- Video ----

  const handleSelectBackground = useCallback(async (segmentId: string, bgId: string) => {
    await storyService.updateSegmentBackground(segmentId, bgId);
  }, []);

  const handleGenerateVideo = useCallback(async (segmentId: string) => {
    if (!ws.selectedStoryId) return;
    const seg = segments.find(s => s.id === segmentId);
    if (!seg) return;
    try {
      // P0 修复：从 apiConfigStore 动态读取当前激活平台（原硬编码 'MINIMAX'）
      const activePlatform = apiConfigStoreAdapter.load().activePlatform;
      await videoGenerationService.generateVideo(segmentId, ws.selectedStoryId, activePlatform, {
        mode: ws.videoMode, model: ws.videoModel, resolution: ws.videoResolution,
        duration: ws.videoDuration, promptOptimizer: ws.videoPromptOptimizer,
        firstFrameImage: seg.firstFrameImage,
      });
    } catch (e: unknown) { showToast('error', getErrorMessage(e)); }
  }, [segments, showToast, ws]);

  const handleBatchGenerate = async () => {
    if (!ws.selectedStoryId) return;
    wsDispatch({ type: 'SET_BATCH_GENERATING', value: true });
    try {
      const eligible = segments.filter(seg => {
        if (!seg.selectedBackgroundId) return false;
        const task = latestTaskMap.get(seg.id);
        return !task || task.status === 'FAILED';
      });
      const noVoice = eligible.filter(seg => seg.mentionedCharacters.some(id => !characters.find(c => c.id === id)?.voiceId));
      const noBGM = eligible.filter(seg => !seg.bgmAudioUrl);
      if (noVoice.length > 0 || noBGM.length > 0) {
        const warnings: string[] = [];
        if (noVoice.length > 0) warnings.push(t('workbench.noVoiceWarning', { count: noVoice.length }));
        if (noBGM.length > 0) warnings.push(t('workbench.noBGMWarning', { count: noBGM.length }));
        const ok = await confirm({ title: t('workbench.batchWarningsTitle'), message: warnings.join('\n'), confirmLabel: t('workbench.batchGenerateBtn'), danger: false });
        if (!ok) { wsDispatch({ type: 'SET_BATCH_GENERATING', value: false }); return; }
      }
      let successCount = 0, failCount = 0;
      const batchPlatform = apiConfigStoreAdapter.load().activePlatform;
      for (const seg of eligible) {
        try {
          await videoGenerationService.generateVideo(seg.id, ws.selectedStoryId!, batchPlatform, {
            mode: ws.videoMode, model: ws.videoModel, resolution: ws.videoResolution,
            duration: ws.videoDuration, promptOptimizer: ws.videoPromptOptimizer,
            firstFrameImage: seg.firstFrameImage,
          });
          successCount++;
        } catch { /* skip failed segment */ failCount++; }
      }
      if (successCount > 0) showToast('info', t('workbench.batchStarted', { count: successCount }));
      if (failCount > 0) showToast('warning', t('workbench.batchPartialFailed', { count: failCount }));
      if (successCount === 0 && failCount === 0) showToast('warning', t('workbench.batchNoEligible'));
    } catch (e: unknown) { showToast('error', getErrorMessage(e)); }
    finally { wsDispatch({ type: 'SET_BATCH_GENERATING', value: false }); }
  };

  /**
   * P0-1：批量生成旁白 —— 遍历所有缺旁白且角色已绑定音色的段落，并发度 2。
   * 失败段落标记错误状态，不影响其他段落。
   */
  const handleBatchNarrate = useCallback(async () => {
    if (!ws.selectedStoryId) return;
    wsDispatch({ type: 'SET_BATCH_NARRATING', value: true });
    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;
    try {
      // 并发度 2 的简单池
      const queue = segments.filter(seg => !ws.narrationUrls[seg.id]);
      const concurrency = 2;
      let cursor = 0;
      const worker = async () => {
        while (cursor < queue.length) {
          const seg = queue[cursor++];
          const charWithVoice = seg.mentionedCharacters
            .map(id => characters.find(c => c.id === id))
            .find(c => c?.voiceId);
          if (!charWithVoice?.voiceId) { skipCount++; continue; }
          wsDispatch({ type: 'SET_NARRATION_STATUS', segmentId: seg.id, status: 'running' });
          try {
            const url = await voiceService.generateAndPersistNarration(seg.id, seg.content, charWithVoice.voiceId);
            wsDispatch({ type: 'SET_NARRATION_URL', segmentId: seg.id, url });
            wsDispatch({ type: 'SET_NARRATION_STATUS', segmentId: seg.id, status: 'success' });
            successCount++;
          } catch {
            wsDispatch({ type: 'SET_NARRATION_STATUS', segmentId: seg.id, status: 'error' });
            failCount++;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
      const msg = t('workbench.narrateComplete', { success: successCount, skipped: skipCount, failed: failCount });
      showToast(successCount > 0 ? 'success' : 'warning', msg);
    } catch (e: unknown) { showToast('error', getErrorMessage(e)); }
    finally { wsDispatch({ type: 'SET_BATCH_NARRATING', value: false }); }
  }, [ws.selectedStoryId, segments, ws.narrationUrls, characters, showToast, wsDispatch, t]);

  /**
   * P0-1：批量生成 BGM —— 基于段落内容推荐风格后一键生成，并发度 2。
   * 使用 bgmRecommendationService 自动推荐，用户无需逐段填写 prompt。
   */
  const handleBatchBGM = useCallback(async () => {
    if (!ws.selectedStoryId) return;
    wsDispatch({ type: 'SET_BATCH_BGM_GENERATING', value: true });
    let successCount = 0;
    let failCount = 0;
    try {
      const queue = segments.filter(seg => !seg.bgmAudioUrl);
      const concurrency = 2;
      let cursor = 0;
      const worker = async () => {
        while (cursor < queue.length) {
          const seg = queue[cursor++];
          try {
            const recommendation = await bgmRecommendationService.recommend(seg.content);
            await musicService.generateBGM(seg.id, recommendation.prompt, { isInstrumental: true });
            successCount++;
          } catch {
            failCount++;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
      const msg = t('workbench.bgmComplete', { success: successCount, failed: failCount });
      showToast(successCount > 0 ? 'success' : 'warning', msg);
    } catch (e: unknown) { showToast('error', getErrorMessage(e)); }
    finally { wsDispatch({ type: 'SET_BATCH_BGM_GENERATING', value: false }); }
  }, [ws.selectedStoryId, segments, showToast, wsDispatch, t]);

  const handleBatchSetBackground = async () => {
    if (!ws.selectedStoryId || !ws.batchBgId) return;
    try {
      for (const seg of segments) await storyService.updateSegmentBackground(seg.id, ws.batchBgId);
      showToast('success', t('workbench.batchBgSuccess', { count: segments.length }));
      wsDispatch({ type: 'SET_BATCH_BG_ID', value: '' });
    } catch (e: unknown) { showToast('error', getErrorMessage(e)); }
  };

  const handleUpdateActionContent = useCallback(async (segmentId: string, content: string) => {
    try {
      const seg = segments.find(s => s.id === segmentId);
      if (seg) {
        seg.actionContent = content;
        await storyService.updateSegment(segmentId, { actionContent: content });
      }
    } catch (e) { showToast('error', getErrorMessage(e)); }
  }, [segments, showToast]);

  const handleUpdateFirstFrameImage = useCallback(async (segmentId: string, url: string) => {
    try {
      const seg = segments.find(s => s.id === segmentId);
      if (seg) {
        seg.firstFrameImage = url;
        await storyService.updateSegment(segmentId, { firstFrameImage: url });
      }
    } catch (e) { showToast('error', getErrorMessage(e)); }
  }, [segments, showToast]);

  const handleAssembleFinalVideo = async () => {
    if (!ws.selectedStoryId) return;
    wsDispatch({ type: 'SET_ASSEMBLING', value: true, progress: { percent: 0, message: t('workbench.assembleInit') } });
    try {
      await pipelineService.assembleFinalVideo(ws.selectedStoryId, ws.narrationUrls, (percent, message) => {
        wsDispatch({ type: 'SET_ASSEMBLING', value: true, progress: { percent, message } });
      });
      showToast('success', t('workbench.assembleSuccess', '合成成功，已保存至导出中心！'));
      navigate('/export');
    } catch (e: unknown) {
      showToast('error', getErrorMessage(e, t('workbench.assembleFailed', '合成失败')));
    } finally {
      wsDispatch({ type: 'SET_ASSEMBLING', value: false, progress: null });
    }
  };

  // ---- Narration ----

  const handleGenerateNarration = useCallback(async (segmentId: string, content: string, characterIds: string[]) => {
    const charWithVoice = characterIds.map(id => characters.find(c => c.id === id)).find(c => c?.voiceId);
    if (!charWithVoice?.voiceId) { showToast('warning', t('character.noVoice')); return; }
    wsDispatch({ type: 'SET_NARRATION_STATUS', segmentId, status: 'running' });
    try {
      // P0 修复：改用 generateAndPersistNarration 持久化到 OPFS（原 generateNarrationAudio 仅存内存，刷新即丢）
      const audioUrl = await voiceService.generateAndPersistNarration(segmentId, content, charWithVoice.voiceId);
      wsDispatch({ type: 'SET_NARRATION_STATUS', segmentId, status: 'done' });
      wsDispatch({ type: 'SET_NARRATION_URL', segmentId, url: audioUrl });
      showToast('success', t('character.narrationGenerated'));
    } catch (e: unknown) {
      wsDispatch({ type: 'SET_NARRATION_STATUS', segmentId, status: 'failed' });
      showToast('error', getErrorMessage(e, t('character.narrationFailed')));
    }
  }, [characters, showToast, t]);

  // ---- BGM ----

  const handleGenerateBGM = useCallback(async (segmentId: string) => {
    if (!bgm.prompt.trim()) { showToast('warning', t('music.promptLabel')); return; }
    bgmDispatch({ type: 'SET_GENERATING', value: true });
    try {
      if (bgm.mode === 'cover') {
        if (!bgm.coverAudioUrl.trim()) { showToast('warning', t('music.coverAudioRequired')); return; }
        await musicService.generateCoverBGM(segmentId, bgm.coverAudioUrl.trim(), bgm.prompt.trim(), { lyrics: bgm.lyrics || undefined, model: bgm.model });
      } else {
        const options: { isInstrumental?: boolean; lyrics?: string; lyricsOptimizer?: boolean; model?: typeof bgm.model } = { model: bgm.model };
        if (bgm.mode === 'instrumental') options.isInstrumental = true;
        else if (bgm.mode === 'autoLyrics') { options.isInstrumental = false; options.lyricsOptimizer = true; }
        else { options.isInstrumental = false; options.lyrics = bgm.lyrics || undefined; }
        await musicService.generateBGM(segmentId, bgm.prompt.trim(), options);
      }
      showToast('success', t('music.bgmGenerated'));
      bgmDispatch({ type: 'GENERATED' });
    } catch (e: unknown) { showToast('error', getErrorMessage(e, t('music.bgmGenerateFailed'))); }
    finally { bgmDispatch({ type: 'SET_GENERATING', value: false }); }
  }, [bgm, showToast, t]);

  const handleRemoveBGM = useCallback(async (segmentId: string) => {
    const ok = await confirm({ title: t('music.removeBGM'), message: t('music.confirmRemoveBGM'), confirmLabel: t('music.removeBGMBtn'), danger: true });
    if (!ok) return;
    try { await musicService.removeBGMFromSegment(segmentId); showToast('success', t('music.removeBGM')); }
    catch (e: unknown) { showToast('error', getErrorMessage(e)); }
  }, [confirm, showToast, t]);

  const handleGenerateLyrics = useCallback(async () => {
    if (!bgm.prompt.trim()) return;
    bgmDispatch({ type: 'SET_GENERATING_LYRICS', value: true });
    try {
      const result = await musicService.generateLyrics(bgm.prompt.trim());
      bgmDispatch({ type: 'SET_LYRICS', value: result.lyrics });
      showToast('success', t('music.lyricsGenerated'));
    } catch (e: unknown) { showToast('error', getErrorMessage(e)); }
    finally { bgmDispatch({ type: 'SET_GENERATING_LYRICS', value: false }); }
  }, [bgm.prompt, showToast, t]);

  // ---- AI Refine ----

  const handleRefineStoryText = async (text: string): Promise<string> => {
    wsDispatch({ type: 'SET_REFINING_STORY_TEXT', value: true });
    try { const result = await textGenerationService.refineText(text); showToast('success', t('textAI.textRefined')); return result.content; }
    catch (e) { showToast('error', getErrorMessage(e, t('textAI.promptRefineFailed'))); return text; }
    finally { wsDispatch({ type: 'SET_REFINING_STORY_TEXT', value: false }); }
  };

  const handleRefineCharAppearance = async (index: number, prompt: string) => {
    bdDispatch({ type: 'SET_REFINING_CHAR', field: { index, field: 'appearance' } });
    try { const result = await textGenerationService.refinePrompt(prompt, 'character_appearance'); bdDispatch({ type: 'UPDATE_CHAR', index, field: 'appearancePrompt', value: result.content }); showToast('success', t('textAI.promptRefined')); }
    catch (e) { showToast('error', getErrorMessage(e, t('textAI.promptRefineFailed'))); }
    finally { bdDispatch({ type: 'SET_REFINING_CHAR', field: null }); }
  };

  const handleRefineCharPersonality = async (index: number, prompt: string) => {
    bdDispatch({ type: 'SET_REFINING_CHAR', field: { index, field: 'personality' } });
    try { const result = await textGenerationService.refinePrompt(prompt, 'character_personality'); bdDispatch({ type: 'UPDATE_CHAR', index, field: 'personalityPrompt', value: result.content }); showToast('success', t('textAI.promptRefined')); }
    catch (e) { showToast('error', getErrorMessage(e, t('textAI.promptRefineFailed'))); }
    finally { bdDispatch({ type: 'SET_REFINING_CHAR', field: null }); }
  };

  const handleRefineBackground = async (index: number, prompt: string) => {
    bdDispatch({ type: 'SET_REFINING_BG', field: { index, field: 'environment' } });
    try { const result = await textGenerationService.refinePrompt(prompt, 'background'); bdDispatch({ type: 'UPDATE_BG', index, field: 'environmentPrompt', value: result.content }); showToast('success', t('textAI.promptRefined')); }
    catch (e) { showToast('error', getErrorMessage(e, t('textAI.promptRefineFailed'))); }
    finally { bdDispatch({ type: 'SET_REFINING_BG', field: null }); }
  };

  // ---- Draft image generation ----

  const handleGenerateCharDraftImage = async (index: number, context: ImageGenerationContext) => {
    bdDispatch({ type: 'SET_GENERATING_CHAR_IMAGE', index, value: true });
    try {
      const result = await imageAdapter.generateImage(context);
      bdDispatch({ type: 'UPDATE_CHAR', index, field: 'referenceImageUrl', value: result.imageDataUri || result.imageUrls?.[0] || '' });
      showToast('success', t('workbench.draftImageGenerated'));
    } catch (e: unknown) { showToast('error', getErrorMessage(e)); }
    finally { bdDispatch({ type: 'SET_GENERATING_CHAR_IMAGE', index, value: false }); }
  };

  const handleGenerateBgDraftImage = async (index: number, context: ImageGenerationContext) => {
    bdDispatch({ type: 'SET_GENERATING_BG_IMAGE', index, value: true });
    try {
      const result = await imageAdapter.generateImage(context);
      bdDispatch({ type: 'UPDATE_BG', index, field: 'referenceImageUrl', value: result.imageDataUri || result.imageUrls?.[0] || '' });
      showToast('success', t('workbench.draftImageGenerated'));
    } catch (e: unknown) { showToast('error', getErrorMessage(e)); }
    finally { bdDispatch({ type: 'SET_GENERATING_BG_IMAGE', index, value: false }); }
  };

  // ---- BGM Style suggestion ----

  const handleSuggestBGMStyle = useCallback(async (segmentContent: string) => {
    bgmDispatch({ type: 'SET_SUGGESTING_STYLE', value: true });
    try {
      // P1 修复：改用专用 BGMRecommendationService（原走通用 textGenerationService.suggestBGMStyle）
      const recommendation = await bgmRecommendationService.recommend(segmentContent);
      bgmDispatch({ type: 'SET_PROMPT', value: recommendation.prompt });
      showToast('success', t('textAI.bgmStyleSuggested'));
    }
    catch (e) { showToast('error', getErrorMessage(e, t('textAI.promptRefineFailed'))); }
    finally { bgmDispatch({ type: 'SET_SUGGESTING_STYLE', value: false }); }
  }, [showToast, t]);

  const hasCharacters = characters.length > 0;

  // ---- Phase 4 性能优化：稳定 SegmentCard 的高频回调，避免触发 React.memo 子组件重渲染 ----

  /* START_EDIT 与 onGenerateBGM 等依赖 seg.id 的回调无法共享稳定引用，
   故继续在 JSX 处使用 () => dispatch(...) 形式内联。
   仅对不依赖 seg.id 的共享回调（BGM 状态编辑、AssetPicker 等）做稳定化 */

  const handleBGMEditCancel = useCallback(() => {
    bgmDispatch({ type: 'CANCEL_EDIT' });
  }, []);

  const handleBgmPromptChange = useCallback((v: string) => {
    bgmDispatch({ type: 'SET_PROMPT', value: v });
  }, []);

  const handleBgmModeChange = useCallback((v: 'instrumental' | 'autoLyrics' | 'customLyrics' | 'cover') => {
    bgmDispatch({ type: 'SET_MODE', value: v });
  }, []);

  const handleBgmModelChange = useCallback((v: 'music-2.6' | 'music-2.6-free' | 'music-cover' | 'music-cover-free') => {
    bgmDispatch({ type: 'SET_MODEL', value: v });
  }, []);

  const handleBgmLyricsChange = useCallback((v: string) => {
    bgmDispatch({ type: 'SET_LYRICS', value: v });
  }, []);

  const handleBgmCoverAudioUrlChange = useCallback((v: string) => {
    bgmDispatch({ type: 'SET_COVER_URL', value: v });
  }, []);

  const handlePickImage = useCallback((segmentId: string) => {
    openPicker('image', async (asset) => {
      if (!('blobKey' in asset)) return;
      try {
        const url = await assetLibraryService.getImageBlobUrl(asset as SavedImage);
        handleUpdateFirstFrameImage(segmentId, url);
      } catch {
        handleUpdateFirstFrameImage(segmentId, '');
      }
    });
  }, [openPicker, handleUpdateFirstFrameImage]);

  const handlePickNarrationPrompt = useCallback((segmentId: string) => {
    openPicker('prompt', (asset) => {
      if ('content' in asset) handleUpdateActionContent(segmentId, (asset as SavedPrompt).content || '');
    }, 'narration');
  }, [openPicker, handleUpdateActionContent]);
  const hasBackgrounds = backgrounds.length > 0;

  return (
    <div className="workbench fade-in">
      <StoryListPanel
        stories={stories}
        selectedStoryId={ws.selectedStoryId}
        isSplitting={ws.isSplitting}
        isBreakingDown={ws.isBreakingDown}
        refiningStoryText={ws.isRefiningStoryText}
        onSwitchStory={switchStory}
        onCreateStory={handleCreateStory}
        onCreateAndBreakdown={handleCreateAndBreakdown}
        onQuickSplit={handleQuickSplit}
        onDeleteStory={handleDeleteStory}
        onRefineStoryText={handleRefineStoryText}
        onSaveStory={handleSaveStory}
      />

      <div className="workbench-right-panel">
        <div className="workbench-header">
          <h2>{t('workbench.segmentsTitle')}</h2>
          <div className="workbench-actions">
            {selectedStory && (
              <>
                <button className="btn btn-secondary btn-sm" onClick={handleReSplit} disabled={ws.isSplitting}>
                  <Spline size={14} /> {ws.isSplitting ? t('workbench.splitting') : t('workbench.reSplitBtn')}
                </button>
                <button className="btn btn-primary btn-sm" onClick={handleReBreakdown} disabled={ws.isBreakingDown}>
                  <Sparkles size={14} />
                  {ws.isBreakingDown ? t('workbench.breakingDown') : t('workbench.reBreakdownBtn')}
                </button>
              </>
            )}
          </div>
        </div>

        {ws.selectedStoryId && (
          <PipelinePanel storyId={ws.selectedStoryId} storyTitle={selectedStory?.title ?? ''} />
        )}

        {bd.showPreview && (bd.draftCharacters.length > 0 || bd.draftBackgrounds.length > 0) && (
          <BreakdownPreview
            draftCharacters={bd.draftCharacters}
            draftBackgrounds={bd.draftBackgrounds}
            confirmedCharIndices={bd.confirmedCharIndices}
            confirmedBgIndices={bd.confirmedBgIndices}
            generatingDraftCharImageIndices={bd.generatingCharImageIndices}
            generatingDraftBgImageIndices={bd.generatingBgImageIndices}
            refiningDraftCharField={bd.refiningCharField}
            refiningDraftBgField={bd.refiningBgField}
            isApplyingBreakdown={bd.isApplying}
            onUpdateDraftCharacter={(i, f, v) => bdDispatch({ type: 'UPDATE_CHAR', index: i, field: f, value: v })}
            onRemoveDraftCharacter={(i) => bdDispatch({ type: 'REMOVE_CHAR', index: i })}
            onToggleConfirmChar={(i) => bdDispatch({ type: 'TOGGLE_CONFIRM_CHAR', index: i })}
            onToggleConfirmAllChars={() => bdDispatch({ type: 'TOGGLE_CONFIRM_ALL_CHARS' })}
            onUpdateDraftBackground={(i, f, v) => bdDispatch({ type: 'UPDATE_BG', index: i, field: f, value: v })}
            onRemoveDraftBackground={(i) => bdDispatch({ type: 'REMOVE_BG', index: i })}
            onToggleConfirmBg={(i) => bdDispatch({ type: 'TOGGLE_CONFIRM_BG', index: i })}
            onToggleConfirmAllBgs={() => bdDispatch({ type: 'TOGGLE_CONFIRM_ALL_BGS' })}
            onGenerateCharImage={handleGenerateCharDraftImage}
            onGenerateBgImage={handleGenerateBgDraftImage}
            onRefineCharAppearance={handleRefineCharAppearance}
            onRefineCharPersonality={handleRefineCharPersonality}
            onRefineBackground={handleRefineBackground}
            onApplyBreakdown={handleApplyBreakdown}
            onCloseBreakdownPreview={handleCloseBreakdownPreview}
          />
        )}

        {selectedStory && segments.length > 0 && (!hasCharacters || !hasBackgrounds) && (
          <div style={{ padding: '0.5rem 0.75rem', marginBottom: '0.5rem', borderRadius: 'var(--radius-md)', background: 'var(--color-warning-bg)', border: '1px solid var(--color-warning-border)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <AlertTriangle size={16} color="var(--color-warning)" />
            <div style={{ flex: 1 }}>
              {!hasCharacters && <span style={{ fontSize: '0.8rem', color: 'var(--color-warning)', marginRight: '0.75rem' }}>{t('workbench.noCharactersWarning')}</span>}
              {!hasBackgrounds && <span style={{ fontSize: '0.8rem', color: 'var(--color-warning)' }}>{t('workbench.noBackgroundsWarning')}</span>}
            </div>
            <button className="btn btn-secondary btn-xs"
              onClick={() => navigate(hasCharacters ? '/backgrounds' : '/characters')}>
              {hasCharacters ? t('workbench.goBackgrounds') : t('workbench.goCharacters')}
            </button>
          </div>
        )}

        {/* Compact progress + toolbar */}
        {selectedStory && segments.length > 0 && (
          <>
            {progressStats && progressStats.total > 0 && (
              <div className="workbench-progress">
                <span className="workbench-progress-label">{progressStats.success}/{progressStats.total} {t('workbench.completed')}</span>
                <div
                  className="workbench-progress-bar"
                  role="progressbar"
                  aria-valuenow={progressStats.success}
                  aria-valuemin={0}
                  aria-valuemax={progressStats.total}
                  aria-label={t('workbench.completed', '已完成')}
                >
                  {progressStats.success > 0 && <div style={{ width: `${(progressStats.success / progressStats.total) * 100}%`, background: 'var(--color-success)', transition: 'width 0.3s' }} />}
                  {progressStats.processing + progressStats.pending > 0 && <div style={{ width: `${((progressStats.processing + progressStats.pending) / progressStats.total) * 100}%`, background: 'var(--color-warning)', transition: 'width 0.3s' }} />}
                  {progressStats.failed > 0 && <div style={{ width: `${(progressStats.failed / progressStats.total) * 100}%`, background: 'var(--color-danger)', transition: 'width 0.3s' }} />}
                </div>
                <div className="workbench-progress-stats">
                  {progressStats.success > 0 && <span style={{ color: 'var(--color-success)' }}>{progressStats.success}✓</span>}
                  {progressStats.processing + progressStats.pending > 0 && <span style={{ color: 'var(--color-warning)' }}>{progressStats.processing + progressStats.pending}⏳</span>}
                  {progressStats.failed > 0 && <span style={{ color: 'var(--color-danger)' }}>{progressStats.failed}✗</span>}
                  {progressStats.ready > 0 && <span>{progressStats.ready}○</span>}
                </div>
              </div>
            )}

            <div className="workbench-toolbar">
              <select className="form-select btn-xs" style={{ width: '140px' }}
                value={ws.batchBgId} onChange={e => wsDispatch({ type: 'SET_BATCH_BG_ID', value: e.target.value })}>
                <option value="">{t('workbench.batchBgPlaceholder')}</option>
                {backgrounds.map(bg => <option key={bg.id} value={bg.id}>{bg.name}</option>)}
              </select>
              <button className="btn btn-secondary btn-xs" disabled={!ws.batchBgId} onClick={handleBatchSetBackground}>
                <ImagePlus size={12} /> {t('workbench.batchBgBtn')}
              </button>
              <div className="workbench-toolbar-divider" />
              <button className="btn btn-primary btn-xs" onClick={handleBatchGenerate}
                disabled={ws.isBatchGenerating || !hasBackgrounds}>
                <PlayCircle size={12} />
                {ws.isBatchGenerating ? t('workbench.batchGenerating') : t('workbench.batchGenerateBtn')}
              </button>
              {/* P0-1：批量生成旁白 */}
              <button
                className="btn btn-secondary btn-xs"
                onClick={handleBatchNarrate}
                disabled={ws.isBatchNarrating || segments.length === 0}
                title={t('workbench.batchNarrateTitle')}
              >
                {ws.isBatchNarrating ? t('workbench.generating') : t('workbench.batchNarrate')}
              </button>
              {/* P0-1：批量生成 BGM */}
              <button
                className="btn btn-secondary btn-xs"
                onClick={handleBatchBGM}
                disabled={ws.isBatchBgmGenerating || segments.length === 0}
                title={t('workbench.batchBGMTitle')}
              >
                {ws.isBatchBgmGenerating ? t('workbench.generating') : t('workbench.batchBGM')}
              </button>
              <button className="btn btn-primary btn-xs" onClick={handleAssembleFinalVideo}
                disabled={ws.isAssembling || progressStats?.success !== progressStats?.total}>
                <Film size={12} />
                {ws.isAssembling ? (ws.assembleProgress?.message || t('workbench.assembling', '合成中...')) : t('workbench.assembleBtn', '一键合成导出')}
              </button>
              <button
                className="btn btn-secondary btn-xs"
                onClick={() => ws.selectedStoryId && navigate(`/editor?storyId=${ws.selectedStoryId}`)}
                disabled={!ws.selectedStoryId}
                title={t('workbench.openEditor', '打开剪辑工作台')}
              >
                <Scissors size={12} />
                {t('workbench.openEditor', '剪辑')}
              </button>
              <div className="workbench-toolbar-divider" />
              <select className="form-select btn-xs" style={{ width: '90px' }}
                value={ws.videoMode} onChange={e => wsDispatch({ type: 'SET_VIDEO_MODE', value: e.target.value as typeof ws.videoMode })}>
                <option value="t2v">{t('video.modeT2V')}</option>
                <option value="fl2v">{t('video.modeFL2V')}</option>
                <option value="s2v">{t('video.modeS2V')}</option>
              </select>
              {ws.videoMode === 't2v' && (
                <select className="form-select btn-xs" style={{ width: '130px' }}
                  value={ws.videoModel} onChange={e => wsDispatch({ type: 'SET_VIDEO_MODEL', value: e.target.value as typeof ws.videoModel })}>
                  <option value="MiniMax-Hailuo-2.3">Hailuo 2.3</option>
                  <option value="MiniMax-Hailuo-02">Hailuo 02</option>
                  <option value="T2V-01-Director">T2V-01 Director</option>
                  <option value="T2V-01">T2V-01</option>
                </select>
              )}
              <select className="form-select btn-xs" style={{ width: '65px' }}
                value={ws.videoResolution} onChange={e => wsDispatch({ type: 'SET_VIDEO_RESOLUTION', value: e.target.value as typeof ws.videoResolution })}>
                <option value="768P">768P</option>
                <option value="1080P">1080P</option>
              </select>
              <select className="form-select btn-xs" style={{ width: '55px' }}
                value={ws.videoDuration} onChange={e => wsDispatch({ type: 'SET_VIDEO_DURATION', value: Number(e.target.value) as 6 | 10 })}>
                <option value={6}>6s</option>
                <option value={10}>10s</option>
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.7rem' }}>
                <input type="checkbox" checked={ws.videoPromptOptimizer} onChange={e => wsDispatch({ type: 'SET_VIDEO_PROMPT_OPTIMIZER', value: e.target.checked })}
                  style={{ width: '12px', height: '12px' }} />
                {t('video.promptOptimizer')}
              </label>
            </div>
          </>
        )}

        {!ws.selectedStoryId ? (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: '2rem' }}>{t('workbench.selectStory')}</p>
        ) : segments.length === 0 ? (
          <AsyncState empty emptyText={t('workbench.noSegments')} />
        ) : (
          <div className="workbench-segments">
            {segments.map((seg, idx) => (
              <SegmentCard
                key={seg.id}
                segment={seg}
                index={idx}
                task={latestTaskMap.get(seg.id)}
                characterMap={characterMap}
                backgrounds={backgrounds}
                narrationStatus={ws.narrationStatuses[seg.id]}
                narrationUrl={ws.narrationUrls[seg.id]}
                isBGMEditing={bgm.segmentId === seg.id}
                bgmPrompt={bgm.prompt}
                bgmMode={bgm.mode}
                bgmLyrics={bgm.lyrics}
                bgmModel={bgm.model}
                bgmCoverAudioUrl={bgm.coverAudioUrl}
                isGeneratingBGM={bgm.isGenerating}
                isGeneratingLyrics={bgm.isGeneratingLyrics}
                suggestingBGMStyle={bgm.isSuggestingStyle}
                onSelectBackground={handleSelectBackground}
                onGenerateVideo={handleGenerateVideo}
                onGenerateNarration={handleGenerateNarration}
                onRemoveBGM={handleRemoveBGM}
                onBGMEditStart={() => bgmDispatch({ type: 'START_EDIT', segmentId: seg.id })}
                onBGMEditCancel={handleBGMEditCancel}
                onBgmPromptChange={handleBgmPromptChange}
                onBgmModeChange={handleBgmModeChange}
                onBgmModelChange={handleBgmModelChange}
                onBgmLyricsChange={handleBgmLyricsChange}
                onBgmCoverAudioUrlChange={handleBgmCoverAudioUrlChange}
                onGenerateBGM={() => handleGenerateBGM(seg.id)}
                onGenerateLyrics={() => handleGenerateLyrics()}
                onSuggestBGMStyle={handleSuggestBGMStyle}
                onUpdateActionContent={handleUpdateActionContent}
                onUpdateFirstFrameImage={handleUpdateFirstFrameImage}
                onPickImage={() => handlePickImage(seg.id)}
                onPickNarrationPrompt={() => handlePickNarrationPrompt(seg.id)}
              />
            ))}
          </div>
        )}
      </div>
      {assetPickerState.isOpen && currentSpaceId && (
        <AssetPicker
          type={assetPickerState.type}
          spaceId={currentSpaceId}
          category={assetPickerState.category}
          onSelect={assetPickerState.onSelect!}
          onClose={closePicker}
        />
      )}
    </div>
  );
};