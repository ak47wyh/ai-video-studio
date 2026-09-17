import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, X, Trash2, RotateCcw } from 'lucide-react';
import { publishService } from '../../dependencies';
import type { FinalCut, PublishTask, PublishPlatform } from '../../domain/entities/models';
import { complianceService } from '../../dependencies';
import type { PreflightResult } from '../../domain/ports/CompliancePorts';

const PLATFORMS: Array<{ id: PublishPlatform; labelKey: string }> = [
  { id: 'douyin', labelKey: 'publish.platformDouyin' },
  { id: 'bilibili', labelKey: 'publish.platformBilibili' },
  { id: 'generic', labelKey: 'publish.platformGeneric' },
];

/**
 * P0-1 发布面板：为单个成片创建发布任务并推进状态。
 * 半自动发布——真实平台 API 需授权，状态由用户操作推进。
 */
export const PublishPanel: React.FC<{ finalCut: FinalCut; storyTitle: string; onClose: () => void }> = ({ finalCut, storyTitle, onClose }) => {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<PublishTask[]>([]);
  const [platform, setPlatform] = useState<PublishPlatform>('douyin');
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const list = await publishService.listTasks({ finalCutId: finalCut.id });
    setTasks(list);
  }, [finalCut.id]);

  useEffect(() => {
    let alive = true;
    publishService.listTasks({ finalCutId: finalCut.id })
      .then(list => { if (alive) setTasks(list); })
      .catch(() => {});
    return () => { alive = false; };
  }, [finalCut.id]);

  // P2-9 发布预检：平台/标题/标签变化时同步重算（useMemo 渲染期计算）
  const preflight: PreflightResult = useMemo(() => {
    return complianceService.preflight({
      durationSec: finalCut.duration,
      resolution: finalCut.pipelineOptions?.videoResolution,
      hasSubtitles: finalCut.hasSubtitles,
      text: [title, tags].join(' '),
      sensitiveWords: [], // 敏感词表可配置（默认空）
      aiMetadataWritten: false,
    }, platform);
  }, [platform, title, tags, finalCut]);

  // AI 生成内容声明（写入导出元数据）
  const aiMeta = useMemo(() => {
    return complianceService.serializeAiMetadata(complianceService.buildAiMetadata(finalCut.version));
  }, [finalCut]);

  const createTask = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await publishService.createTask({
        finalCutId: finalCut.id,
        storyId: finalCut.storyId,
        platform,
        title: title.trim(),
        tags: tags.split(/[,，]/).map(s => s.trim()).filter(Boolean),
        presetKey: platform === 'generic' ? undefined : platform,
      });
      setTitle('');
      setTags('');
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const advance = async (task: PublishTask, target: PublishTask['status'], error?: string) => {
    setBusy(true);
    try {
      await publishService.advance(task.id, target, error);
      await refresh();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const removeTask = async (id: string) => {
    setBusy(true);
    try {
      await publishService.deleteTask(id);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const statusLabel = (s: PublishTask['status']): string => t(`publish.status_${s}`);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }} onClick={onClose}>
      <div className="card" style={{ width: 'min(100%, 560px)', maxHeight: '80vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Send size={16} /> {t('publish.title')}
          </h3>
          <button className="btn btn-ghost" onClick={onClose} aria-label={t('publish.close', '关闭')}><X size={16} /></button>
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
          {t('publish.forCut', '成片')}: {storyTitle} · {finalCut.duration}s
        </div>

        {/* 新建任务 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '0.6rem', background: 'rgba(0,0,0,0.03)', borderRadius: 10, marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <select className="input" value={platform} onChange={e => setPlatform(e.target.value as PublishPlatform)} style={{ width: 130 }}>
              {PLATFORMS.map(p => <option key={p.id} value={p.id}>{t(p.labelKey)}</option>)}
            </select>
            <input className="input" placeholder={t('publish.titlePlaceholder', '发布标题')} value={title} onChange={e => setTitle(e.target.value)} style={{ flex: 1 }} />
          </div>
          <input className="input" placeholder={t('publish.tagsPlaceholder', '话题标签（逗号分隔）')} value={tags} onChange={e => setTags(e.target.value)} />
          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', padding: '0.35rem 0.4rem', background: 'rgba(0,0,0,0.03)', borderRadius: 8 }}>
            <div style={{ marginBottom: '0.25rem' }}>
              <span style={{ color: 'var(--color-info)' }}>{t('publish.aiDeclaration')}</span>：{aiMeta}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', marginTop: '0.3rem' }}>
              {preflight.rules.map(r => (
                <div key={r.id} style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                  <span style={{ color: r.passed ? 'var(--color-success)' : r.severity === 'error' ? 'var(--color-danger)' : 'var(--color-warning)', fontWeight: 600 }}>
                    {r.passed ? '✓' : '✗'}
                  </span>
                  <span style={{ fontSize: '0.72rem', color: r.passed ? 'var(--text-secondary)' : 'var(--text-primary)' }}>{r.message}</span>
                </div>
              ))}
            </div>
          </div>
          <button className="btn btn-primary" onClick={createTask} disabled={busy || !title.trim() || !preflight.passed}>
            <Send size={14} /> {preflight.passed ? t('publish.createBtn', '创建发布任务') : t('publish.preflightBlocked', '预检未通过')}
          </button>
        </div>

        {/* 任务列表 */}
        {tasks.length === 0 ? (
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', padding: '0.75rem 0', textAlign: 'center' }}>
            {t('publish.noTasks', '该成片暂无发布任务')}
          </div>
        ) : (
          tasks.map(task => (
            <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0', borderBottom: '1px solid var(--color-border)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{task.title}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                  {t(`publish.platform_${task.platform}`)} · {statusLabel(task.status)}
                  {task.error && <span style={{ color: 'var(--color-danger)' }}> · {task.error}</span>}
                  {task.tags.length > 0 && <span> · #{task.tags.join(' #')}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {task.status === 'draft' && <button className="btn btn-secondary btn-xs" onClick={() => advance(task, 'ready')}>{t('publish.markReady', '就绪')}</button>}
                {task.status === 'ready' && <button className="btn btn-secondary btn-xs" onClick={() => advance(task, 'exported')}>{t('publish.markExported', '已导出')}</button>}
                {task.status === 'ready' && <button className="btn btn-secondary btn-xs" onClick={() => advance(task, 'failed', t('publish.manualFail', '手动标记失败'))}>{t('publish.markFailed', '失败')}</button>}
                {task.status === 'exported' && <button className="btn btn-primary btn-xs" onClick={() => advance(task, 'published')}>{t('publish.markPublished', '已发布')}</button>}
                {task.status === 'exported' && <button className="btn btn-secondary btn-xs" onClick={() => advance(task, 'failed', t('publish.manualFail', '手动标记失败'))}>{t('publish.markFailed', '失败')}</button>}
                {task.status === 'failed' && <button className="btn btn-secondary btn-xs" onClick={() => advance(task, 'ready')}><RotateCcw size={12} /> {t('publish.retry', '重试')}</button>}
                {task.status !== 'published' && (
                  <button className="btn btn-ghost btn-xs" style={{ color: 'var(--color-danger)' }} onClick={() => removeTask(task.id)}><Trash2 size={12} /></button>
                )}
              </div>
            </div>
          ))
        )}

        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
          {t('publish.hint', '发布为半自动流程：导出文件后在目标平台发布，并在系统中推进状态以保留发布记录。')}
        </div>
      </div>
    </div>
  );
};
