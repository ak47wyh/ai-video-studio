import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ListChecks, Plus, RotateCcw, X, Play } from 'lucide-react';
import { pipelineService, storyRepo } from '../../dependencies';
import type { PipelineTask } from '../../domain/entities/models';
import type { Story } from '../../domain/entities/models';
import { useToast } from '../contexts/ToastContext';
import { getErrorMessage } from '../utils/errorUtils';

/** P3-1 任务队列看板：运行中/排队/已完成/失败/已取消分区 + 优先级调整 + 批量提交 */

const STAGE_LABEL_KEYS = [
  'splitting', 'generating_images', 'generating_audio', 'generating_bgm',
  'generating_videos', 'post_processing', 'generating_srt', 'burning_subtitles',
] as const;

const STATUS_COLOR: Record<string, string> = {
  complete: 'var(--color-success)',
  failed: 'var(--color-danger)',
  cancelled: 'var(--text-muted)',
  idle: 'var(--color-warning)',
};

export const TaskQueuePage: React.FC = () => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [tasks, setTasks] = useState<PipelineTask[]>([]);
  const [stories, setStories] = useState<Record<string, Story>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchPriority, setBatchPriority] = useState(5);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let mounted = true;
    const refresh = (list: PipelineTask[]) => {
      if (!mounted) return;
      // 唯一化：同一任务最新状态覆盖旧项
      const map = new Map<string, PipelineTask>();
      list.forEach(t => map.set(t.id, t));
      setTasks(Array.from(map.values()));
    };
    refresh(pipelineService.listTasks());
    const unsubAll = pipelineService.subscribeAll(t => {
      refresh([t, ...pipelineService.listTasks()]);
    });
    (async () => {
      try {
        const list = await storyRepo.findAll();
        if (mounted) {
          const map: Record<string, Story> = {};
          list.forEach(s => { map[s.id] = s; });
          setStories(map);
        }
      } catch { /* 标题映射失败不阻断看板 */ }
    })();
    return () => {
      mounted = false;
      unsubAll();
    };
  }, []);

  const storyTitle = useCallback((storyId: string): string => {
    const s = stories[storyId];
    return s?.title || storyId.slice(0, 8);
  }, [stories]);

  const sorted = useMemo(() => {
    const active = tasks.filter(t => t.status !== 'complete' && t.status !== 'failed' && t.status !== 'cancelled');
    const done = tasks.filter(t => t.status === 'complete' || t.status === 'failed' || t.status === 'cancelled');
    const byPriority = [...active].sort((a, b) => (b.priority ?? 5) - (a.priority ?? 5) || a.createdAt - b.createdAt);
    return { active: byPriority, done: done.sort((a, b) => b.createdAt - a.createdAt) };
  }, [tasks]);

  const stats = useMemo(() => ({
    running: tasks.filter(t => t.status !== 'idle' && t.status !== 'complete' && t.status !== 'failed' && t.status !== 'cancelled').length,
    queued: tasks.filter(t => t.status === 'idle').length,
    done: tasks.filter(t => t.status === 'complete' || t.status === 'failed' || t.status === 'cancelled').length,
  }), [tasks]);

  const handleCancel = (id: string) => {
    pipelineService.cancelTask(id);
    showToast('info', t('queue.taskCancelled', '任务取消中'));
  };

  const handleRetry = async (task: PipelineTask) => {
    try {
      await pipelineService.resumePipeline(task.id);
      showToast('success', t('queue.taskRetried', '已重新入队'));
    } catch (e) {
      showToast('error', getErrorMessage(e, t('queue.retryFailed', '重试失败')));
    }
  };

  const handleBatchSubmit = async () => {
    if (selectedIds.length === 0) return;
    setSubmitting(true);
    try {
      for (const storyId of selectedIds) {
        await pipelineService.runFullPipeline(storyId, { priority: batchPriority });
      }
      showToast('success', t('queue.batchSubmitted', { count: selectedIds.length }));
      setPickerOpen(false);
      setSelectedIds([]);
    } catch (e) {
      showToast('error', getErrorMessage(e, t('queue.batchFailed', '批量提交失败')));
    } finally {
      setSubmitting(false);
    }
  };

  const availableStories = useMemo(
    () => Object.values(stories).sort((a, b) => b.createdAt - a.createdAt),
    [stories],
  );

  const renderRow = (task: PipelineTask) => {
    const isTerminal = task.status === 'complete' || task.status === 'failed' || task.status === 'cancelled';
    const stageKey = STAGE_LABEL_KEYS.find(k => task.status === k);
    return (
      <div
        key={task.id}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.8rem', padding: '0.55rem 0.8rem',
          background: '#FFFFFF', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '10px',
          marginBottom: '0.4rem', flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{storyTitle(task.storyId)}</span>
            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>#{task.id.slice(0, 6)}</span>
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
            {new Date(task.createdAt).toLocaleString()}
          </div>
        </div>

        <div style={{ flex: '1 1 220px', minWidth: 160 }}>
          <div style={{ fontSize: '0.72rem', marginBottom: '0.2rem', color: 'var(--text-secondary)' }}>
            {stageKey ? t(`queue.stage.${stageKey}`, task.status) : t(`queue.status.${task.status}`, task.status)}
            <span style={{ float: 'right' }}>{task.progress}%</span>
          </div>
          <div style={{ height: 5, background: 'rgba(0,0,0,0.06)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${task.progress}%`, background: 'var(--color-success, #52C41A)', borderRadius: 3 }} />
          </div>
        </div>

        <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.72rem', color: STATUS_COLOR[task.status] ?? 'var(--text-muted)' }}>
            {t(`queue.status.${task.status}`, task.status)}
          </span>
          {!isTerminal && (
            <>
              <select
                className="form-select"
                style={{ width: 64, fontSize: '0.75rem', padding: '0.2rem 0.3rem' }}
                value={task.priority ?? 5}
                disabled={task.status !== 'idle'}
                onChange={e => pipelineService.updatePriority(task.id, Number(e.target.value))}
                title={t('queue.priority', '优先级（越大越先执行）')}
              >
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <button className="btn btn-secondary btn-xs" onClick={() => handleCancel(task.id)} title={t('queue.cancel', '取消')}>
                <X size={13} />
              </button>
            </>
          )}
          {task.status === 'failed' && (
            <button className="btn btn-primary btn-xs" onClick={() => handleRetry(task)} title={t('queue.retry', '重试')}>
              <RotateCcw size={13} /> {t('queue.retry', '重试')}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ padding: '1rem', maxWidth: '1080px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.8rem', flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: '1.05rem', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <ListChecks size={17} /> {t('queue.title', '任务队列')}
        </h2>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          {t('queue.running', '运行中')} {stats.running} · {t('queue.queued', '排队')} {stats.queued} · {t('queue.done', '已结束')} {stats.done}
        </span>
        <span style={{ marginLeft: 'auto' }}>
          <button className="btn btn-primary btn-sm" onClick={() => setPickerOpen(true)}>
            <Plus size={14} /> {t('queue.batchAdd', '批量生成')}
          </button>
        </span>
      </div>

      <div style={{ marginBottom: '1rem' }}>
        {sorted.active.length === 0 ? (
          <div style={{ padding: '1.2rem 0', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
            {t('queue.emptyActive', '暂无进行中的任务')}
          </div>
        ) : sorted.active.map(renderRow)}
      </div>

      {sorted.done.length > 0 && (
        <div style={{ marginTop: '1.2rem' }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
            {t('queue.recentDone', '最近完成 / 失败 / 取消')}
          </div>
          {sorted.done.slice(0, 20).map(renderRow)}
        </div>
      )}

      {pickerOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#FFF', borderRadius: 14, padding: '1rem 1.2rem', width: 'min(520px, 92vw)', maxHeight: '80vh', overflow: 'auto', boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.7rem' }}>
              <div style={{ fontWeight: 600, fontSize: '0.92rem' }}>{t('queue.batchTitle', '选择故事批量生成')}</div>
              <button className="btn btn-secondary btn-xs" style={{ marginLeft: 'auto' }} onClick={() => setPickerOpen(false)}>
                <X size={13} />
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem' }}>
              <span style={{ fontSize: '0.78rem' }}>{t('queue.batchPriority', '提交优先级')}</span>
              <select className="form-select" style={{ width: 72, fontSize: '0.78rem' }} value={batchPriority} onChange={e => setBatchPriority(Number(e.target.value))}>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{t('queue.batchHint', '队列按优先级串行执行，同优先级先到先做')}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', maxHeight: '45vh', overflow: 'auto' }}>
              {availableStories.length === 0 && (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('queue.noStories', '暂无故事，请先在创作工作台创建')}</div>
              )}
              {availableStories.map(s => (
                <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', cursor: 'pointer', padding: '0.35rem 0.4rem', background: 'rgba(0,0,0,0.03)', borderRadius: 8 }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(s.id)}
                    onChange={e => {
                      const checked = e.target.checked;
                      setSelectedIds(prev => checked ? [...prev, s.id] : prev.filter(id => id !== s.id));
                    }}
                  />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{s.id.slice(0, 6)}</span>
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.8rem', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setPickerOpen(false)}>{t('queue.close', '关闭')}</button>
              <button className="btn btn-primary btn-sm" disabled={selectedIds.length === 0 || submitting} onClick={handleBatchSubmit}>
                <Play size={13} /> {submitting ? t('queue.submitting', '提交中…') : t('queue.submitN', { count: selectedIds.length })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
