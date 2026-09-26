import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, Send, Trash2, RefreshCw, Film, Clock } from 'lucide-react';
import { useConfirm } from '../contexts/ConfirmContext';
import { useToast } from '../contexts/ToastContext';
import { AsyncState } from '../components/AsyncState';
import { publishService, finalCutRepo, storyRepo } from '../../dependencies';
import type { PublishTask, PublishStatus, PublishPlatform, FinalCut } from '../../domain/entities/models';

/**
 * P3-7 发布历史与排期：
 * 发布任务统一管理（历史/状态筛选/排期/立即发布/重试/删除），
 * 发布成功回执写回成片生命周期（设计文档 A-1）。
 */
export const PublishHistoryPage: React.FC = () => {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const toast = useToast();
  const [tasks, setTasks] = useState<PublishTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | PublishStatus>('all');
  const [storyTitles, setStoryTitles] = useState<Record<string, string>>({});
  const [cuts, setCuts] = useState<FinalCut[]>([]);
  const [scheduleFor, setScheduleFor] = useState<{ id: string; value: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, stories, cutList] = await Promise.all([
        publishService.listTasks(),
        storyRepo.findAll(),
        finalCutRepo.listAll ? finalCutRepo.listAll() : Promise.resolve<FinalCut[]>([]),
      ]);
      setTasks(list.sort((a, b) => b.createdAt - a.createdAt));
      const m: Record<string, string> = {};
      for (const s of stories) m[s.id] = s.title;
      setStoryTitles(m);
      setCuts(cutList);
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([
      publishService.listTasks(),
      storyRepo.findAll(),
      finalCutRepo.listAll ? finalCutRepo.listAll() : Promise.resolve<FinalCut[]>([]),
    ]).then(([list, stories, cutList]) => {
      if (!alive) return;
      setTasks(list.sort((a, b) => b.createdAt - a.createdAt));
      const m: Record<string, string> = {};
      for (const s of stories) m[s.id] = s.title;
      setStoryTitles(m);
      setCuts(cutList);
    }).catch(() => {}).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  // 到期提示：页面加载时检查已排期且到点的任务
  useEffect(() => {
    let alive = true;
    publishService.getDueTasks().then(due => {
      if (!alive) return;
      if (due.length > 0) {
        toast.showToast('info', t('publish.dueTasks', '有 {n} 个排期已到期，可点击立即发布').replace('{n}', String(due.length)));
      }
    }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cutOf = (finalCutId: string): FinalCut | undefined => cuts.find(x => x.id === finalCutId);
  const cutTitle = (task: PublishTask): string => {
    const c = cutOf(task.finalCutId);
    return c ? (storyTitles[c.storyId] || c.id) : task.finalCutId;
  };

  const handleSchedule = async (task: PublishTask, scheduledAt: number) => {
    try {
      await publishService.scheduleTask(task.id, scheduledAt);
      toast.showToast('success', t('publish.scheduled', '已排期：') + new Date(scheduledAt).toLocaleString());
      await load();
    } catch (e) {
      toast.showToast('error', e instanceof Error ? e.message : String(e));
    }
  };

  const handlePublishNow = async (task: PublishTask) => {
    const ok = await confirm.confirm({
      title: t('publish.publishNowTitle', '立即发布'),
      message: t('publish.publishNowConfirm', '将发布到 {platform}：{title}？').replace('{platform}', task.platform).replace('{title}', task.title),
      confirmLabel: t('publish.publishNow', '发布'), danger: false,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await publishService.publishNow(task.id);
      toast.showToast('success', t('publish.published', '已发布'));
      await load();
    } catch (e) {
      toast.showToast('error', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleRetry = async (task: PublishTask) => {
    setBusy(true);
    try {
      await publishService.advance(task.id, 'ready');
      toast.showToast('success', t('publish.retried', '已重试，等待推进'));
      await load();
    } catch (e) {
      toast.showToast('error', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (task: PublishTask) => {
    const ok = await confirm.confirm({
      title: t('publish.deleteTitle', '删除发布任务'),
      message: t('publish.deleteConfirm', '删除后不可恢复，确定删除该发布任务？'),
      confirmLabel: t('publish.deleteBtn', '删除'), danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await publishService.deleteTask(task.id);
      toast.showToast('success', t('publish.deleted', '发布任务已删除'));
      await load();
    } catch (e) {
      toast.showToast('error', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const filtered = statusFilter === 'all' ? tasks : tasks.filter(x => x.status === statusFilter);
  const count = (s: PublishStatus | 'all') => s === 'all' ? tasks.length : tasks.filter(x => x.status === s).length;
  const scheduledCount = tasks.filter(x => x.scheduledAt != null && x.status !== 'published' && x.status !== 'failed').length;

  const statusTabs: Array<{ key: 'all' | PublishStatus; label: string }> = [
    { key: 'all', label: t('publish.filterAll', '全部') },
    { key: 'draft', label: t('publish.statusDraft', '草稿') },
    { key: 'ready', label: t('publish.statusReady', '待发布') },
    { key: 'exported', label: t('publish.statusExported', '已导出') },
    { key: 'published', label: t('publish.statusPublished', '已发布') },
    { key: 'failed', label: t('publish.statusFailed', '失败') },
  ];

  const statusColor = (s: PublishStatus): string => {
    if (s === 'published') return 'var(--color-success)';
    if (s === 'failed') return 'var(--color-danger)';
    if (s === 'ready') return 'var(--color-warning)';
    return 'var(--text-secondary)';
  };

  const platformLabel = (p: PublishPlatform): string => {
    if (p === 'douyin') return t('publish.platformDouyin', '抖音');
    if (p === 'bilibili') return t('publish.platformBilibili', 'B站');
    return t('publish.platformGeneric', '通用');
  };

  const lifecycleOf = (task: PublishTask): string | null => {
    const c = cutOf(task.finalCutId);
    return c?.lifecycle ?? null;
  };

  return (
    <div className="page-container fade-in">
      <div className="page-header">
        <h1 className="page-title">{t('publish.title', '发布管理')}</h1>
        <p className="page-subtitle">{t('publish.subtitle', '发布历史与排期，成片状态自动回执')}</p>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        {[
          { key: 'all', label: t('publish.total', '总数'), value: count('all') },
          { key: 'published', label: t('publish.statusPublished', '已发布'), value: count('published') },
          { key: 'scheduled', label: t('publish.scheduledCount', '排期中'), value: scheduledCount },
          { key: 'failed', label: t('publish.statusFailed', '失败'), value: count('failed') },
        ].map(s => (
          <div key={s.key} style={{ flex: '1 1 120px', padding: '0.6rem 0.75rem', background: '#FFFFFF', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, boxSizing: 'border-box' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{s.label}</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 600, marginTop: 2 }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="tabs" role="tablist" style={{ marginBottom: '0.5rem' }}>
        {statusTabs.map(sb => (
          <button key={sb.key} role="tab" aria-selected={statusFilter === sb.key}
            className={`tab${statusFilter === sb.key ? ' tab-active' : ''}`}
            onClick={() => setStatusFilter(sb.key)}>
            {sb.label} ({count(sb.key)})
          </button>
        ))}
      </div>

      {loading ? <AsyncState loading minHeight={160} /> : (
        filtered.length === 0 ? (
          <AsyncState empty emptyText={t('publish.empty', '暂无发布任务，可在导出中心对成片发起发布')} minHeight={160} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {filtered.map(task => (
              <div key={task.id} className="card" style={{ padding: '0.6rem 0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <Film size={14} style={{ color: 'var(--text-secondary)' }} />
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                      {cutTitle(task)} · {platformLabel(task.platform)}
                      {lifecycleOf(task) && <span> · {t('publish.cutLifecycle', '成片')}: {lifecycleOf(task)}</span>}
                    </div>
                  </div>
                  <span style={{ fontSize: '0.68rem', padding: '0.12rem 0.5rem', borderRadius: 999, background: statusColor(task.status), color: '#fff', fontWeight: 600 }}>
                    {statusTabs.find(x => x.key === task.status)?.label ?? task.status}
                  </span>
                  {task.scheduledAt && task.status !== 'published' && task.status !== 'failed' && (
                    <span style={{ fontSize: '0.68rem', color: 'var(--color-warning)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <Clock size={11} /> {new Date(task.scheduledAt).toLocaleString()}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  {scheduleFor && scheduleFor.id === task.id ? (
                    <>
                      <input type="datetime-local" className="form-input" style={{ fontSize: '0.72rem', padding: '0.2rem 0.4rem' }}
                        value={scheduleFor.value} onChange={e => setScheduleFor({ id: task.id, value: e.target.value })} />
                      <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => {
                        const ms = new Date(scheduleFor.value).getTime();
                        if (!Number.isFinite(ms)) { toast.showToast('error', t('publish.scheduleInvalid', '请选择有效时间')); return; }
                        void handleSchedule(task, ms);
                        setScheduleFor(null);
                      }}>{t('publish.confirmSchedule', '确认排期')}</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setScheduleFor(null)}>{t('publish.cancel', '取消')}</button>
                    </>
                  ) : (
                    task.status !== 'published' && task.status !== 'failed' && (
                      <button className="btn btn-ghost btn-sm" onClick={() => setScheduleFor({ id: task.id, value: '' })}>
                        <CalendarClock size={12} /> {t('publish.schedule', '排期')}
                      </button>
                    )
                  )}
                  {task.status === 'draft' && (
                    <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void publishService.advance(task.id, 'ready').then(async () => { toast.showToast('success', t('publish.toReady', '已进入待发布')); await load(); }).catch(e => toast.showToast('error', e instanceof Error ? e.message : String(e)))}>
                      {t('publish.toReady', '待发布')}
                    </button>
                  )}
                  {task.status === 'ready' && (
                    <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void publishService.advance(task.id, 'exported').then(async () => { toast.showToast('success', t('publish.toExported', '已标记导出')); await load(); }).catch(e => toast.showToast('error', e instanceof Error ? e.message : String(e)))}>
                      {t('publish.toExported', '标记导出')}
                    </button>
                  )}
                  {task.status === 'exported' && (
                    <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void handlePublishNow(task)}>
                      <Send size={12} /> {t('publish.publishNow', '立即发布')}
                    </button>
                  )}
                  {task.status === 'failed' && (
                    <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void handleRetry(task)}>
                      <RefreshCw size={12} /> {t('publish.retry', '重试')}
                    </button>
                  )}
                  <button className="btn btn-ghost btn-sm" style={{ color: 'var(--color-danger)', marginLeft: 'auto' }} disabled={busy} onClick={() => void handleDelete(task)}>
                    <Trash2 size={12} /> {t('publish.deleteBtn', '删除')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
};

export default PublishHistoryPage;
