import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderKanban, Plus, Trash2, Save, Link2, Unlink, Layers } from 'lucide-react';
import { useSpace } from '../contexts/SpaceContext';
import { useToast } from '../contexts/ToastContext';
import { AsyncState } from '../components/AsyncState';
import { projectService } from '../../dependencies';
import type { Project, ProjectStyleSettings, Story, VideoStyle, VideoResolution } from '../../domain/entities/models';

const STYLES: VideoStyle[] = ['cinematic', 'anime', 'watercolor', 'gufeng', '3dcartoon', 'scifi', 'documentary', 'fairy_tale'];
const RESOLUTIONS: VideoResolution[] = ['512P', '720P', '768P', '1080P'];

/**
 * P1-5 项目/系列：系列剧本集 + 统一风格设定 + 故事关联。
 * 系列设置由子故事继承（回改/生成时可作为默认配置）。
 */
export const ProjectPage: React.FC = () => {
  const { t } = useTranslation();
  const { currentSpaceId } = useSpace();
  const toast = useToast();

  const [projects, setProjects] = useState<Project[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Project | null>(null);

  // 新建表单
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  // 编辑表单（选中项目）
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editStyle, setEditStyle] = useState<ProjectStyleSettings>({});

  const refresh = useCallback(async () => {
    const spaceId = currentSpaceId || '';
    const [p, s] = await Promise.all([
      projectService.listProjects(spaceId),
      projectService.listStoriesBySpace(spaceId),
    ]);
    setProjects(p);
    setStories(s);
    setLoading(false);
  }, [currentSpaceId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const spaceId = currentSpaceId || '';
      const [p, s] = await Promise.all([
        projectService.listProjects(spaceId),
        projectService.listStoriesBySpace(spaceId),
      ]);
      if (!alive) return;
      setProjects(p);
      setStories(s);
      setLoading(false);
    })().catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [currentSpaceId]);

  const selectProject = (p: Project) => {
    setSelected(p);
    setEditName(p.name);
    setEditDesc(p.description ?? '');
    setEditStyle(p.styleSettings ?? {});
  };

  const createProject = async () => {
    if (!newName.trim() || !currentSpaceId) return;
    await projectService.createProject({ spaceId: currentSpaceId, name: newName.trim(), description: newDesc.trim() || undefined });
    toast.showToast('success', t('project.createSuccess', '项目已创建'));
    setNewName('');
    setNewDesc('');
    setCreating(false);
    await refresh();
  };

  const saveProject = async () => {
    if (!selected) return;
    await projectService.updateProject(selected.id, {
      name: editName.trim() || selected.name,
      description: editDesc.trim() || undefined,
      styleSettings: editStyle,
    });
    toast.showToast('success', t('project.saveSuccess', '已保存'));
    await refresh();
    const updated = (await projectService.listProjects(currentSpaceId || '')).find(p => p.id === selected.id) ?? null;
    if (updated) selectProject(updated);
  };

  const deleteProject = async () => {
    if (!selected) return;
    await projectService.deleteProject(selected.id);
    toast.showToast('success', t('project.deleteSuccess', '项目已删除'));
    setSelected(null);
    await refresh();
  };

  const linkStory = async (storyId: string) => {
    if (!selected) return;
    await projectService.linkStory(selected.id, storyId);
    await refresh();
  };

  const unlinkStory = async (storyId: string) => {
    if (!selected) return;
    await projectService.unlinkStory(selected.id, storyId);
    await refresh();
  };

  const linkedStories = stories.filter(s => s.projectId === selected?.id);
  const availableStories = stories.filter(s => !s.projectId);

  return (
    <div className="page-container fade-in">
      <div className="page-header">
        <h1 className="page-title">{t('project.title', '项目/系列')}</h1>
        <p className="page-subtitle">{t('project.subtitle', '系列剧本集与统一风格设定')}</p>
        <button className="btn btn-primary" onClick={() => setCreating(v => !v)}>
          <Plus size={14} /> {t('project.createBtn', '新建项目')}
        </button>
      </div>

      {creating && (
        <div className="card" style={{ marginBottom: '0.75rem', padding: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input className="input" style={{ flex: '1 1 200px' }} placeholder={t('project.namePlaceholder', '系列名称')} value={newName} onChange={e => setNewName(e.target.value)} />
          <input className="input" style={{ flex: '1 1 240px' }} placeholder={t('project.descPlaceholder', '描述（可选）')} value={newDesc} onChange={e => setNewDesc(e.target.value)} />
          <button className="btn btn-primary" onClick={createProject} disabled={!newName.trim()}>{t('project.createBtn', '新建项目')}</button>
        </div>
      )}

      {loading ? (
        <AsyncState loading minHeight={160} />
      ) : projects.length === 0 ? (
        <AsyncState empty emptyText={t('project.empty', '暂无项目，创建系列以承载多集创作')} minHeight={160} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 230px), 1fr))', gap: '0.75rem' }}>
          {projects.map(p => {
            const count = stories.filter(s => s.projectId === p.id).length;
            const active = selected?.id === p.id;
            return (
              <div
                key={p.id}
                className="card"
                style={{ padding: '0.75rem', cursor: 'pointer', border: active ? '2px solid var(--primary-color)' : undefined }}
                onClick={() => selectProject(p)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  <FolderKanban size={16} style={{ color: 'var(--primary-color)' }} /> {p.name}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.3rem', minHeight: '2em' }}>
                  {p.description || '—'}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.3rem', display: 'flex', gap: '0.6rem' }}>
                  <span><Layers size={11} style={{ verticalAlign: '-1px' }} /> {count} {t('project.storiesCount', '故事')}</span>
                  {p.styleSettings?.videoStyle && <span>· {p.styleSettings.videoStyle}</span>}
                  {p.styleSettings?.videoResolution && <span>· {p.styleSettings.videoResolution}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <h3 style={{ margin: 0 }}>{t('project.settingsTitle', '系列设置')}：{selected.name}</h3>
            <button className="btn btn-ghost" style={{ color: 'var(--color-danger)' }} onClick={deleteProject}>
              <Trash2 size={14} /> {t('project.deleteBtn', '删除项目')}
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              {t('project.nameLabel', '名称')}
              <input className="input" value={editName} onChange={e => setEditName(e.target.value)} />
            </label>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              {t('project.descLabel', '描述')}
              <input className="input" value={editDesc} onChange={e => setEditDesc(e.target.value)} />
            </label>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              {t('project.videoStyle', '统一画面风格')}
              <select className="input" value={editStyle.videoStyle ?? ''} onChange={e => setEditStyle(s => ({ ...s, videoStyle: e.target.value ? e.target.value as VideoStyle : undefined }))}>
                <option value="">—</option>
                {STYLES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              {t('project.videoResolution', '统一分辨率')}
              <select className="input" value={editStyle.videoResolution ?? ''} onChange={e => setEditStyle(s => ({ ...s, videoResolution: e.target.value ? e.target.value as VideoResolution : undefined }))}>
                <option value="">—</option>
                {RESOLUTIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              {t('project.narrationVoice', '音色偏好')}
              <input className="input" value={editStyle.narrationVoice ?? ''} placeholder={t('project.narrationVoicePlaceholder', '如：温柔女声')} onChange={e => setEditStyle(s => ({ ...s, narrationVoice: e.target.value || undefined }))} />
            </label>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              {t('project.bgmPreference', 'BGM 偏好')}
              <input className="input" value={editStyle.bgmPreference ?? ''} placeholder={t('project.bgmPreferencePlaceholder', '如：史诗管弦')} onChange={e => setEditStyle(s => ({ ...s, bgmPreference: e.target.value || undefined }))} />
            </label>
          </div>
          <button className="btn btn-primary" style={{ marginTop: '0.6rem' }} onClick={saveProject}>
            <Save size={14} /> {t('project.saveBtn', '保存设置')}
          </button>

          <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 260px', minWidth: 0 }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.35rem' }}>{t('project.linkedStories', '已关联故事')}</div>
              {linkedStories.length === 0 && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{t('project.noLinkedStories', '暂无关联故事')}</div>}
              {linkedStories.map(s => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0', borderBottom: '1px solid var(--color-border)', fontSize: '0.8rem' }}>
                  <span style={{ flex: 1, color: 'var(--text-primary)' }}>{s.title}</span>
                  <button className="btn btn-ghost btn-xs" onClick={() => unlinkStory(s.id)}><Unlink size={12} /> {t('project.unlink', '解除')}</button>
                </div>
              ))}
            </div>
            <div style={{ flex: '1 1 260px', minWidth: 0 }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.35rem' }}>{t('project.availableStories', '可关联故事')}</div>
              {availableStories.length === 0 && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{t('project.noAvailableStories', '无可关联故事')}</div>}
              {availableStories.map(s => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0', borderBottom: '1px solid var(--color-border)', fontSize: '0.8rem' }}>
                  <span style={{ flex: 1, color: 'var(--text-primary)' }}>{s.title}</span>
                  <button className="btn btn-ghost btn-xs" onClick={() => linkStory(s.id)}><Link2 size={12} /> {t('project.link', '关联')}</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div style={{ marginTop: '0.75rem', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
        {t('project.hint', '系列设置（风格/分辨率/音色/BGM）供子故事生成时继承；删除项目仅解除关联，不删除故事。')}
      </div>
    </div>
  );
};
