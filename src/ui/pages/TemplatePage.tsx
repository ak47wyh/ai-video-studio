import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutTemplate, Plus, Trash2, Copy, Check, RefreshCw, Sparkles } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import { AsyncState } from '../components/AsyncState';
import { templateService } from '../../dependencies';
import type { ContentTemplate, TemplateKind, VideoStyle } from '../../domain/entities/models';

const KINDS: Array<{ id: TemplateKind; label: string }> = [
  { id: 'story_structure', label: '分镜结构' },
  { id: 'style', label: '风格组合' },
  { id: 'prompt', label: '提示词' },
  { id: 'export', label: '导出模板' },
];
const STYLES: VideoStyle[] = ['cinematic', 'anime', 'watercolor', 'gufeng', '3dcartoon', 'scifi', 'documentary', 'fairy_tale'];

/**
 * P1-6 创作模板库：分镜/风格/提示词/导出 四类模板 CRUD + 内置种子。
 */
export const TemplatePage: React.FC = () => {
  const { t } = useTranslation();
  const toast = useToast();

  const [kind, setKind] = useState<TemplateKind>('story_structure');
  const [templates, setTemplates] = useState<ContentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ContentTemplate | null>(null);
  const [copied, setCopied] = useState(false);

  // 新建表单
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [beatsText, setBeatsText] = useState('');
  const [styleVideo, setStyleVideo] = useState('');
  const [styleBgm, setStyleBgm] = useState('');
  const [styleCamera, setStyleCamera] = useState('');
  const [promptTemplate, setPromptTemplate] = useState('');
  const [promptVars, setPromptVars] = useState('');
  const [expPreset, setExpPreset] = useState<'generic' | 'douyin' | 'bilibili'>('generic');
  const [expRes, setExpRes] = useState('1080P');
  const [expSubs, setExpSubs] = useState(true);

  const refresh = async (k: TemplateKind = kind) => {
    const list = await templateService.listTemplates(k);
    setTemplates(list);
    setLoading(false);
    setSelected(null);
  };

  useEffect(() => {
    let alive = true;
    templateService.listTemplates(kind)
      .then(list => { if (alive) { setTemplates(list); setLoading(false); setSelected(null); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [kind]);

  const ensureBuiltins = async () => {
    const created = await templateService.ensureBuiltinTemplates();
    toast.showToast('success', t('template.builtinRestored', '内置模板已恢复') + (created.length ? ` (+${created.length})` : ''));
    await refresh();
  };

  const createTemplate = async () => {
    if (!newName.trim()) return;
    let content: Record<string, unknown>;
    if (kind === 'story_structure') {
      const beats = beatsText.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
        const [name, ...rest] = l.split('|');
        return { name: name.trim(), description: rest.join('|').trim() };
      });
      if (beats.length === 0) { toast.showToast('error', t('template.beatsRequired', '请至少填写一个节拍（每行：名称|描述）')); return; }
      content = { beats };
    } else if (kind === 'style') {
      content = {
        videoStyle: styleVideo || undefined,
        bgmPreference: styleBgm || undefined,
        cameraMotion: styleCamera || undefined,
      };
    } else if (kind === 'prompt') {
      if (!promptTemplate.trim()) { toast.showToast('error', t('template.promptRequired', '请填写提示词模板')); return; }
      content = {
        template: promptTemplate.trim(),
        variables: promptVars.split(/[,，]/).map(s => s.trim()).filter(Boolean),
      };
    } else {
      content = {
        presetKey: expPreset,
        videoResolution: expRes,
        includeSubtitles: expSubs,
      };
    }
    await templateService.createTemplate({ kind, name: newName.trim(), description: newDesc.trim() || undefined, content });
    toast.showToast('success', t('template.createSuccess', '模板已创建'));
    setNewName('');
    setNewDesc('');
    setBeatsText('');
    setPromptTemplate('');
    setCreating(false);
    await refresh();
  };

  const deleteTemplate = async (tpl: ContentTemplate) => {
    try {
      await templateService.deleteTemplate(tpl.id);
      toast.showToast('success', t('template.deleteSuccess', '模板已删除'));
      await refresh();
    } catch (e) {
      toast.showToast('error', e instanceof Error ? e.message : String(e));
    }
  };

  const copyResolved = async (tpl: ContentTemplate) => {
    let text: string;
    try {
      const r = templateService.resolve(tpl);
      if (tpl.kind === 'story_structure') {
        text = (r.beats as Array<{ name: string; description: string }>).map(b => `${b.name}：${b.description}`).join('\n');
      } else {
        text = JSON.stringify(r, null, 2);
      }
    } catch (e) {
      text = e instanceof Error ? e.message : String(e);
    }
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const renderContentSummary = (tpl: ContentTemplate): string => {
    try {
      const r = templateService.resolve(tpl);
      if (tpl.kind === 'story_structure') return `[${(r.beats as Array<{ name: string }>).map(b => b.name).join(' → ')}]`;
      if (tpl.kind === 'prompt') return String(r.template).slice(0, 40);
      return Object.entries(r).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${String(v)}`).join(' · ');
    } catch {
      return '—';
    }
  };

  const resetNewForm = () => {
    setNewName(''); setNewDesc(''); setBeatsText(''); setStyleVideo(''); setStyleBgm(''); setStyleCamera('');
    setPromptTemplate(''); setPromptVars(''); setExpPreset('generic'); setExpRes('1080P'); setExpSubs(true);
  };

  return (
    <div className="page-container fade-in">
      <div className="page-header">
        <h1 className="page-title">{t('template.title', '创作模板')}</h1>
        <p className="page-subtitle">{t('template.subtitle', '分镜/风格/提示词/导出模板库，批量创作效率杠杆')}</p>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-secondary" onClick={ensureBuiltins}><RefreshCw size={14} /> {t('template.restoreBuiltins', '恢复内置')}</button>
          <button className="btn btn-primary" onClick={() => { setCreating(v => !v); if (!creating) resetNewForm(); }}>
            <Plus size={14} /> {t('template.createBtn', '新建模板')}
          </button>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {KINDS.map(k => (
          <button key={k.id} role="tab" aria-selected={kind === k.id} className={`tab${kind === k.id ? ' tab-active' : ''}`} onClick={() => setKind(k.id)}>
            {k.label}
          </button>
        ))}
      </div>

      {creating && (
        <div className="card" style={{ margin: '0.75rem 0', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <input className="input" style={{ flex: '1 1 200px' }} placeholder={t('template.namePlaceholder', '模板名称')} value={newName} onChange={e => setNewName(e.target.value)} />
            <input className="input" style={{ flex: '1 1 240px' }} placeholder={t('template.descPlaceholder', '描述（可选）')} value={newDesc} onChange={e => setNewDesc(e.target.value)} />
          </div>
          {kind === 'story_structure' && (
            <textarea className="input" rows={4} placeholder={t('template.beatsPlaceholder', '每行一个节拍：名称|描述（如：钩子|开场抛出悬念）')} value={beatsText} onChange={e => setBeatsText(e.target.value)} />
          )}
          {kind === 'style' && (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <select className="input" style={{ flex: '1 1 140px' }} value={styleVideo} onChange={e => setStyleVideo(e.target.value)}>
                <option value="">{t('template.styleVideo', '画面风格')} —</option>
                {STYLES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <input className="input" style={{ flex: '1 1 140px' }} placeholder={t('template.styleBgm', 'BGM 偏好')} value={styleBgm} onChange={e => setStyleBgm(e.target.value)} />
              <input className="input" style={{ flex: '1 1 140px' }} placeholder={t('template.styleCamera', '运镜')} value={styleCamera} onChange={e => setStyleCamera(e.target.value)} />
            </div>
          )}
          {kind === 'prompt' && (
            <>
              <textarea className="input" rows={3} placeholder={t('template.promptPlaceholder', '提示词模板（变量用 {var} 占位）')} value={promptTemplate} onChange={e => setPromptTemplate(e.target.value)} />
              <input className="input" placeholder={t('template.promptVars', '变量名（逗号分隔，如 title,outline）')} value={promptVars} onChange={e => setPromptVars(e.target.value)} />
            </>
          )}
          {kind === 'export' && (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <select className="input" style={{ flex: '1 1 120px' }} value={expPreset} onChange={e => setExpPreset(e.target.value as 'generic' | 'douyin' | 'bilibili')}>
                <option value="generic">{t('template.exportGeneric', '通用')}</option>
                <option value="douyin">{t('template.exportDouyin', '抖音')}</option>
                <option value="bilibili">{t('template.exportBilibili', 'B站')}</option>
              </select>
              <select className="input" style={{ flex: '1 1 110px' }} value={expRes} onChange={e => setExpRes(e.target.value)}>
                {['512P', '720P', '768P', '1080P'].map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem' }}>
                <input type="checkbox" checked={expSubs} onChange={e => setExpSubs(e.target.checked)} /> {t('template.exportSubs', '字幕')}
              </label>
            </div>
          )}
          <button className="btn btn-primary" onClick={createTemplate} disabled={!newName.trim()}>{t('template.createBtn', '新建模板')}</button>
        </div>
      )}

      {loading ? (
        <AsyncState loading minHeight={160} />
      ) : templates.length === 0 ? (
        <AsyncState empty emptyText={t('template.empty', '暂无该类型模板')} minHeight={160} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 240px), 1fr))', gap: '0.75rem', marginTop: '0.75rem' }}>
          {templates.map(tpl => (
            <div
              key={tpl.id}
              className="card"
              style={{ padding: '0.75rem', cursor: 'pointer', border: selected?.id === tpl.id ? '2px solid var(--primary-color)' : undefined }}
              onClick={() => setSelected(tpl)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                <LayoutTemplate size={15} style={{ color: 'var(--primary-color)' }} /> {tpl.name}
                {tpl.builtin && <span style={{ fontSize: '0.65rem', padding: '0.05rem 0.35rem', background: 'rgba(158,172,234,0.2)', borderRadius: 8, color: 'var(--text-secondary)' }}>BUILTIN</span>}
              </div>
              {tpl.description && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>{tpl.description}</div>}
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.35rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {renderContentSummary(tpl)}
              </div>
              <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
                <button className="btn btn-ghost btn-xs" style={{ flex: 1 }} onClick={e => { e.stopPropagation(); copyResolved(tpl); }}>
                  {copied ? <Check size={12} /> : <Copy size={12} />} {t('template.copy', '套用')}
                </button>
                {!tpl.builtin && (
                  <button className="btn btn-ghost btn-xs" style={{ color: 'var(--color-danger)' }} onClick={e => { e.stopPropagation(); deleteTemplate(tpl); }}>
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem' }}>
            <Sparkles size={15} style={{ color: 'var(--primary-color)' }} />
            <h3 style={{ margin: 0 }}>{t('template.previewTitle', '套用预览')}：{selected.name}</h3>
          </div>
          <pre style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', margin: 0, maxHeight: 240, overflowY: 'auto' }}>
            {(() => {
              try {
                const r = templateService.resolve(selected);
                return selected.kind === 'story_structure'
                  ? (r.beats as Array<{ name: string; description: string }>).map(b => `${b.name}：${b.description}`).join('\n')
                  : JSON.stringify(r, null, 2);
              } catch (e) {
                return e instanceof Error ? e.message : String(e);
              }
            })()}
          </pre>
        </div>
      )}
    </div>
  );
};
