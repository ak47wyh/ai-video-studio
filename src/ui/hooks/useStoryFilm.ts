import { useState, useCallback, useRef } from 'react';
import type { VideoStyle } from '../../domain/entities/models';
import type { PipelineStatus } from '../../domain/services/PipelineService';
import { pipelineService, storyFilmService } from '../../dependencies';
import { useToast } from '../contexts/ToastContext';
import { useTranslation } from 'react-i18next';

export interface StoryFilmProgress {
  stage: PipelineStatus;
  percent: number;
  message: string;
}

export type StoryFilmStep = 'config' | 'generating' | 'preview';

/** U-2：Pipeline 阶段顺序（用于估算剩余时间） */
const ESTIMATE_STAGE_ORDER = [
  'splitting', 'generating_images', 'generating_audio', 'generating_bgm',
  'generating_videos', 'post_processing', 'generating_srt', 'burning_subtitles',
] as const;

/** 估算阶段推进所需的最小经过时长（ms），避免首 30s 内抖动 */
const ESTIMATE_MIN_ELAPSED_MS = 30_000;

/**
 * U-2 预计剩余时间（秒）纯函数：按已过时长 / 已过阶段数求得阶段均值，乘以剩余阶段数。
 * elapsedMs < 30s 或 stageIndex < 0 时返回 null（无法估算）。
 */
export function estimateRemainingSec(elapsedMs: number, stageIndex: number, totalStages: number): number | null {
  if (elapsedMs < ESTIMATE_MIN_ELAPSED_MS || stageIndex < 0 || stageIndex >= totalStages) return null;
  const remainingStages = totalStages - stageIndex - 1;
  if (remainingStages <= 0) return null;
  return ((elapsedMs / (stageIndex + 1)) * remainingStages) / 1000;
}

export interface UseStoryFilmResult {
  step: StoryFilmStep;
  progress: StoryFilmProgress | null;
  result: { storyId: string; pipelineTaskId: string } | null;
  isGeneratingText: boolean;
  generatedText: string;
  startFilm: (options: {
    storyText?: string;
    theme?: string;
    keyPoints?: string[];
    videoStyle: VideoStyle;
    voiceId?: string;
    aspectRatio?: '16:9' | '9:16';
    videoDuration?: 6 | 10;
    includeBGM?: boolean;
    includeSubtitles?: boolean;
    spaceId: string;
    title?: string;
  }) => Promise<void>;
  generateText: (theme: string, keyPoints: string[]) => Promise<string>;
  cancelFilm: () => void;
  resetFilm: () => void;
  /** U-2 长任务预计剩余时间（秒）；null 表示暂无法估算 */
  estimatedRemainingSec: number | null;
  /** U-2 是否处于估算起步期（任务开始 30s 内） */
  isEstimating: boolean;
}

export function useStoryFilm(): UseStoryFilmResult {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [step, setStep] = useState<StoryFilmStep>('config');
  const [progress, setProgress] = useState<StoryFilmProgress | null>(null);
  const [result, setResult] = useState<{ storyId: string; pipelineTaskId: string; usedTemplate?: boolean } | null>(null);
  const [isGeneratingText, setIsGeneratingText] = useState(false);
  const [generatedText, setGeneratedText] = useState('');
  const cancelledRef = useRef(false);
  const startedAtRef = useRef(0);
  const [estimatedRemainingSec, setEstimatedRemainingSec] = useState<number | null>(null);
  const [isEstimating, setIsEstimating] = useState(false);

  const startFilm = useCallback(async (options: Parameters<UseStoryFilmResult['startFilm']>[0]) => {
    cancelledRef.current = false;
    startedAtRef.current = 0;
    setEstimatedRemainingSec(null);
    setIsEstimating(false);
    setStep('generating');
    setProgress(null);
    setResult(null);
    try {
      const filmResult = await storyFilmService.createStoryFilm({
        ...options,
        onProgress: (stage, percent, message) => {
          if (cancelledRef.current) return;
          setProgress({ stage, percent, message });
          // U-2：按阶段均值估算剩余时间（首 30s 内仅标记估算中）
          const now = Date.now();
          if (!startedAtRef.current) startedAtRef.current = now;
          const idx = ESTIMATE_STAGE_ORDER.indexOf(stage as (typeof ESTIMATE_STAGE_ORDER)[number]);
          const elapsed = now - startedAtRef.current;
          if (idx < 0) {
            setEstimatedRemainingSec(null);
            setIsEstimating(false);
            return;
          }
          if (elapsed < ESTIMATE_MIN_ELAPSED_MS) {
            setEstimatedRemainingSec(null);
            setIsEstimating(true);
            return;
          }
          setIsEstimating(false);
          setEstimatedRemainingSec(estimateRemainingSec(elapsed, idx, ESTIMATE_STAGE_ORDER.length));
        },
      });
      if (!cancelledRef.current) {
        setResult(filmResult);
        setStep('preview');
        showToast('success', t('storyFilm.generateSuccess', '视频生成完成'));
        if (filmResult.usedTemplate) {
          showToast('info', t('storyFilm.templateFallback', '文案生成失败，已使用模板故事继续'));
        }
      }
    } catch (e) {
      if (!cancelledRef.current) {
        setStep('config');
        const msg = e instanceof Error ? e.message : String(e);
        showToast('error', t('storyFilm.generateFailed', '生成失败') + `: ${msg}`);
      }
    }
  }, [showToast, t]);

  const generateText = useCallback(async (theme: string, keyPoints: string[]): Promise<string> => {
    setIsGeneratingText(true);
    try {
      const text = await storyFilmService.generateStoryText(theme, keyPoints);
      setGeneratedText(text);
      return text;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast('error', t('storyFilm.textGenerateFailed', '文案生成失败') + `: ${msg}`);
      throw e;
    } finally {
      setIsGeneratingText(false);
    }
  }, [showToast, t]);

  const cancelFilm = useCallback(() => {
    cancelledRef.current = true;
    setStep('config');
    setProgress(null);
    setEstimatedRemainingSec(null);
    setIsEstimating(false);
    // P1-7 任务级取消：触达 PipelineService（排队任务直接取消，执行中任务阶段间停止）
    if (result?.pipelineTaskId) pipelineService.cancelTask(result.pipelineTaskId);
  }, [result]);

  const resetFilm = useCallback(() => {
    cancelledRef.current = true;
    setStep('config');
    setProgress(null);
    setResult(null);
    setGeneratedText('');
    setEstimatedRemainingSec(null);
    setIsEstimating(false);
  }, []);

  return { step, progress, result, isGeneratingText, generatedText, startFilm, generateText, cancelFilm, resetFilm, estimatedRemainingSec, isEstimating };
}
