import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Film, Image, Layers, User, FileText, RefreshCw, ChevronDown, ChevronUp, AlertCircle, SplitSquareHorizontal } from 'lucide-react';
import { videoLabService, videoTaskRepo } from '../../dependencies';
import type { VideoModel, VideoResolution, VideoGenerationMode, VideoAgentContext } from '../../domain/ports/OutboundPorts';
import type { VideoTaskStatus } from '../../domain/entities/models';
import { useToast } from '../contexts/ToastContext';
import { getErrorMessage } from '../utils/errorUtils';
import { CameraDirectivePanel } from '../components/CameraDirectivePanel';
import { VideoTaskCard } from '../components/VideoTaskCard';
import { VideoCompare } from '../components/VideoCompare';
import { ImageUploadField } from '../components/ImageUploadField';
import { fileToBase64 } from '../utils/imageUtils';
import type { VideoLabTask } from '../components/VideoTaskCard';
import { LabPageLayout } from '../components/LabPageLayout';
import { AsyncState } from '../components/AsyncState';
import { UnsupportedCapabilityNotice } from '../components/UnsupportedCapabilityNotice';
import { usePlatformCapabilities } from '../hooks/usePlatformCapabilities';
import { usePlatform } from '../contexts/PlatformContext';
import { ApiConfigStore } from '../../adapters/outbound/config/ApiConfigStore';
import { isPlatformReady } from '../utils/platformReady';
import { TextAreaWithCounter } from '../components/TextAreaWithCounter';
import { InputWithCounter } from '../components/InputWithCounter';
import { SegmentPicker, type SegmentBindField } from '../components/SegmentPicker';
import { TEXT_LIMITS } from '../../domain/constants/textLimits';
import { validateTextLimit } from '../utils/validateTextLimit';
import type { PlatformId } from '../../domain/entities/platform';
import { PLATFORM_METADATA } from '../../domain/services/platformCapabilities';

type VideoLabTab = 't2v' | 'i2v' | 'fl2v' | 's2v' | 'agent' | 'tasks';

// ==================== 模型/时长/分辨率联动配置 ====================
interface ModelDurationConfig {
  durations: number[];
  resolutions6s: VideoResolution[];
  resolutions10s: VideoResolution[];
  supportsFastPretreatment: boolean;
  supportsCameraDirective: boolean;
}

const PLATFORM_MODEL_CONFIG: Record<PlatformId, Record<string, ModelDurationConfig>> = {
  minimax: {
    'MiniMax-Hailuo-2.3': { durations: [6, 10], resolutions6s: ['768P', '1080P'], resolutions10s: ['768P'], supportsFastPretreatment: true, supportsCameraDirective: true },
    'MiniMax-Hailuo-2.3-Fast': { durations: [6, 10], resolutions6s: ['768P', '1080P'], resolutions10s: ['768P'], supportsFastPretreatment: true, supportsCameraDirective: true },
    'MiniMax-Hailuo-02': { durations: [6, 10], resolutions6s: ['512P', '768P', '1080P'], resolutions10s: ['512P', '768P'], supportsFastPretreatment: true, supportsCameraDirective: true },
    'T2V-01-Director': { durations: [6], resolutions6s: ['720P'], resolutions10s: [], supportsFastPretreatment: false, supportsCameraDirective: true },
    'T2V-01': { durations: [6], resolutions6s: ['720P'], resolutions10s: [], supportsFastPretreatment: false, supportsCameraDirective: false },
    'I2V-01-Director': { durations: [6], resolutions6s: ['720P'], resolutions10s: [], supportsFastPretreatment: false, supportsCameraDirective: true },
    'I2V-01-live': { durations: [6], resolutions6s: ['720P'], resolutions10s: [], supportsFastPretreatment: false, supportsCameraDirective: false },
    'I2V-01': { durations: [6], resolutions6s: ['720P'], resolutions10s: [], supportsFastPretreatment: false, supportsCameraDirective: false },
    'S2V-01': { durations: [6], resolutions6s: ['720P'], resolutions10s: [], supportsFastPretreatment: false, supportsCameraDirective: false },
  },
  volcengine: {
    'doubao-seedance-2-0-260128': { durations: [6, 10], resolutions6s: ['720P', '1080P'], resolutions10s: ['720P'], supportsFastPretreatment: false, supportsCameraDirective: false },
    'doubao-seedance-2-0-fast-260128': { durations: [6, 10], resolutions6s: ['720P'], resolutions10s: ['720P'], supportsFastPretreatment: false, supportsCameraDirective: false },
    'doubao-seedance-2-0-mini-260615': { durations: [6, 10], resolutions6s: ['720P'], resolutions10s: ['720P'], supportsFastPretreatment: false, supportsCameraDirective: false },
    'doubao-seedance-1-0-pro-250528': { durations: [6, 10], resolutions6s: ['720P', '1080P'], resolutions10s: ['720P'], supportsFastPretreatment: false, supportsCameraDirective: false },
  },
  kling: {
    'kling-v2.1': { durations: [6, 10], resolutions6s: ['720P', '1080P'], resolutions10s: ['720P'], supportsFastPretreatment: false, supportsCameraDirective: false },
    'kling-v2-master': { durations: [6, 10], resolutions6s: ['720P', '1080P'], resolutions10s: ['720P'], supportsFastPretreatment: false, supportsCameraDirective: false },
    'kling-v1.6': { durations: [6, 10], resolutions6s: ['720P'], resolutions10s: ['720P'], supportsFastPretreatment: false, supportsCameraDirective: false },
  },
  wan: {
    'wanx2.1-t2v-turbo': { durations: [6, 10], resolutions6s: ['720P'], resolutions10s: ['720P'], supportsFastPretreatment: false, supportsCameraDirective: false },
    'wanx2.1-t2v-plus': { durations: [6, 10], resolutions6s: ['720P', '1080P'], resolutions10s: ['720P'], supportsFastPretreatment: false, supportsCameraDirective: false },
    'wanx2.1-i2v-turbo': { durations: [6, 10], resolutions6s: ['720P'], resolutions10s: ['720P'], supportsFastPretreatment: false, supportsCameraDirective: false },
    'wanx2.1-i2v-plus': { durations: [6, 10], resolutions6s: ['720P', '1080P'], resolutions10s: ['720P'], supportsFastPretreatment: false, supportsCameraDirective: false },
  },
  hunyuan: {
    'hunyuan-video': { durations: [6, 10], resolutions6s: ['720P'], resolutions10s: ['720P'], supportsFastPretreatment: false, supportsCameraDirective: false },
    'hunyuan-video-i2v': { durations: [6, 10], resolutions6s: ['720P'], resolutions10s: ['720P'], supportsFastPretreatment: false, supportsCameraDirective: false },
  },
  zhipu: {
    'cogvideox-2': { durations: [6], resolutions6s: ['720P'], resolutions10s: [], supportsFastPretreatment: false, supportsCameraDirective: false },
    'cogvideox-flash': { durations: [6], resolutions6s: ['720P'], resolutions10s: [], supportsFastPretreatment: false, supportsCameraDirective: false },
  },
  vidu: {
    'viduq1': { durations: [6, 8, 10], resolutions6s: ['720P', '1080P'], resolutions10s: ['720P'], supportsFastPretreatment: false, supportsCameraDirective: false },
    'vidu-1': { durations: [6, 8, 10], resolutions6s: ['720P', '1080P'], resolutions10s: ['720P'], supportsFastPretreatment: false, supportsCameraDirective: false },
    'vidu-2': { durations: [6, 8, 10], resolutions6s: ['720P', '1080P'], resolutions10s: ['720P'], supportsFastPretreatment: false, supportsCameraDirective: false },
  },
};

const VIDEO_AGENT_TEMPLATES = [
  { id: '393769180141805569', nameKey: 'videoLab.templateName', descKey: 'videoLab.templateDesc' },
];

const POLLING_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟轮询超时

// ==================== 共享子组件: VideoModelConfig ====================
interface VideoModelConfigProps {
  activePlatform: PlatformId;
  models: VideoModel[];
  model: VideoModel;
  onModelChange: (m: VideoModel) => void;
  duration: 6 | 10;
  onDurationChange: (d: 6 | 10) => void;
  resolution: VideoResolution;
  onResolutionChange: (r: VideoResolution) => void;
  promptOptimizer: boolean;
  onPromptOptimizerChange: (v: boolean) => void;
  fastPretreatment: boolean;
  onFastPretreatmentChange: (v: boolean) => void;
  watermark: boolean;
  onWatermarkChange: (v: boolean) => void;
  showDuration?: boolean;
  showAdvanced?: boolean;
}

const VideoModelConfig: React.FC<VideoModelConfigProps> = ({
  activePlatform, models, model, onModelChange, duration, onDurationChange, resolution, onResolutionChange,
  promptOptimizer, onPromptOptimizerChange, fastPretreatment, onFastPretreatmentChange,
  watermark, onWatermarkChange, showDuration = true, showAdvanced = true,
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const cfg = PLATFORM_MODEL_CONFIG[activePlatform]?.[model];
  const availableDurations = cfg?.durations || [6];
  const availableResolutions = duration === 10 ? (cfg?.resolutions10s || []) : (cfg?.resolutions6s || ['720P']);

  const handleModelChange = (m: VideoModel) => {
    onModelChange(m);
    const newCfg = PLATFORM_MODEL_CONFIG[activePlatform]?.[m];
    if (newCfg) {
      const resList = duration === 10 ? newCfg.resolutions10s : newCfg.resolutions6s;
      if (!resList.includes(resolution) && resList.length > 0) onResolutionChange(resList[0]);
    }
  };

  const handleDurationChange = (d: 6 | 10) => {
    onDurationChange(d);
    const resList = d === 10 ? (cfg?.resolutions10s || []) : (cfg?.resolutions6s || []);
    if (!resList.includes(resolution) && resList.length > 0) onResolutionChange(resList[0]);
  };

  return (
    <>
      <div className="lab-model-config">
        {models.length > 1 && (
          <div className="lab-model-config-item" style={{ minWidth: '180px' }}>
            <label className="form-label" htmlFor="video-model">{t('videoLab.model', '模型')}</label>
            <select id="video-model" className="form-select" value={model} onChange={e => handleModelChange(e.target.value as VideoModel)}>
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        )}
        {showDuration && (
          <div className="lab-model-config-item" style={{ minWidth: '120px' }}>
            <label className="form-label" htmlFor="video-duration">{t('videoLab.duration', '时长')}</label>
            <select id="video-duration" className="form-select" value={duration} onChange={e => handleDurationChange(Number(e.target.value) as 6 | 10)}>
              {availableDurations.map(d => <option key={d} value={d}>{d}s</option>)}
            </select>
          </div>
        )}
        <div className="lab-model-config-item" style={{ minWidth: '120px' }}>
          <label className="form-label" htmlFor="video-resolution">{t('videoLab.resolution', '分辨率')}</label>
          <select id="video-resolution" className="form-select" value={resolution} onChange={e => onResolutionChange(e.target.value as VideoResolution)}>
            {availableResolutions.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>

      {showAdvanced && (
        <div>
          <button className="advanced-toggle" onClick={() => setExpanded(!expanded)}>
            <span className="advanced-toggle-icon">
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </span>
            <span>{t('videoLab.advancedSettings', '高级设置')}</span>
          </button>
          {expanded && (
            <div className="advanced-content">
              <label className="lab-checkbox-label">
                <input type="checkbox" checked={promptOptimizer} onChange={e => onPromptOptimizerChange(e.target.checked)} /> {t('videoLab.promptOptimizer', 'Prompt 优化')}
              </label>
              {cfg?.supportsFastPretreatment && (
                <label className="lab-checkbox-label">
                  <input type="checkbox" checked={fastPretreatment} onChange={e => onFastPretreatmentChange(e.target.checked)} /> {t('videoLab.fastPretreatment', '快速预处理')}
                </label>
              )}
              <label className="lab-checkbox-label">
                <input type="checkbox" checked={watermark} onChange={e => onWatermarkChange(e.target.checked)} /> {t('videoLab.watermark', '添加水印')}
              </label>
            </div>
          )}
        </div>
      )}
    </>
  );
};

// ==================== 主页面 ====================
export const VideoLab: React.FC = () => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { hasCapability: hasCap } = usePlatformCapabilities();
  const { activePlatform } = usePlatform();
  const platformReady = isPlatformReady(ApiConfigStore.load(), activePlatform);

  // 模型列表统一来自 PLATFORM_METADATA（单一数据源），不再 UI 层硬编码模型 ID
  const videoModels = useMemo(() => {
    return (PLATFORM_METADATA[activePlatform]?.videoModels ?? []) as VideoModel[];
  }, [activePlatform]);

  const [activeTab, setActiveTab] = useState<VideoLabTab>('t2v');

  // ==================== Tasks ====================
  const [tasks, setTasks] = useState<VideoLabTask[]>([]);
  const stopPollingRef = useRef<Map<string, () => void>>(new Map());
  // 重试挂起状态:记录待重试的模式,useEffect 中检测并触发自动重新提交
  const [pendingRetry, setPendingRetry] = useState<VideoGenerationMode | 'agent' | null>(null);

  // 组件卸载时清理所有轮询
  useEffect(() => {
    const ref = stopPollingRef;
    return () => {
      for (const [, stop] of ref.current) stop();
      ref.current.clear();
      videoLabService.cancelAllPolling();
    };
  }, []);

  // 页面加载时从 videoTaskRepo 恢复历史任务列表，避免刷新后空列表
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const allStatuses: VideoTaskStatus[] = ['PENDING', 'PROCESSING', 'SUCCESS', 'FAILED'];
        const allTasks = await videoTaskRepo.findByStatuses(allStatuses);
        if (cancelled) return;

        const labTasks: VideoLabTask[] = allTasks
          .filter(task => task.targetPlatform === activePlatform)
          .map((task): VideoLabTask => ({
            taskId: task.externalTaskId || task.id,
            mode: (task.mode || 't2v') as VideoGenerationMode | 'agent',
            status: task.status,
            createdAt: task.createdAt,
            model: task.model,
            duration: task.duration,
            resolution: task.resolution,
            videoUrl: task.videoUrl,
            fileId: task.fileId,
            videoWidth: task.videoWidth,
            videoHeight: task.videoHeight,
            errorMessage: task.errorMessage,
          }))
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, 20);

        setTasks(labTasks);

        // 恢复仍在处理中的任务的轮询
        for (const task of labTasks) {
          if (task.status !== 'PENDING' && task.status !== 'PROCESSING') continue;

          const timeoutId = setTimeout(() => {
            const stop = stopPollingRef.current.get(task.taskId);
            if (stop) { stop(); stopPollingRef.current.delete(task.taskId); }
            setTasks(prev => prev.map(item => item.taskId === task.taskId
              ? { ...item, status: 'FAILED', errorMessage: t('videoLab.generateTimeoutError', '生成超时 (5分钟)') }
              : item));
            showToast('error', t('videoLab.generateTimeoutToast', '视频生成超时'));
          }, POLLING_TIMEOUT_MS);

          const stopPolling = videoLabService.startPolling(task.taskId, false, (result) => {
            const status = result.status.toUpperCase();
            setTasks(prev => prev.map(item => {
              if (item.taskId !== task.taskId) return item;
              return {
                ...item,
                status,
                videoUrl: 'videoUrl' in result ? result.videoUrl : undefined,
                fileId: 'fileId' in result ? result.fileId : undefined,
                videoWidth: 'videoWidth' in result ? result.videoWidth : undefined,
                videoHeight: 'videoHeight' in result ? result.videoHeight : undefined,
                errorMessage: 'errorMessage' in result ? result.errorMessage : undefined,
              };
            }));
            if (status === 'SUCCESS' || status === 'FAIL' || status === 'FAILED') {
              clearTimeout(timeoutId);
              if (status === 'SUCCESS') {
                showToast('success', t('videoLab.generateSuccessToast', '视频生成成功！'));
              } else {
                showToast('error', t('videoLab.generateFailedToast', '视频生成失败'));
              }
            }
          });
          stopPollingRef.current.set(task.taskId, () => { stopPolling(); clearTimeout(timeoutId); });
        }
      } catch {
        // 恢复失败时静默处理，不影响页面正常使用
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅页面加载时执行一次，恢复历史任务
  }, []);

  // ==================== T2V State ====================
  const [t2vPrompt, setT2vPrompt] = useState('');
  const [t2vModel, setT2vModel] = useState<VideoModel>(() => (PLATFORM_METADATA[activePlatform]?.videoModels?.[0] ?? '') as VideoModel);
  const [t2vDuration, setT2vDuration] = useState<6 | 10>(6);
  const [t2vResolution, setT2vResolution] = useState<VideoResolution>('768P');
  const [t2vPromptOptimizer, setT2vPromptOptimizer] = useState(true);
  const [t2vFastPretreatment, setT2vFastPretreatment] = useState(false);
  const [t2vWatermark, setT2vWatermark] = useState(false);
  const [isSubmittingT2V, setIsSubmittingT2V] = useState(false);

  // ==================== I2V State ====================
  const [i2vFirstFrame, setI2vFirstFrame] = useState<string | null>(null);
  const [i2vPrompt, setI2vPrompt] = useState('');
  const [i2vModel, setI2vModel] = useState<VideoModel>(() => (PLATFORM_METADATA[activePlatform]?.videoModels?.[0] ?? '') as VideoModel);
  const [i2vDuration, setI2vDuration] = useState<6 | 10>(6);
  const [i2vResolution, setI2vResolution] = useState<VideoResolution>('720P');
  const [i2vPromptOptimizer, setI2vPromptOptimizer] = useState(true);
  const [i2vFastPretreatment, setI2vFastPretreatment] = useState(false);
  const [i2vWatermark, setI2vWatermark] = useState(false);
  const [isSubmittingI2V, setIsSubmittingI2V] = useState(false);

  // 平台切换时重置模型选择为该平台的默认模型
  useEffect(() => {
    const defaultModel = PLATFORM_METADATA[activePlatform]?.videoModels?.[0];
    if (defaultModel) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 平台切换时需要同步默认模型
      setT2vModel(defaultModel as VideoModel);
      setI2vModel(defaultModel as VideoModel);
    }
  }, [activePlatform]);

  // ==================== FL2V State ====================
  const [fl2vFirstFrame, setFl2vFirstFrame] = useState<string | null>(null);
  const [fl2vLastFrame, setFl2vLastFrame] = useState<string | null>(null);
  const [fl2vPrompt, setFl2vPrompt] = useState('');
  const [fl2vDuration, setFl2vDuration] = useState<6 | 10>(6);
  const [fl2vResolution, setFl2vResolution] = useState<VideoResolution>('768P');
  const [fl2vPromptOptimizer, setFl2vPromptOptimizer] = useState(true);
  const [fl2vWatermark, setFl2vWatermark] = useState(false);
  const [isSubmittingFL2V, setIsSubmittingFL2V] = useState(false);

  // ==================== S2V State ====================
  const [s2vSubjectImage, setS2vSubjectImage] = useState<string | null>(null);
  const [s2vPrompt, setS2vPrompt] = useState('');
  const [s2vPromptOptimizer, setS2vPromptOptimizer] = useState(true);
  const [s2vWatermark, setS2vWatermark] = useState(false);
  const [isSubmittingS2V, setIsSubmittingS2V] = useState(false);

  // ==================== Agent State ====================
  const [agentTemplateId, setAgentTemplateId] = useState(VIDEO_AGENT_TEMPLATES[0]?.id || '');
  const [agentTextInput, setAgentTextInput] = useState('');
  const [agentMediaFile, setAgentMediaFile] = useState<File | null>(null);
  const [isSubmittingAgent, setIsSubmittingAgent] = useState(false);

  // ==================== SegmentPicker (发送到分镜) ====================
  const [pickerAsset, setPickerAsset] = useState<{ url: string; field: SegmentBindField; prompt?: string } | null>(null);
  const [showCompare, setShowCompare] = useState(false);

  // ==================== Helpers ====================
  const insertDirective = (setter: React.Dispatch<React.SetStateAction<string>>, directive: string) => {
    setter(prev => prev + `[${directive}]`);
  };

  // ==================== 业务闭环: 使用视频到分镜 ====================
  const handleUseInStory = useCallback((task: VideoLabTask) => {
    if (!task.videoUrl) return;
    // P0-5: 统一走 SegmentPicker，与其他 Lab 一致
    setPickerAsset({ url: task.videoUrl, field: 'video' as SegmentBindField });
  }, []);

  // ==================== 业务闭环: 跨Tab使用图片 ====================
  const handleUseAsInput = useCallback((url: string, target: 'i2v-first' | 'fl2v-first' | 'fl2v-last' | 's2v-subject') => {
    switch (target) {
      case 'i2v-first': setI2vFirstFrame(url); setActiveTab('i2v'); break;
      case 'fl2v-first': setFl2vFirstFrame(url); setActiveTab('fl2v'); break;
      case 'fl2v-last': setFl2vLastFrame(url); setActiveTab('fl2v'); break;
      case 's2v-subject': setS2vSubjectImage(url); setActiveTab('s2v'); break;
    }
    showToast('success', t('videoLab.imageFilledToast', '已填入图片，可在目标 Tab 中继续操作'));
  }, [showToast, t]);

  // ==================== Submit & Polling ====================
  const addTaskAndPoll = useCallback((taskId: string, mode: VideoGenerationMode | 'agent', prompt: string, model?: string, duration?: number, resolution?: string, isAgent = false, originalParams?: Partial<VideoLabTask>) => {
    const task: VideoLabTask = {
      taskId,
      mode,
      status: 'PROCESSING',
      prompt: prompt.substring(0, 100),
      createdAt: Date.now(),
      model,
      duration,
      resolution,
      ...originalParams,
    };
    setTasks(prev => [task, ...prev]);
    setActiveTab('tasks');

    // 轮询超时定时器
    const timeoutId = setTimeout(() => {
      const stop = stopPollingRef.current.get(taskId);
      if (stop) { stop(); stopPollingRef.current.delete(taskId); }
      setTasks(prev => prev.map(task => task.taskId === taskId ? { ...task, status: 'FAILED', errorMessage: t('videoLab.generateTimeoutError', '生成超时 (5分钟)') } : task));
      showToast('error', t('videoLab.generateTimeoutToast', '视频生成超时'));
    }, POLLING_TIMEOUT_MS);

    const stopPolling = videoLabService.startPolling(taskId, isAgent, (result) => {
      const status = result.status.toUpperCase();
      setTasks(prev => prev.map(t => {
        if (t.taskId !== taskId) return t;
        return {
          ...t,
          status,
          videoUrl: 'videoUrl' in result ? result.videoUrl : undefined,
          fileId: 'fileId' in result ? result.fileId : undefined,
          videoWidth: 'videoWidth' in result ? result.videoWidth : undefined,
          videoHeight: 'videoHeight' in result ? result.videoHeight : undefined,
          errorMessage: 'errorMessage' in result ? result.errorMessage : undefined,
        };
      }));
      if (status === 'SUCCESS' || status === 'FAIL' || status === 'FAILED') {
        clearTimeout(timeoutId);
        if (status === 'SUCCESS') {
          showToast('success', t('videoLab.generateSuccessToast', '视频生成成功！'));
        } else {
          showToast('error', t('videoLab.generateFailedToast', '视频生成失败'));
        }
      }
    });
    stopPollingRef.current.set(taskId, () => { stopPolling(); clearTimeout(timeoutId); });
  }, [showToast, t]);

  const handleT2VSubmit = async () => {
    if (!t2vPrompt.trim()) return;
    if (!validateTextLimit(t2vPrompt, TEXT_LIMITS.VIDEO_PROMPT_MAX, t('videoLab.videoPromptLabel', '视频描述'), showToast)) return;
    setIsSubmittingT2V(true);
    try {
      const taskId = await videoLabService.submitTask({
        mode: 't2v', model: t2vModel, prompt: t2vPrompt,
        promptOptimizer: t2vPromptOptimizer, fastPretreatment: t2vFastPretreatment,
        duration: t2vDuration, resolution: t2vResolution, aigcWatermark: t2vWatermark,
      });
      addTaskAndPoll(taskId, 't2v', t2vPrompt, t2vModel, t2vDuration, t2vResolution, false, {
        originalPrompt: t2vPrompt,
        originalModel: t2vModel,
        originalDuration: t2vDuration,
        originalResolution: t2vResolution,
        originalPromptOptimizer: t2vPromptOptimizer,
        originalFastPretreatment: t2vFastPretreatment,
        originalWatermark: t2vWatermark,
      });
      showToast('success', t('videoLab.t2vSubmittedToast', '文生视频任务已提交'));
    } catch (e) {
      showToast('error', getErrorMessage(e, t('videoLab.submitFailedToast', '任务提交失败')));
    } finally {
      setIsSubmittingT2V(false);
    }
  };

  const handleI2VSubmit = async () => {
    if (!i2vFirstFrame) return;
    if (!validateTextLimit(i2vPrompt, TEXT_LIMITS.VIDEO_PROMPT_MAX, t('videoLab.videoPromptLabel', '视频描述'), showToast)) return;
    setIsSubmittingI2V(true);
    try {
      const taskId = await videoLabService.submitTask({
        mode: 'i2v', model: i2vModel, prompt: i2vPrompt, firstFrameImage: i2vFirstFrame,
        promptOptimizer: i2vPromptOptimizer, fastPretreatment: i2vFastPretreatment,
        duration: i2vDuration, resolution: i2vResolution, aigcWatermark: i2vWatermark,
      });
      addTaskAndPoll(taskId, 'i2v', i2vPrompt || t('videoLab.i2vFallbackPrompt', '图生视频'), i2vModel, i2vDuration, i2vResolution, false, {
        originalPrompt: i2vPrompt,
        originalModel: i2vModel,
        originalDuration: i2vDuration,
        originalResolution: i2vResolution,
        originalPromptOptimizer: i2vPromptOptimizer,
        originalFastPretreatment: i2vFastPretreatment,
        originalWatermark: i2vWatermark,
        originalFirstFrame: i2vFirstFrame,
      });
      showToast('success', t('videoLab.i2vSubmittedToast', '图生视频任务已提交'));
    } catch (e) {
      showToast('error', getErrorMessage(e, t('videoLab.submitFailedToast', '任务提交失败')));
    } finally {
      setIsSubmittingI2V(false);
    }
  };

  const handleFL2VSubmit = async () => {
    if (!fl2vFirstFrame || !fl2vLastFrame) return;
    if (!validateTextLimit(fl2vPrompt, TEXT_LIMITS.VIDEO_PROMPT_MAX, t('videoLab.videoPromptLabel', '视频描述'), showToast)) return;
    setIsSubmittingFL2V(true);
    try {
      const fl2vModel = videoModels[0] ?? '';
      const taskId = await videoLabService.submitTask({
        mode: 'fl2v', model: fl2vModel, prompt: fl2vPrompt,
        firstFrameImage: fl2vFirstFrame, lastFrameImage: fl2vLastFrame,
        promptOptimizer: fl2vPromptOptimizer, duration: fl2vDuration,
        resolution: fl2vResolution, aigcWatermark: fl2vWatermark,
      });
      addTaskAndPoll(taskId, 'fl2v', fl2vPrompt || t('videoLab.fl2vFallbackPrompt', '首尾帧视频'), fl2vModel, fl2vDuration, fl2vResolution, false, {
        originalPrompt: fl2vPrompt,
        originalDuration: fl2vDuration,
        originalResolution: fl2vResolution,
        originalPromptOptimizer: fl2vPromptOptimizer,
        originalWatermark: fl2vWatermark,
        originalFirstFrame: fl2vFirstFrame,
        originalLastFrame: fl2vLastFrame,
      });
      showToast('success', t('videoLab.fl2vSubmittedToast', '首尾帧视频任务已提交'));
    } catch (e) {
      showToast('error', getErrorMessage(e, t('videoLab.submitFailedToast', '任务提交失败')));
    } finally {
      setIsSubmittingFL2V(false);
    }
  };

  const handleS2VSubmit = async () => {
    if (!s2vSubjectImage || !s2vPrompt.trim()) return;
    if (!validateTextLimit(s2vPrompt, TEXT_LIMITS.VIDEO_PROMPT_MAX, t('videoLab.videoPromptLabel', '视频描述'), showToast)) return;
    setIsSubmittingS2V(true);
    try {
      const s2vModel = videoModels[0] ?? '';
      const taskId = await videoLabService.submitTask({
        mode: 's2v', model: s2vModel, prompt: s2vPrompt,
        subjectReference: [{ type: 'character', image: [s2vSubjectImage] }],
        promptOptimizer: s2vPromptOptimizer, aigcWatermark: s2vWatermark,
      });
      addTaskAndPoll(taskId, 's2v', s2vPrompt, s2vModel, undefined, undefined, false, {
        originalPrompt: s2vPrompt,
        originalModel: s2vModel,
        originalPromptOptimizer: s2vPromptOptimizer,
        originalWatermark: s2vWatermark,
        originalSubjectImage: s2vSubjectImage,
      });
      showToast('success', t('videoLab.s2vSubmittedToast', '主体参考视频任务已提交'));
    } catch (e) {
      showToast('error', getErrorMessage(e, t('videoLab.submitFailedToast', '任务提交失败')));
    } finally {
      setIsSubmittingS2V(false);
    }
  };

  const handleAgentSubmit = async () => {
    if (!agentTemplateId) return;
    setIsSubmittingAgent(true);
    try {
      const context: VideoAgentContext = { templateId: agentTemplateId };
      if (agentTextInput.trim()) context.textInputs = [{ value: agentTextInput }];
      if (agentMediaFile) {
        const base64 = await fileToBase64(agentMediaFile);
        context.mediaInputs = [{ value: base64 }];
      }
      const taskId = await videoLabService.submitAgentTask(context);
      addTaskAndPoll(taskId, 'agent', agentTextInput || t('videoLab.agentFallbackPrompt', '视频模板'), undefined, undefined, undefined, true);
      showToast('success', t('videoLab.agentSubmittedToast', '视频模板任务已提交'));
    } catch (e) {
      showToast('error', getErrorMessage(e, t('videoLab.submitFailedToast', '任务提交失败')));
    } finally {
      setIsSubmittingAgent(false);
    }
  };

  const handleDeleteTask = (taskId: string) => {
    const stop = stopPollingRef.current.get(taskId);
    if (stop) { stop(); stopPollingRef.current.delete(taskId); }
    setTasks(prev => prev.filter(t => t.taskId !== taskId));
  };

  const handleRetryTask = (task: VideoLabTask) => {
    // 恢复原始参数到对应 Tab 的输入框，并触发自动重新提交
    switch (task.mode) {
      case 't2v':
        if (task.originalPrompt !== undefined) setT2vPrompt(task.originalPrompt);
        if (task.originalModel) setT2vModel(task.originalModel as VideoModel);
        if (task.originalDuration) setT2vDuration(task.originalDuration as 6 | 10);
        if (task.originalResolution) setT2vResolution(task.originalResolution as VideoResolution);
        if (task.originalPromptOptimizer !== undefined) setT2vPromptOptimizer(task.originalPromptOptimizer);
        if (task.originalFastPretreatment !== undefined) setT2vFastPretreatment(task.originalFastPretreatment);
        if (task.originalWatermark !== undefined) setT2vWatermark(task.originalWatermark);
        setActiveTab('t2v');
        setPendingRetry('t2v');
        break;
      case 'i2v':
        if (task.originalPrompt !== undefined) setI2vPrompt(task.originalPrompt);
        if (task.originalFirstFrame !== undefined) setI2vFirstFrame(task.originalFirstFrame);
        if (task.originalModel) setI2vModel(task.originalModel as VideoModel);
        if (task.originalDuration) setI2vDuration(task.originalDuration as 6 | 10);
        if (task.originalResolution) setI2vResolution(task.originalResolution as VideoResolution);
        if (task.originalPromptOptimizer !== undefined) setI2vPromptOptimizer(task.originalPromptOptimizer);
        if (task.originalFastPretreatment !== undefined) setI2vFastPretreatment(task.originalFastPretreatment);
        if (task.originalWatermark !== undefined) setI2vWatermark(task.originalWatermark);
        setActiveTab('i2v');
        setPendingRetry('i2v');
        break;
      case 'fl2v':
        if (task.originalPrompt !== undefined) setFl2vPrompt(task.originalPrompt);
        if (task.originalFirstFrame !== undefined) setFl2vFirstFrame(task.originalFirstFrame);
        if (task.originalLastFrame !== undefined) setFl2vLastFrame(task.originalLastFrame);
        if (task.originalDuration) setFl2vDuration(task.originalDuration as 6 | 10);
        if (task.originalResolution) setFl2vResolution(task.originalResolution as VideoResolution);
        if (task.originalPromptOptimizer !== undefined) setFl2vPromptOptimizer(task.originalPromptOptimizer);
        if (task.originalWatermark !== undefined) setFl2vWatermark(task.originalWatermark);
        setActiveTab('fl2v');
        setPendingRetry('fl2v');
        break;
      case 's2v':
        if (task.originalPrompt !== undefined) setS2vPrompt(task.originalPrompt);
        if (task.originalSubjectImage !== undefined) setS2vSubjectImage(task.originalSubjectImage);
        if (task.originalPromptOptimizer !== undefined) setS2vPromptOptimizer(task.originalPromptOptimizer);
        if (task.originalWatermark !== undefined) setS2vWatermark(task.originalWatermark);
        setActiveTab('s2v');
        setPendingRetry('s2v');
        break;
      default:
        setActiveTab('agent');
        showToast('info', t('videoLab.switchedToAgent', '已切换到视频模板，请重新提交'));
        return;
    }
    showToast('info', t('videoLab.retrying', '已恢复参数，正在重新提交...'));
  };

  // 参数恢复后自动重新提交（useEffect 在 state 更新后触发，此时闭包中的 state 已是最新值）
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps -- 重试机制需要延迟到 state 更新后再提交 */
  useEffect(() => {
    if (!pendingRetry) return;
    if (pendingRetry === 't2v') {
      void handleT2VSubmit();
    } else if (pendingRetry === 'i2v') {
      void handleI2VSubmit();
    } else if (pendingRetry === 'fl2v') {
      void handleFL2VSubmit();
    } else if (pendingRetry === 's2v') {
      void handleS2VSubmit();
    }
    setPendingRetry(null);
  }, [pendingRetry]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  // ==================== Tab Buttons ====================
  // 根据当前激活平台的能力矩阵，动态禁用不支持的视频生成模式
  const supportsFl2v = hasCap('videoFl2v');
  const supportsS2v = hasCap('videoS2v');
  const tabs: { key: VideoLabTab; label: string; icon: React.ReactNode; color?: string; disabled?: boolean; disabledReason?: string }[] = [
    { key: 't2v', label: t('videoLab.tabT2V', '文生视频'), icon: <Film size={16} /> },
    { key: 'i2v', label: t('videoLab.tabI2V', '图生视频'), icon: <Image size={16} />, color: 'var(--lab-color-video)' },
    { key: 'fl2v', label: t('videoLab.tabFL2V', '首尾帧'), icon: <Layers size={16} />, color: 'var(--lab-color-music)', disabled: !supportsFl2v, disabledReason: t('videoLab.fl2vDisabledReason', '该平台不支持首尾帧生视频模式') },
    { key: 's2v', label: t('videoLab.tabS2V', '主体参考'), icon: <User size={16} />, color: 'var(--lab-color-image)', disabled: !supportsS2v, disabledReason: t('videoLab.s2vDisabledReason', '该平台不支持主体参考生视频模式') },
    { key: 'agent', label: t('videoLab.tabAgent', '视频模板'), icon: <FileText size={16} />, color: 'var(--lab-color-text)' },
    { key: 'tasks', label: t('videoLab.tabTasks', '任务管理') + (tasks.length > 0 ? ` (${tasks.length})` : ''), icon: <RefreshCw size={16} />, color: 'var(--lab-color-watermark)' },
  ];

  // P1 平台能力前置检测：视频生成仅部分平台支持，不支持时渲染提示
  if (!hasCap('video')) {
    return <UnsupportedCapabilityNotice capability="video" />;
  }

  return (
    <LabPageLayout
      icon={<Film size={32} />}
      iconBg="color-mix(in srgb, var(--lab-color-video) 10%, transparent)"
      iconColor="var(--lab-color-video)"
      title={t('videoLab.title', '视频实验室 (Video Lab)')}
      subtitle={t('videoLab.subtitle', '文本转视频、图片驱动、首尾帧、主体参考、视频模板与任务管理')}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={(key) => setActiveTab(key as VideoLabTab)}
    >

      {/* ==================== T2V Tab ==================== */}
      {activeTab === 't2v' && (
        <div className="glass-panel slide-up lab-tab-panel">
          <div>
            <label className="form-label" htmlFor="video-t2v-prompt">{t('videoLab.promptLabel', '视频描述 (Prompt)')}</label>
            <TextAreaWithCounter
              id="video-t2v-prompt"
              className="lab-textarea-compact"
              rows={4}
              value={t2vPrompt}
              onChange={e => setT2vPrompt(e.target.value)}
              placeholder={t('videoLab.promptPlaceholder', '描述你想要生成的视频内容，支持 [运镜指令] 语法，例如：一个人拿起一本书 [推进], 然后阅读 [固定]')}
              maxLength={TEXT_LIMITS.VIDEO_PROMPT_MAX}
            />
            {PLATFORM_MODEL_CONFIG[activePlatform]?.[t2vModel]?.supportsCameraDirective && (
              <CameraDirectivePanel onInsert={d => insertDirective(setT2vPrompt, d)} style={{ marginTop: '0.5rem' }} />
            )}
          </div>

          <VideoModelConfig
            activePlatform={activePlatform}
            models={videoModels} model={t2vModel} onModelChange={setT2vModel}
            duration={t2vDuration} onDurationChange={setT2vDuration}
            resolution={t2vResolution} onResolutionChange={setT2vResolution}
            promptOptimizer={t2vPromptOptimizer} onPromptOptimizerChange={setT2vPromptOptimizer}
            fastPretreatment={t2vFastPretreatment} onFastPretreatmentChange={setT2vFastPretreatment}
            watermark={t2vWatermark} onWatermarkChange={setT2vWatermark}
          />

          <button
            className="btn btn-primary btn-generate"
            disabled={!t2vPrompt.trim() || isSubmittingT2V || !platformReady}
            onClick={handleT2VSubmit}
          >
            {isSubmittingT2V ? <RefreshCw className="spin" size={20} aria-hidden="true" /> : <Film size={20} aria-hidden="true" />}
            {isSubmittingT2V ? t('videoLab.submitting', '正在提交任务...') : t('videoLab.generateVideo', '生成视频')}
          </button>
        </div>
      )}

      {/* ==================== I2V Tab ==================== */}
      {activeTab === 'i2v' && (
        <div className="glass-panel slide-up lab-tab-panel">
          <ImageUploadField
            label={t('videoLab.firstFrameRequired', '起始帧图片 (必填)')}
            value={i2vFirstFrame}
            onChange={setI2vFirstFrame}
            borderColor="rgba(59,130,246,0.3)"
            bgColor="rgba(59,130,246,0.05)"
          />

          <div>
            <label className="form-label">{t('videoLab.promptOptionalLabel', '视频描述 (可选)')}</label>
            <TextAreaWithCounter
              className="form-input"
              rows={3}
              value={i2vPrompt}
              onChange={e => setI2vPrompt(e.target.value)}
              placeholder={t('videoLab.promptOptionalPlaceholder', '描述视频内容，支持 [运镜指令]')}
              maxLength={TEXT_LIMITS.VIDEO_PROMPT_MAX}
            />
            {PLATFORM_MODEL_CONFIG[activePlatform]?.[i2vModel]?.supportsCameraDirective && (
              <CameraDirectivePanel onInsert={d => insertDirective(setI2vPrompt, d)} style={{ marginTop: '0.5rem' }} />
            )}
          </div>

          <VideoModelConfig
            activePlatform={activePlatform}
            models={videoModels} model={i2vModel} onModelChange={setI2vModel}
            duration={i2vDuration} onDurationChange={setI2vDuration}
            resolution={i2vResolution} onResolutionChange={setI2vResolution}
            promptOptimizer={i2vPromptOptimizer} onPromptOptimizerChange={setI2vPromptOptimizer}
            fastPretreatment={i2vFastPretreatment} onFastPretreatmentChange={setI2vFastPretreatment}
            watermark={i2vWatermark} onWatermarkChange={setI2vWatermark}
          />

          <button
            className="btn btn-primary btn-generate"
            style={{ background: 'var(--lab-color-image)' }}
            disabled={!i2vFirstFrame || isSubmittingI2V || !platformReady}
            onClick={handleI2VSubmit}
          >
            {isSubmittingI2V ? <RefreshCw className="spin" size={20} aria-hidden="true" /> : <Image size={20} aria-hidden="true" />}
            {isSubmittingI2V ? t('videoLab.submitting', '正在提交任务...') : t('videoLab.generateVideo', '生成视频')}
          </button>
        </div>
      )}

      {/* ==================== FL2V Tab ==================== */}
      {activeTab === 'fl2v' && (
        <div className="glass-panel slide-up lab-tab-panel">
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '200px' }}>
              <ImageUploadField
                label={t('videoLab.firstFrameLabel', '起始帧 (必填)')}
                value={fl2vFirstFrame}
                onChange={setFl2vFirstFrame}
                maxHeight="150px"
                placeholder={t('videoLab.uploadFirstFrame', '上传起始帧')}
              />
            </div>
            <div style={{ flex: 1, minWidth: '200px' }}>
              <ImageUploadField
                label={t('videoLab.lastFrameLabel', '结束帧 (必填)')}
                value={fl2vLastFrame}
                onChange={setFl2vLastFrame}
                borderColor="rgba(139,92,246,0.3)"
                bgColor="rgba(139,92,246,0.05)"
                maxHeight="150px"
                placeholder={t('videoLab.uploadLastFrame', '上传结束帧')}
              />
            </div>
          </div>

          <p className="lab-info-hint">
            {t('videoLab.fl2vHint', '视频尺寸遵循首帧图片；首尾帧尺寸不一致时，模型参考首帧对尾帧裁剪。模型固定为 MiniMax-Hailuo-02。')}
          </p>

          <div>
            <label className="form-label">{t('videoLab.promptOptionalLabel', '视频描述 (可选)')}</label>
            <TextAreaWithCounter
              className="form-input"
              rows={3}
              value={fl2vPrompt}
              onChange={e => setFl2vPrompt(e.target.value)}
              placeholder={t('videoLab.promptOptionalPlaceholder', '描述视频内容，支持 [运镜指令]')}
              maxLength={TEXT_LIMITS.VIDEO_PROMPT_MAX}
            />
            <CameraDirectivePanel onInsert={d => insertDirective(setFl2vPrompt, d)} style={{ marginTop: '0.5rem' }} />
          </div>

          <VideoModelConfig
            activePlatform={activePlatform}
            models={videoModels} model={videoModels[0] ?? ''} onModelChange={() => {}}
            duration={fl2vDuration} onDurationChange={setFl2vDuration}
            resolution={fl2vResolution} onResolutionChange={setFl2vResolution}
            promptOptimizer={fl2vPromptOptimizer} onPromptOptimizerChange={setFl2vPromptOptimizer}
            fastPretreatment={false} onFastPretreatmentChange={() => {}}
            watermark={fl2vWatermark} onWatermarkChange={setFl2vWatermark}
          />

          <button
            className="btn btn-primary btn-generate"
            style={{ background: 'var(--lab-color-image)' }}
            disabled={!fl2vFirstFrame || !fl2vLastFrame || isSubmittingFL2V || !platformReady}
            onClick={handleFL2VSubmit}
          >
            {isSubmittingFL2V ? <RefreshCw className="spin" size={20} aria-hidden="true" /> : <Layers size={20} aria-hidden="true" />}
            {isSubmittingFL2V ? t('videoLab.submitting', '正在提交任务...') : t('videoLab.generateVideo', '生成视频')}
          </button>
        </div>
      )}

      {/* ==================== S2V Tab ==================== */}
      {activeTab === 's2v' && (
        <div className="glass-panel slide-up lab-tab-panel">
          <ImageUploadField
            label={t('videoLab.subjectImageRequired', '人物主体图片 (必填)')}
            value={s2vSubjectImage}
            onChange={setS2vSubjectImage}
            borderColor="rgba(236,72,153,0.3)"
            bgColor="rgba(236,72,153,0.05)"
          />
          <p className="lab-info-hint" style={{ margin: '-0.75rem 0 0 0' }}>
            {t('videoLab.s2vHint', '目前仅支持单个主体，模型固定为 S2V-01')}
          </p>

          <div>
            <label className="form-label">{t('videoLab.promptRequiredLabel', '视频描述 (必填)')}</label>
            <TextAreaWithCounter
              className="form-input"
              rows={3}
              value={s2vPrompt}
              onChange={e => setS2vPrompt(e.target.value)}
              placeholder={t('videoLab.promptSimplePlaceholder', '描述视频内容')}
              maxLength={TEXT_LIMITS.VIDEO_PROMPT_MAX}
            />
          </div>

          <div className="advanced-content">
            <label className="lab-checkbox-label">
              <input type="checkbox" checked={s2vPromptOptimizer} onChange={e => setS2vPromptOptimizer(e.target.checked)} /> {t('videoLab.promptOptimizer', 'Prompt 优化')}
            </label>
            <label className="lab-checkbox-label">
              <input type="checkbox" checked={s2vWatermark} onChange={e => setS2vWatermark(e.target.checked)} /> {t('videoLab.watermark', '添加水印')}
            </label>
          </div>

          <button
            className="btn btn-primary btn-generate"
            style={{ background: '#ec4899' }}
            disabled={!s2vSubjectImage || !s2vPrompt.trim() || isSubmittingS2V || !platformReady}
            onClick={handleS2VSubmit}
          >
            {isSubmittingS2V ? <RefreshCw className="spin" size={20} aria-hidden="true" /> : <User size={20} aria-hidden="true" />}
            {isSubmittingS2V ? t('videoLab.submitting', '正在提交任务...') : t('videoLab.generateVideo', '生成视频')}
          </button>
        </div>
      )}

      {/* ==================== Agent Tab ==================== */}
      {activeTab === 'agent' && (
        <div className="glass-panel slide-up lab-tab-panel">
          <div className="lab-warning-banner" style={{ background: 'var(--color-warning-bg)', border: '1px solid var(--color-warning-border)' }}>
            <AlertCircle size={16} style={{ color: 'var(--color-warning)' }} />
            <span style={{ fontSize: '0.8rem', color: 'var(--color-warning)' }}>{t('videoLab.agentDeprecatedWarning', '模板功能即将下线 (API 已标记为 deprecated)')}</span>
          </div>

          <div>
            <label className="form-label" htmlFor="video-agent-template">{t('videoLab.selectTemplate', '选择模板')}</label>
            <select id="video-agent-template" className="form-select" value={agentTemplateId} onChange={e => setAgentTemplateId(e.target.value)}>
              {VIDEO_AGENT_TEMPLATES.map(tpl => (
                <option key={tpl.id} value={tpl.id}>{t(tpl.nameKey, '人物动态')} - {t(tpl.descKey, '上传人物照片，生成动态视频')}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="form-label">{t('videoLab.textInputLabel', '描述文本')}</label>
            <InputWithCounter className="form-input" value={agentTextInput} onChange={e => setAgentTextInput(e.target.value)} placeholder={t('videoLab.textInputPlaceholder', '输入描述文本')} maxLength={2000} />
          </div>

          <div>
            <label className="form-label">{t('videoLab.mediaImageOptional', '媒体图片 (可选)')}</label>
            <div
              className="lab-upload-zone"
              role="button"
              tabIndex={0}
              aria-label={t('videoLab.uploadMediaImage', '点击上传媒体图片')}
              onClick={() => document.getElementById('agentMediaInput')?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); document.getElementById('agentMediaInput')?.click(); } }}
            >
              <p style={{ margin: 0, color: 'var(--text-color)', fontSize: '0.85rem' }}>
                {agentMediaFile ? agentMediaFile.name : t('videoLab.uploadMediaImage', '点击上传媒体图片')}
              </p>
              <input id="agentMediaInput" type="file" accept="image/*" style={{ display: 'none' }} onChange={e => e.target.files && setAgentMediaFile(e.target.files[0])} />
            </div>
          </div>

          <button
            className="btn btn-primary btn-generate"
            style={{ background: 'var(--color-warning)' }}
            disabled={!agentTemplateId || isSubmittingAgent || !platformReady}
            onClick={handleAgentSubmit}
          >
            {isSubmittingAgent ? <RefreshCw className="spin" size={20} aria-hidden="true" /> : <FileText size={20} aria-hidden="true" />}
            {isSubmittingAgent ? t('videoLab.submitting', '正在提交任务...') : t('videoLab.generateVideo', '生成视频')}
          </button>
        </div>
      )}

      {/* ==================== Tasks Tab ==================== */}
      {activeTab === 'tasks' && (
        <div className="glass-panel slide-up lab-tab-panel">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <h3 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-muted)' }}>{t('videoLab.taskList', '任务列表')} {tasks.length > 0 && `(${tasks.length})`}</h3>
            {tasks.filter(t => t.status === 'SUCCESS' && t.videoUrl).length >= 2 && (
              <button
                className="btn btn-secondary btn-sm"
                style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                onClick={() => setShowCompare(v => !v)}
              >
                <SplitSquareHorizontal size={12} />
                {showCompare ? t('videoLab.collapseCompare', '收起对比') : t('videoLab.versionCompare', '版本对比')}
              </button>
            )}
          </div>

          {/* 版本对比面板（P2-2：接入 VideoCompare，支持多版本并排播放择优） */}
          {showCompare && tasks.filter(t => t.status === 'SUCCESS' && t.videoUrl).length >= 2 && (
            <div style={{ marginBottom: '1rem', padding: '0.75rem', background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
              <VideoCompare
                versions={tasks
                  .filter(t => t.status === 'SUCCESS' && t.videoUrl)
                  .map(t => ({
                    taskId: t.taskId,
                    videoUrl: t.videoUrl!,
                    createdAt: t.createdAt,
                    model: t.model,
                    prompt: t.prompt,
                    mode: t.mode,
                    duration: t.duration,
                  }))}
              />
            </div>
          )}

          {tasks.length === 0 ? (
            <AsyncState empty emptyText={t('videoLab.emptyTasks', '暂无视频任务，去生成第一个视频')} />
          ) : (
            tasks.map(task => (
              <VideoTaskCard
                key={task.taskId}
                task={task}
                onDelete={handleDeleteTask}
                onRetry={handleRetryTask}
                onUseInStory={handleUseInStory}
                onUseAsInput={handleUseAsInput}
                onSendToSegment={(t) => t.videoUrl && setPickerAsset({ url: t.videoUrl, field: 'video' })}
              />
            ))
          )}
        </div>
      )}
      <SegmentPicker
        isOpen={!!pickerAsset}
        assetUrl={pickerAsset?.url ?? ''}
        bindField={pickerAsset?.field ?? 'image'}
        assetPrompt={pickerAsset?.prompt}
        onClose={() => setPickerAsset(null)}
      />
    </LabPageLayout>
  );
};
