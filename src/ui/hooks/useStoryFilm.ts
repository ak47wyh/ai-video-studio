import { useState, useCallback, useRef } from 'react';
import type { VideoStyle } from '../../domain/entities/models';
import type { PipelineStatus } from '../../domain/services/PipelineService';
import { storyFilmService } from '../../dependencies';
import { useToast } from '../contexts/ToastContext';
import { useTranslation } from 'react-i18next';

export interface StoryFilmProgress {
  stage: PipelineStatus;
  percent: number;
  message: string;
}

export type StoryFilmStep = 'config' | 'generating' | 'preview';

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
}

export function useStoryFilm(): UseStoryFilmResult {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [step, setStep] = useState<StoryFilmStep>('config');
  const [progress, setProgress] = useState<StoryFilmProgress | null>(null);
  const [result, setResult] = useState<{ storyId: string; pipelineTaskId: string } | null>(null);
  const [isGeneratingText, setIsGeneratingText] = useState(false);
  const [generatedText, setGeneratedText] = useState('');
  const cancelledRef = useRef(false);

  const startFilm = useCallback(async (options: Parameters<UseStoryFilmResult['startFilm']>[0]) => {
    cancelledRef.current = false;
    setStep('generating');
    setProgress(null);
    setResult(null);
    try {
      const filmResult = await storyFilmService.createStoryFilm({
        ...options,
        onProgress: (stage, percent, message) => {
          if (cancelledRef.current) return;
          setProgress({ stage, percent, message });
        },
      });
      if (!cancelledRef.current) {
        setResult(filmResult);
        setStep('preview');
        showToast('success', t('storyFilm.generateSuccess', '视频生成完成'));
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
  }, []);

  const resetFilm = useCallback(() => {
    cancelledRef.current = true;
    setStep('config');
    setProgress(null);
    setResult(null);
    setGeneratedText('');
  }, []);

  return { step, progress, result, isGeneratingText, generatedText, startFilm, generateText, cancelFilm, resetFilm };
}
