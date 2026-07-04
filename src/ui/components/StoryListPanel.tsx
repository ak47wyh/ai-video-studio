import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, Spline, Sparkles, Trash2, Pencil, RefreshCw, Wand2 } from 'lucide-react';
import type { Story } from '../../domain/entities/models';
import { InputWithCounter } from './InputWithCounter';
import { TextAreaWithCounter } from './TextAreaWithCounter';
import { TEXT_LIMITS } from '../../domain/constants/textLimits';

interface StoryListPanelProps {
  stories: Story[] | undefined;
  selectedStoryId: string | null;
  isSplitting: boolean;
  isBreakingDown: boolean;
  refiningStoryText: boolean;
  onSwitchStory: (storyId: string | null) => void;
  onCreateStory: () => Promise<void>;
  onCreateAndBreakdown: () => Promise<void>;
  onQuickSplit: (storyId: string) => Promise<void>;
  onDeleteStory: (storyId: string) => Promise<void>;
  onRefineStoryText: (text: string) => Promise<string>;
  onSaveStory: (storyId: string, title: string, originalText: string) => Promise<void>;
}

export const StoryListPanel: React.FC<StoryListPanelProps> = ({
  stories, selectedStoryId, isSplitting, isBreakingDown, refiningStoryText,
  onSwitchStory, onCreateStory, onCreateAndBreakdown, onQuickSplit, onDeleteStory, onRefineStoryText, onSaveStory,
}) => {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [originalText, setOriginalText] = useState('');
  const [editingStoryId, setEditingStoryId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editOriginalText, setEditOriginalText] = useState('');

  const handleCreate = async () => {
    await onCreateStory();
    setTitle('');
    setOriginalText('');
  };

  const handleCreateAndBreakdown = async () => {
    await onCreateAndBreakdown();
    setTitle('');
    setOriginalText('');
  };

  const handleRefineText = async () => {
    if (!originalText.trim()) return;
    const refined = await onRefineStoryText(originalText);
    setOriginalText(refined);
  };

  const openEditStory = (story: Story) => {
    setEditingStoryId(story.id);
    setEditTitle(story.title);
    setEditOriginalText(story.originalText);
  };

  const handleSaveEdit = async () => {
    if (!editingStoryId || !editTitle.trim()) return;
    await onSaveStory(editingStoryId, editTitle.trim(), editOriginalText.trim());
    setEditingStoryId(null);
  };

  return (
    <div className="workbench-left-panel">
      <div style={{ padding: '1rem' }}>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 700, margin: 0 }}>{t('workbench.newStory')}</h3>
        <div className="form-group" style={{ marginTop: '0.75rem' }}>
          <InputWithCounter maxLength={TEXT_LIMITS.STORY_TITLE_MAX} className="form-input" placeholder={t('workbench.storyTitlePlaceholder')} value={title} onChange={e => setTitle(e.target.value)} />
        </div>
        <div className="form-group">
          <TextAreaWithCounter maxLength={TEXT_LIMITS.STORY_CONTENT_MAX} className="form-textarea" placeholder={t('workbench.storyContentPlaceholder')} value={originalText} onChange={e => setOriginalText(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem' }}>
          <button
            className="btn btn-secondary btn-xs"
            style={{ color: 'var(--lab-color-enhance)' }}
            disabled={refiningStoryText || !originalText.trim()}
            onClick={handleRefineText}
          >
            {refiningStoryText ? <RefreshCw size={12} className="spin" /> : <Wand2 size={12} />}
            {refiningStoryText ? t('textAI.refiningText') : t('textAI.refineText')}
          </button>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button
            className="btn btn-primary btn-sm"
            style={{ flex: 1 }}
            onClick={handleCreateAndBreakdown}
            disabled={isBreakingDown || !title || !originalText}
          >
            {isBreakingDown ? t('workbench.breakingDown') : <><Sparkles size={14} /> {t('workbench.breakdownBtn')}</>}
          </button>
          <button
            className="btn btn-secondary btn-sm"
            style={{ flex: 1 }}
            onClick={handleCreate}
            disabled={isSplitting || !title || !originalText}
          >
            {isSplitting ? t('workbench.splitting') : <><Spline size={14} /> {t('workbench.splitBtn')}</>}
          </button>
        </div>
        <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.4rem', lineHeight: 1.4 }}>
          {t('workbench.breakdownTip')}
        </p>
      </div>

      <div style={{ padding: '1rem', flex: 1, overflowY: 'auto', borderTop: '1px solid var(--border-color)' }}>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 0.5rem 0' }}>{t('workbench.yourStories')}</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {stories?.map(s => (
            <div key={s.id}>
              {editingStoryId === s.id ? (
                <div className="glass-panel" style={{ padding: '0.75rem' }}>
                  <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                    <InputWithCounter maxLength={TEXT_LIMITS.STORY_TITLE_MAX} className="form-input" value={editTitle} onChange={e => setEditTitle(e.target.value)} placeholder={t('workbench.storyTitlePlaceholder')} />
                  </div>
                  <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                    <TextAreaWithCounter maxLength={TEXT_LIMITS.STORY_CONTENT_MAX} className="form-textarea" value={editOriginalText} onChange={e => setEditOriginalText(e.target.value)} placeholder={t('workbench.storyContentPlaceholder')} style={{ minHeight: '60px' }} />
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <button className="btn btn-primary btn-xs" onClick={handleSaveEdit}>{t('workbench.saveEditBtn')}</button>
                    <button className="btn btn-secondary btn-xs" onClick={() => setEditingStoryId(null)}>{t('workbench.cancelBtn')}</button>
                  </div>
                </div>
              ) : (
                <div
                  className="glass-panel interactive"
                  style={{
                    padding: '0.5rem 0.75rem', cursor: 'pointer',
                    borderColor: selectedStoryId === s.id ? 'var(--primary-color)' : 'var(--border-color)',
                    background: selectedStoryId === s.id ? 'var(--bg-panel-hover)' : 'var(--bg-panel)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    borderRadius: 'var(--radius-md)',
                  }}
                  onClick={() => onSwitchStory(s.id)}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</div>
                    <span style={{
                      display: 'inline-block', padding: '0.05rem 0.4rem', borderRadius: '999px',
                      fontSize: '0.65rem', fontWeight: 600,
                      background: s.status === 'SPLIT' ? 'rgba(52,211,153,0.15)' : 'rgba(251,191,36,0.15)',
                      color: s.status === 'SPLIT' ? '#34d399' : '#fbbf24',
                    }}>
                      {s.status === 'SPLIT' ? t('workbench.statusSplit') : t('workbench.statusDraft')}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.15rem', flexShrink: 0 }}>
                    {s.status === 'DRAFT' && (
                      <button
                        className="btn btn-secondary btn-xs"
                        style={{ padding: '0.2rem', border: 'none' }}
                        onClick={(e) => { e.stopPropagation(); onQuickSplit(s.id); }}
                        title={t('workbench.splitBtn')}
                      >
                        <Spline size={12} />
                      </button>
                    )}
                    <button
                      className="btn btn-secondary btn-xs"
                      style={{ padding: '0.2rem', border: 'none' }}
                      onClick={(e) => { e.stopPropagation(); openEditStory(s); }}
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      className="btn btn-secondary btn-xs"
                      style={{ padding: '0.2rem', border: 'none' }}
                      onClick={(e) => { e.stopPropagation(); onDeleteStory(s.id); }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {stories?.length === 0 && (
            <div style={{ textAlign: 'center', padding: '1.5rem 0.5rem', color: 'var(--text-muted)' }}>
              <BookOpen size={28} style={{ marginBottom: '0.5rem', opacity: 0.4 }} />
              <p style={{ fontSize: '0.8rem' }}>{t('workbench.noStoriesHint')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};