import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Loader2, CheckCircle2, XCircle, Clock, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import { pipelineService } from '../../dependencies';
import type { PipelineTask, PipelineOptions, PipelineStatus } from '../../domain/services/PipelineService';
import type { VideoGenerationMode, VideoResolution } from '../../domain/ports/OutboundPorts';

interface PipelinePanelProps {
  storyId: string | null;
  storyTitle: string;
}

const STAGE_LABELS: Record<PipelineStatus, string> = {
  idle: '等待开始',
  splitting: '故事拆分',
  generating_images: '图片生成',
  generating_audio: '旁白生成',
  generating_bgm: 'BGM 生成',
  generating_videos: '视频生成',
  post_processing: '后期合成',
  generating_srt: '字幕生成',
  burning_subtitles: '字幕烧录',
  complete: '完成',
  failed: '失败',
};

const getStageIcon = (status: 'pending' | 'running' | 'done' | 'failed') => {
  switch (status) {
    case 'done': return <CheckCircle2 size={14} color="#34d399" />;
    case 'running': return <Loader2 size={14} className="spin" color="#fbbf24" />;
    case 'failed': return <XCircle size={14} color="#f87171" />;
    default: return <Clock size={14} color="#6b7280" />;
  }
};

export const PipelinePanel: React.FC<PipelinePanelProps> = ({ storyId, storyTitle }) => {
  const { t } = useTranslation();
  const [isRunning, setIsRunning] = useState(false);
  const [currentTask, setCurrentTask] = useState<PipelineTask | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [options, setOptions] = useState<PipelineOptions>({
    videoMode: 't2v',
    videoModel: 'T2V-01-Director',
    videoResolution: '768P',
    videoDuration: 6,
    promptOptimizer: true,
    includeNarration: true,
    includeBGM: true,
    includeSubtitles: true,
    concurrency: 2,
  });

  useEffect(() => {
    if (!currentTask?.id) return;
    const unsub = pipelineService.subscribe(currentTask.id, (updated) => {
      setCurrentTask(updated);
      if (updated.status === 'complete' || updated.status === 'failed') {
        setIsRunning(false);
      }
    });
    return unsub;
  }, [currentTask?.id]);

  const handleStart = useCallback(async () => {
    if (!storyId) return;
    setIsRunning(true);
    setExpanded(true);
    try {
      const task = await pipelineService.runFullPipeline(storyId, {
        ...options,
        onProgress: () => { },
      });
      setCurrentTask(task);
    } catch { /* ignore */ }
  }, [storyId, options]);

  // A3 断点续跑：普通函数（每次渲染重建），避免 memoization 依赖竞态
  const handleResume = async () => {
    if (!currentTask?.id) return;
    setIsRunning(true);
    setExpanded(true);
    try {
      // A3 断点续跑：从第一个未完成阶段继续，已完成资产自动跳过
      const task = await pipelineService.resumePipeline(currentTask.id, {
        ...options,
        onProgress: () => { },
      });
      setCurrentTask(task);
    } catch { /* ignore */ }
  };

  const handleCancel = () => {
    if (currentTask?.id) {
      pipelineService.cancelTask(currentTask.id);
      setIsRunning(false);
    }
  };

  const progressPercent = currentTask?.progress ?? 0;

  return (
    <div style={{
      padding: '1rem 1.25rem', borderRadius: 'var(--radius-lg)',
      background: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(236,72,153,0.08))',
      border: '1px solid rgba(99,102,241,0.2)',
      marginBottom: '1.5rem',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>
            {t('pipeline.title', { title: storyTitle })}
          </h3>
          {currentTask && (
            <span style={{
              fontSize: '0.75rem', padding: '0.15rem 0.6rem', borderRadius: '999px',
              fontWeight: 600,
              background: currentTask.status === 'complete' ? 'rgba(52,211,153,0.15)' :
                currentTask.status === 'failed' ? 'rgba(248,113,113,0.15)' : 'rgba(251,191,36,0.15)',
              color: currentTask.status === 'complete' ? '#34d399' :
                currentTask.status === 'failed' ? '#f87171' : '#fbbf24',
            }}>
              {STAGE_LABELS[currentTask.status]}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {!isRunning && currentTask?.status === 'failed' && currentTask.steps.some(s => s.status === 'done') && (
            <button className="btn btn-secondary" onClick={handleResume}
              style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <RotateCcw size={14} /> {t('pipeline.resumeBtn')}
            </button>
          )}
          {!isRunning ? (
            <button className="btn btn-primary" disabled={!storyId}
              onClick={handleStart}
              style={{ background: 'linear-gradient(135deg, #6366f1, #ec4899)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Play size={14} /> {t('pipeline.startBtn')}
            </button>
          ) : (
            <button className="btn btn-secondary" onClick={handleCancel}
              style={{ fontSize: '0.8rem', color: '#f87171' }}>
              {t('pipeline.cancelBtn')}
            </button>
          )}
          <button className="btn btn-secondary" style={{ padding: '0.3rem' }}
            onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {currentTask && (
        <div style={{ marginTop: '0.75rem' }}>
          <div style={{ height: '4px', borderRadius: '2px', background: 'var(--border-color)', overflow: 'hidden' }}>
            <div style={{
              width: `${progressPercent}%`, height: '100%',
              background: currentTask.status === 'failed' ? '#f87171' :
                currentTask.status === 'complete' ? '#34d399' : 'linear-gradient(90deg, #6366f1, #ec4899)',
              transition: 'width 0.5s ease',
            }} />
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
            {currentTask.currentStep} — {progressPercent}%
          </p>
        </div>
      )}

      {expanded && (
        <div style={{ marginTop: '1rem' }}>
          {!isRunning && !currentTask && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.5rem', marginBottom: '1rem' }}>
              <label style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <input type="checkbox" checked={options.includeNarration}
                  onChange={e => setOptions(p => ({ ...p, includeNarration: e.target.checked }))} />
                {t('pipeline.includeNarration')}
              </label>
              <label style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <input type="checkbox" checked={options.includeBGM}
                  onChange={e => setOptions(p => ({ ...p, includeBGM: e.target.checked }))} />
                {t('pipeline.includeBGM')}
              </label>
              <label style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <input type="checkbox" checked={options.includeSubtitles}
                  onChange={e => setOptions(p => ({ ...p, includeSubtitles: e.target.checked }))} />
                {t('pipeline.includeSubtitles')}
              </label>
              <select className="form-select" style={{ fontSize: '0.75rem', padding: '0.2rem 0.4rem' }}
                value={options.videoMode} onChange={e => setOptions(p => ({ ...p, videoMode: e.target.value as VideoGenerationMode }))}>
                <option value="t2v">T2V</option>
                <option value="fl2v">FL2V</option>
                <option value="s2v">S2V</option>
              </select>
              <select className="form-select" style={{ fontSize: '0.75rem', padding: '0.2rem 0.4rem' }}
                value={options.videoResolution} onChange={e => setOptions(p => ({ ...p, videoResolution: e.target.value as VideoResolution }))}>
                <option value="768P">768P</option>
                <option value="1080P">1080P</option>
              </select>
              <select className="form-select" style={{ fontSize: '0.75rem', padding: '0.2rem 0.4rem' }}
                value={options.videoDuration} onChange={e => setOptions(p => ({ ...p, videoDuration: Number(e.target.value) as 6 | 10 }))}>
                <option value={6}>6s</option>
                <option value={10}>10s</option>
              </select>
            </div>
          )}

          {currentTask && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {currentTask.steps.map((step, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
                  {getStageIcon(step.status)}
                  <span style={{ color: step.status === 'pending' ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                    {STAGE_LABELS[step.name as PipelineStatus]}
                  </span>
                  {step.error && (
                    <span style={{ fontSize: '0.7rem', color: '#f87171', marginLeft: '0.5rem' }}>{step.error}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};