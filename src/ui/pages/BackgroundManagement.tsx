import React, { useState, useCallback } from 'react';
import { backgroundRepo, storyService, storySpaceService, imageGenerationService, imageAdapter, textGenerationService } from '../../dependencies';
import { useSpaceScopedBackgrounds, useAllSpaces } from '../hooks/useSpaceScopedQuery';
import { v4 as uuidv4 } from 'uuid';
import { Pencil, Plus, Trash2, Copy, Image as ImageIcon, ChevronDown, ChevronUp, Sparkles, RefreshCw, Wand2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Background } from '../../domain/entities/models';
import type { ImageAspectRatio } from '../../domain/ports/OutboundPorts';
import { useSpace } from '../contexts/SpaceContext';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { useImageUpload, useCopyToSpace } from '../hooks/useSharedForm';
import { getErrorMessage } from '../utils/errorUtils';
import { TextAreaWithCounter } from '../components/TextAreaWithCounter';
import { InputWithCounter } from '../components/InputWithCounter';
import { TEXT_LIMITS } from '../../domain/constants/textLimits';

export const BackgroundManagement: React.FC = () => {
  const { t } = useTranslation();
  const { currentSpaceId } = useSpace();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const backgrounds = useSpaceScopedBackgrounds();
  const allSpaces = useAllSpaces();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingBackgroundId, setEditingBackgroundId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [environmentPrompt, setEnvironmentPrompt] = useState('');
  const [generatingBgId, setGeneratingBgId] = useState<string | null>(null);
  const [generateAspectRatio, setGenerateAspectRatio] = useState('16:9');
  const { imageInputMode, imageUrl, imageUploadError, isGenerating, setImageUrl, handleImageUpload, switchImageMode, resetImageState } = useImageUpload('background');
  const { copyingId, copyTargetSpaceId, setCopyTargetSpaceId, startCopy, finishCopy } = useCopyToSpace();
  const [expandedFields, setExpandedFields] = useState<Set<string>>(new Set());
  const [refiningEnv, setRefiningEnv] = useState(false);

  const toggleExpand = useCallback((key: string) => {
    setExpandedFields(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const resetForm = () => {
    setEditingBackgroundId(null);
    setName('');
    setEnvironmentPrompt('');
    resetImageState();
    setIsFormOpen(false);
  };

  const openCreateForm = () => {
    if (isFormOpen && !editingBackgroundId) {
      resetForm();
      return;
    }
    resetForm();
    setIsFormOpen(true);
  };

  const handleEdit = (bgId: string) => {
    const bg = backgrounds?.find(item => item.id === bgId);
    if (!bg) return;
    setEditingBackgroundId(bg.id);
    setName(bg.name);
    setEnvironmentPrompt(bg.environmentPrompt);
    setImageUrl(bg.referenceImageUrl || '');
    switchImageMode(bg.referenceImageUrl?.startsWith('data:image/') ? 'upload' : 'url');
    setIsFormOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !currentSpaceId) return;

    const createdAt = editingBackgroundId
      ? (backgrounds?.find(item => item.id === editingBackgroundId)?.createdAt ?? Date.now())
      : Date.now();

    const background: Background = {
      id: editingBackgroundId ?? uuidv4(),
      spaceId: currentSpaceId,
      name: name.trim(),
      environmentPrompt: environmentPrompt.trim(),
      referenceImageUrl: imageUrl.trim() || undefined,
      createdAt
    };
    await backgroundRepo.save(background);
    showToast('success', t(editingBackgroundId ? 'background.updateSuccess' : 'background.saveSuccess'));
    resetForm();
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: t('background.confirmDeleteTitle'),
      message: t('background.confirmDelete'),
      confirmLabel: t('background.deleteConfirmBtn'),
      danger: true
    });
    if (!ok) return;
    await storyService.removeBackgroundFromSegments(id);
    await backgroundRepo.delete(id);
    showToast('success', t('background.deleteSuccess'));
  };

  const handleCopyToSpace = async (bgId: string, targetSpaceId: string) => {
    if (!targetSpaceId) return;
    await storySpaceService.copyBackgroundToSpace(bgId, targetSpaceId);
    finishCopy();
    showToast('success', t('background.copySuccess'));
  };

  const otherSpaces = allSpaces?.filter(s => s.id !== currentSpaceId) ?? [];

  const handleGenerateBackgroundImage = async (bgId: string) => {
    setGeneratingBgId(bgId);
    try {
      await imageGenerationService.generateBackgroundImage(bgId, generateAspectRatio);
      showToast('success', t('background.generateImageSuccess'));
    } catch (e: unknown) {
      const message = getErrorMessage(e, t('background.generateImageFailed'));
      showToast('error', message);
    } finally {
      setGeneratingBgId(null);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{t('background.title')}</h1>
          <p>{t('background.subtitle')}</p>
        </div>
        <button className="btn btn-primary" onClick={openCreateForm}>
          <Plus size={18} /> {t('background.newBtn')}
        </button>
      </div>

      {isFormOpen && (
        <form className="glass-panel" style={{ padding: '0.75rem', marginBottom: '0.75rem' }} onSubmit={handleSave}>
          <h3 style={{ marginBottom: '0.75rem' }}>
            {editingBackgroundId ? t('background.editTitle') : t('background.createTitle')}
          </h3>
          <div className="form-group">
            <label className="form-label">{t('background.nameLabel')}</label>
            <InputWithCounter
              className="form-input"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              placeholder={t('background.namePlaceholder')}
              maxLength={TEXT_LIMITS.BG_NAME_MAX}
            />
          </div>
          <div className="form-group">
            <label className="form-label">{t('background.envLabel')}</label>
            <TextAreaWithCounter
              className="form-textarea"
              value={environmentPrompt}
              onChange={e => setEnvironmentPrompt(e.target.value)}
              placeholder={t('background.envPlaceholder')}
              maxLength={TEXT_LIMITS.BG_ENV_PROMPT_MAX}
            />
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              style={{ marginTop: '0.3rem', color: 'var(--lab-color-image)' }}
              disabled={!environmentPrompt.trim() || refiningEnv}
              onClick={async () => {
                setRefiningEnv(true);
                try {
                  const result = await textGenerationService.refinePrompt(environmentPrompt, 'background');
                  setEnvironmentPrompt(result.content);
                  showToast('success', t('textAI.promptRefined'));
                } catch (e) {
                  showToast('error', getErrorMessage(e, t('textAI.promptRefineFailed')));
                } finally {
                  setRefiningEnv(false);
                }
              }}
            >
              {refiningEnv ? <RefreshCw size={12} className="spin" /> : <Wand2 size={12} />}
              {refiningEnv ? t('textAI.refiningPrompt') : t('textAI.refinePrompt')}
            </button>
          </div>
          <div className="form-group">
            <label className="form-label">{t('background.imageSourceLabel')}</label>
            <select
              className="form-select"
              value={imageInputMode}
              onChange={e => switchImageMode(e.target.value as 'url' | 'upload' | 'generate')}
            >
              <option value="url">{t('background.imageSourceUrl')}</option>
              <option value="upload">{t('background.imageSourceUpload')}</option>
              <option value="generate">{t('background.imageSourceGenerate')}</option>
            </select>
          </div>
          {imageInputMode === 'url' ? (
            <div className="form-group">
              <label className="form-label">{t('background.imageLabel')}</label>
              <InputWithCounter className="form-input" value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder={t('background.imagePlaceholder')} maxLength={TEXT_LIMITS.URL_MAX} />
            </div>
          ) : imageInputMode === 'upload' ? (
            <div className="form-group">
              <label className="form-label">{t('background.uploadLabel')}</label>
              <input className="form-input" type="file" accept="image/*" onChange={handleImageUpload} />
              {imageUploadError && (
                <p className="lab-info-hint" style={{ color: 'lightcoral' }}>{imageUploadError}</p>
              )}
            </div>
          ) : (
            <div className="form-group">
              <label className="form-label">{t('background.aspectRatioLabel')}</label>
              <select className="form-select" value={generateAspectRatio} onChange={e => setGenerateAspectRatio(e.target.value)}>
                <option value="16:9">{t('background.aspectRatio16_9')}</option>
                <option value="1:1">{t('background.aspectRatio1_1')}</option>
                <option value="4:3">{t('background.aspectRatio4_3')}</option>
                <option value="3:4">{t('background.aspectRatio3_4')}</option>
                <option value="9:16">{t('background.aspectRatio9_16')}</option>
              </select>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                style={{ marginTop: '0.5rem' }}
                disabled={isGenerating || !environmentPrompt.trim()}
                onClick={async () => {
                  if (!environmentPrompt.trim()) {
                    showToast('warning', t('background.noPromptForImage'));
                    return;
                  }
                  try {
                    const result = await imageAdapter.generateImage({ prompt: environmentPrompt.trim(), aspectRatio: generateAspectRatio as ImageAspectRatio, promptOptimizer: true });
                    setImageUrl(result.imageDataUri || result.imageUrls?.[0] || '');
                  } catch (err: unknown) {
                    const msg = getErrorMessage(err, 'Image generation failed');
                    showToast('error', msg);
                  }
                }}
              >
                <Sparkles size={14} />
                {isGenerating ? t('background.generatingImage') : t('background.generateBtn')}
              </button>
            </div>
          )}
          {imageUrl && (
            <div style={{ marginBottom: '0.5rem' }}>
              <img
                src={imageUrl}
                alt={name || t('background.previewAlt')}
                style={{ width: '100%', maxHeight: '200px', objectFit: 'cover', borderRadius: 'var(--radius-md)' }}
                onError={(e) => (e.currentTarget.style.display = 'none')}
              />
            </div>
          )}
          <div className="flex gap-4">
            <button type="submit" className="btn btn-primary">
              {editingBackgroundId ? t('background.updateBtn') : t('background.saveBtn')}
            </button>
            <button type="button" className="btn btn-secondary" onClick={resetForm}>{t('background.cancelBtn')}</button>
          </div>
        </form>
      )}

      <div className="lab-compact-grid">
        {backgrounds?.map(bg => (
          <div key={bg.id} className="glass-panel" style={{ padding: '0.75rem', position: 'relative' }}>
            {bg.referenceImageUrl && (
              <img
                src={bg.referenceImageUrl}
                alt={bg.name}
                style={{ width: '100%', height: '120px', objectFit: 'cover', borderRadius: 'var(--radius-md)', marginBottom: '0.5rem' }}
                onError={(e) => (e.currentTarget.style.display = 'none')}
              />
            )}
            <h3 style={{ marginBottom: '0.25rem', fontSize: '0.9rem' }}>{bg.name}</h3>
            {bg.environmentPrompt && (
              <div style={{ fontSize: '0.8rem', marginBottom: '0.25rem', opacity: 0.8 }}>
                <strong>{t('background.environment')}</strong>
                <span style={expandedFields.has(`${bg.id}-env`) ? undefined : { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{bg.environmentPrompt}</span>
                {bg.environmentPrompt.length > 80 && (
                  <button onClick={() => toggleExpand(`${bg.id}-env`)} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.75rem', padding: '0 0.25rem', verticalAlign: 'middle' }}>
                    {expandedFields.has(`${bg.id}-env`) ? <><ChevronUp size={12} /> {t('common.collapse')}</> : <><ChevronDown size={12} /> {t('common.expand')}</>}
                  </button>
                )}
              </div>
            )}
            <div style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', display: 'flex', gap: '0.3rem' }}>
              <button
                className="btn btn-secondary"
                style={{ padding: '0.3rem', border: 'none', color: 'var(--lab-color-image)' }}
                onClick={() => handleGenerateBackgroundImage(bg.id)}
                disabled={generatingBgId === bg.id}
                title={t('background.generateImage')}
              >
                {generatingBgId === bg.id ? <RefreshCw size={16} className="spin" /> : <Sparkles size={16} />}
              </button>
              <button
                className="btn btn-secondary"
                style={{ padding: '0.3rem', border: 'none' }}
                onClick={() => handleEdit(bg.id)}
              >
                <Pencil size={16} />
              </button>
              <button
                className="btn btn-secondary"
                style={{ padding: '0.3rem', border: 'none' }}
                onClick={() => handleDelete(bg.id)}
              >
                <Trash2 size={16} />
              </button>
              <button
                className="btn btn-secondary"
                style={{ padding: '0.3rem', border: 'none' }}
                title={t('background.copyToSpace')}
                onClick={() => startCopy(bg.id)}
              >
                <Copy size={16} />
              </button>
            </div>
            {copyingId === bg.id && otherSpaces.length > 0 && (
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', alignItems: 'center' }}>
                <select
                  className="form-select"
                  style={{ flex: 1, fontSize: '0.8rem', padding: '0.3rem 0.5rem' }}
                  value={copyTargetSpaceId}
                  onChange={e => setCopyTargetSpaceId(e.target.value)}
                >
                  <option value="">{t('space.selectTarget')}</option>
                  {otherSpaces.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <button
                  className="btn btn-primary btn-xs"
                  disabled={!copyTargetSpaceId}
                  onClick={() => handleCopyToSpace(bg.id, copyTargetSpaceId)}
                >
                  ✓
                </button>
              </div>
            )}
          </div>
        ))}
        {backgrounds?.length === 0 && !isFormOpen && (
          <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', gridColumn: '1 / -1' }}>
            <ImageIcon size={48} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
            <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>{t('background.empty')}</p>
            <button className="btn btn-primary" onClick={openCreateForm}>
              <Plus size={18} /> {t('background.newBtn')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
