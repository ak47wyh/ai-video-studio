/**
 * EditorToolbar —— 剪辑工作台顶部工具栏
 *
 * - 故事选择器
 * - 保存状态指示
 * - 一键重新铺轨（从分镜）
 * - 导出按钮（打开 ExportModal）
 */

import React from 'react';
import { Save, RefreshCw, Download, Loader2, Check, Upload, Scissors } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Story } from '../../../domain/entities/models';

interface EditorToolbarProps {
  stories: Story[];
  storyId: string | null;
  onStoryChange: (storyId: string) => void;
  saving: boolean;
  onSave: () => void;
  onRebuild: () => void;
  onExport: () => void;
  onImportVideo: () => void;
  /** M2.3: AI 智能剪切回调 */
  onAutoEdit?: () => void;
}

export const EditorToolbar: React.FC<EditorToolbarProps> = ({
  stories, storyId, onStoryChange, saving, onSave, onRebuild, onExport, onImportVideo, onAutoEdit,
}) => {
  const { t } = useTranslation();

  return (
    <div className="glass-panel" style={{
      display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 0.9rem', marginBottom: '0.75rem',
    }}>
      <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-main)' }}>
        {t('editor.title', '视频剪辑工作台')}
      </span>

      <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)' }} />

      <select
        className="input"
        style={{ width: 'auto', minWidth: 180 }}
        value={storyId ?? ''}
        onChange={e => onStoryChange(e.target.value)}
      >
        <option value="">{t('editor.selectStory', '选择故事…')}</option>
        {stories.map(s => (
          <option key={s.id} value={s.id}>{s.title || t('export.untitledStory', '未命名故事')}</option>
        ))}
      </select>

      <div style={{ flex: 1 }} />

      {/* 保存状态 */}
      {saving ? (
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          <Loader2 size={12} className="spin" />
          {t('editor.saving', '保存中…')}
        </span>
      ) : (
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', color: 'var(--text-muted)', opacity: 0.6 }}>
          <Check size={12} />
          {t('editor.saved', '已保存')}
        </span>
      )}

      <button className="btn btn-secondary" onClick={onSave} disabled={saving || !storyId} title={t('editor.save', '保存')}>
        <Save size={14} />
      </button>

      <button
        className="btn btn-secondary"
        onClick={onRebuild}
        disabled={!storyId}
        title={t('editor.rebuild', '从分镜重新铺轨')}
      >
        <RefreshCw size={14} />
      </button>

      <button className="btn btn-secondary" onClick={onImportVideo} title={t('editor.media.import.title', '导入视频')}>
        <Upload size={14} />
        {t('editor.media.import.title', '导入视频')}
      </button>

      {/* M2.3: AI 智能剪切按钮 */}
      {onAutoEdit && (
        <button
          className="btn btn-secondary"
          onClick={onAutoEdit}
          disabled={!storyId}
          title={t('editor.autoEdit.title', 'AI 智能剪切')}
        >
          <Scissors size={14} />
          {t('editor.autoEdit.title', 'AI 智能剪切')}
        </button>
      )}

      <button className="btn btn-primary" onClick={onExport} disabled={!storyId}>
        <Download size={14} />
        {t('editor.export.title', '导出视频')}
      </button>
    </div>
  );
};
