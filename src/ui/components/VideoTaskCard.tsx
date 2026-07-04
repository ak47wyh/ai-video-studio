import React, { useState, useEffect } from 'react';
import { Download, Trash2, RefreshCw, Film, ArrowRight, Image, Layers, User, Send } from 'lucide-react';
import type { VideoGenerationMode } from '../../domain/ports/OutboundPorts';

export interface VideoLabTask {
  taskId: string;
  mode: VideoGenerationMode | 'agent';
  status: string;
  prompt?: string;
  videoUrl?: string;
  fileId?: string;
  videoWidth?: number;
  videoHeight?: number;
  errorMessage?: string;
  createdAt: number;
  model?: string;
  duration?: number;
  resolution?: string;
}

type UseAsInputTarget = 'i2v-first' | 'fl2v-first' | 'fl2v-last' | 's2v-subject';

interface VideoTaskCardProps {
  task: VideoLabTask;
  onDelete?: (taskId: string) => void;
  onRetry?: (task: VideoLabTask) => void;
  onUseInStory?: (task: VideoLabTask) => void;
  onUseAsInput?: (url: string, target: UseAsInputTarget) => void;
  onSendToSegment?: (task: VideoLabTask) => void;
}

const MODE_LABELS: Record<string, string> = {
  t2v: '文生视频',
  i2v: '图生视频',
  fl2v: '首尾帧',
  s2v: '主体参考',
  agent: '视频模板',
};

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  PROCESSING: { color: '#f59e0b', label: '生成中' },
  PREPARING: { color: '#f59e0b', label: '准备中' },
  QUEUEING: { color: '#f59e0b', label: '排队中' },
  SUCCESS: { color: '#34d399', label: '已完成' },
  FAILED: { color: '#ef4444', label: '失败' },
  FAIL: { color: '#ef4444', label: '失败' },
};

export const VideoTaskCard: React.FC<VideoTaskCardProps> = React.memo(({ task, onDelete, onRetry, onUseInStory, onUseAsInput, onSendToSegment }) => {
  const statusKey = task.status.toUpperCase();
  const statusCfg = STATUS_CONFIG[statusKey] || { color: 'var(--text-muted)', label: task.status };
  const [elapsed, setElapsed] = useState(0);
  const [showActions, setShowActions] = useState(false);
  const isProcessing = ['PROCESSING', 'PREPARING', 'QUEUEING'].includes(statusKey);

  useEffect(() => {
    if (!isProcessing) return;
    const update = () => setElapsed(Math.floor((Date.now() - task.createdAt) / 1000));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [isProcessing, task.createdAt]);

  const isDone = statusKey === 'SUCCESS';
  const isFailed = statusKey === 'FAILED' || statusKey === 'FAIL';

  return (
    <div style={{
      padding: '1rem',
      background: 'rgba(0,0,0,0.15)',
      borderRadius: 'var(--radius-md)',
      marginBottom: '0.75rem',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
        <Film size={16} style={{ color: statusCfg.color }} />
        <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
          {MODE_LABELS[task.mode] || task.mode}
        </span>
        {task.model && (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>· {task.model}</span>
        )}
        {task.duration && (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>· {task.duration}s</span>
        )}
        {task.resolution && (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>· {task.resolution}</span>
        )}
      </div>

      {/* Prompt */}
      {task.prompt && (
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 0.5rem 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          "{task.prompt}"
        </p>
      )}

      {/* Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <span style={{ color: statusCfg.color, fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          {isProcessing && <RefreshCw size={14} className="spin" />}
          {statusCfg.label}
        </span>
        {isProcessing && (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            已等待 {elapsed > 60 ? `${Math.floor(elapsed / 60)}m${elapsed % 60}s` : `${elapsed}s`}
          </span>
        )}
        {isFailed && task.errorMessage && (
          <span style={{ fontSize: '0.75rem', color: '#ef4444' }}>
            {task.errorMessage}
          </span>
        )}
      </div>

      {/* Video Preview */}
      {isDone && task.videoUrl && (
        <video
          key={task.videoUrl}
          controls
          style={{ width: '100%', borderRadius: 'var(--radius-md)', marginBottom: '0.75rem', maxHeight: '300px', background: '#000' }}
          src={task.videoUrl}
        />
      )}

      {/* Primary Actions */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {isDone && task.videoUrl && (
          <a
            href={task.videoUrl}
            download
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
            style={{ fontSize: '0.8rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
          >
            <Download size={14} /> 下载
          </a>
        )}
        {isDone && onSendToSegment && task.videoUrl && (
          <button
            className="btn btn-secondary"
            style={{ fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
            onClick={() => onSendToSegment(task)}
          >
            <Send size={14} /> 发送到分镜
          </button>
        )}
        {isDone && onUseInStory && (
          <button className="btn btn-secondary" style={{ fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }} onClick={() => onUseInStory(task)}>
            <ArrowRight size={14} /> 使用到分镜
          </button>
        )}
        {isDone && onUseAsInput && task.videoUrl && (
          <button className="btn btn-secondary" style={{ fontSize: '0.8rem' }} onClick={() => setShowActions(!showActions)}>
            {showActions ? '▲ 收起' : '▼ 用作输入'}
          </button>
        )}
        {isFailed && onRetry && (
          <button className="btn btn-secondary" style={{ fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }} onClick={() => onRetry(task)}>
            <RefreshCw size={14} /> 重试
          </button>
        )}
        {onDelete && (
          <button className="btn btn-secondary" style={{ fontSize: '0.8rem', color: '#ef4444', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }} onClick={() => onDelete(task.taskId)}>
            <Trash2 size={14} /> 删除
          </button>
        )}
      </div>

      {/* "用作输入" 展开面板 */}
      {isDone && showActions && onUseAsInput && task.videoUrl && (
        <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'rgba(0,0,0,0.1)', borderRadius: 'var(--radius-md)', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', width: '100%' }}>将视频帧用作其他模式的输入图片：</span>
          <button className="btn btn-secondary" style={{ fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }} onClick={() => onUseAsInput(task.videoUrl!, 'i2v-first')}>
            <Image size={12} /> 图生视频起始帧
          </button>
          <button className="btn btn-secondary" style={{ fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }} onClick={() => onUseAsInput(task.videoUrl!, 'fl2v-first')}>
            <Layers size={12} /> 首尾帧-起始帧
          </button>
          <button className="btn btn-secondary" style={{ fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }} onClick={() => onUseAsInput(task.videoUrl!, 'fl2v-last')}>
            <Layers size={12} /> 首尾帧-结束帧
          </button>
          <button className="btn btn-secondary" style={{ fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }} onClick={() => onUseAsInput(task.videoUrl!, 's2v-subject')}>
            <User size={12} /> 主体参考图片
          </button>
        </div>
      )}
    </div>
  );
});

VideoTaskCard.displayName = 'VideoTaskCard';
