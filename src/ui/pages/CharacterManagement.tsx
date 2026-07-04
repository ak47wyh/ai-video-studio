import React, { useState, useCallback } from 'react';
import { useSpaceScopedCharacters, useAllSpaces } from '../hooks/useSpaceScopedQuery';
import { characterRepo, storyService, storySpaceService, imageGenerationService, imageAdapter, voiceService, textGenerationService } from '../../dependencies';
import { v4 as uuidv4 } from 'uuid';
import { Pencil, Plus, Trash2, Copy, Users, ChevronDown, ChevronUp, Sparkles, RefreshCw, Mic, Upload, Volume2, Wand2, Palette, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Character, SavedVoice } from '../../domain/entities/models';
import type { ImageAspectRatio } from '../../domain/ports/OutboundPorts';
import { useSpace } from '../contexts/SpaceContext';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { useImageUpload, useCopyToSpace } from '../hooks/useSharedForm';
import { SYSTEM_VOICES, VOICES_BY_LANGUAGE, LANGUAGE_LABELS } from '../../domain/data/systemVoices';
import { getErrorMessage } from '../utils/errorUtils';
import { AssetPicker } from '../components/AssetPicker';
import { useAssetPicker } from '../hooks/useAssetPicker';
import { TextAreaWithCounter } from '../components/TextAreaWithCounter';
import { InputWithCounter } from '../components/InputWithCounter';
import { TEXT_LIMITS } from '../../domain/constants/textLimits';

export const CharacterManagement: React.FC = () => {
  const { t } = useTranslation();
  const { currentSpaceId } = useSpace();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const { state: assetPickerState, openPicker, closePicker } = useAssetPicker();
  const characters = useSpaceScopedCharacters();
  const allSpaces = useAllSpaces();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingCharacterId, setEditingCharacterId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [appearance, setAppearance] = useState('');
  const [personality, setPersonality] = useState('');
  const [characterBackground, setCharacterBackground] = useState('');
  const [generatingCharId, setGeneratingCharId] = useState<string | null>(null);
  const [generateAspectRatio, setGenerateAspectRatio] = useState('1:1');
  const [selectedVoiceId, setSelectedVoiceId] = useState('');
  const [isCloning, setIsCloning] = useState(false);
  const [cloneAudioFile, setCloneAudioFile] = useState<File | null>(null);
  const [promptAudioFile, setPromptAudioFile] = useState<File | null>(null);
  const [promptText, setPromptText] = useState('');
  const { imageInputMode, imageUrl, imageUploadError, isGenerating, setImageUrl, handleImageUpload, switchImageMode, resetImageState } = useImageUpload('character');
  const { copyingId, copyTargetSpaceId, setCopyTargetSpaceId, startCopy, finishCopy } = useCopyToSpace();
  const [expandedFields, setExpandedFields] = useState<Set<string>>(new Set());
  const [refiningField, setRefiningField] = useState<'appearance' | 'personality' | null>(null);
  const [isDesigningVoice, setIsDesigningVoice] = useState(false);
  const [voiceDesignPrompt, setVoiceDesignPrompt] = useState('');
  const [voiceDesignPreviewText, setVoiceDesignPreviewText] = useState('你好，很高兴认识你');
  const [designPreviewAudioUrl, setDesignPreviewAudioUrl] = useState<string | null>(null);

  const toggleExpand = useCallback((key: string) => {
    setExpandedFields(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const resetForm = () => {
    setEditingCharacterId(null);
    setName('');
    setAppearance('');
    setPersonality('');
    setCharacterBackground('');
    setSelectedVoiceId('');
    setCloneAudioFile(null);
    setPromptAudioFile(null);
    setPromptText('');
    resetImageState();
    setIsFormOpen(false);
  };

  const openCreateForm = () => {
    if (isFormOpen && !editingCharacterId) {
      resetForm();
      return;
    }
    resetForm();
    setIsFormOpen(true);
  };

  const handleEdit = (characterId: string) => {
    const character = characters?.find(item => item.id === characterId);
    if (!character) return;
    setEditingCharacterId(character.id);
    setName(character.name);
    setAppearance(character.appearancePrompt);
    setPersonality(character.personalityPrompt);
    setCharacterBackground(character.characterBackground || '');
    setImageUrl(character.referenceImageUrl || '');
    setSelectedVoiceId(character.voiceId || '');
    switchImageMode(character.referenceImageUrl?.startsWith('data:image/') ? 'upload' : 'url');
    setIsFormOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !currentSpaceId) return;
    const createdAt = editingCharacterId
      ? (characters?.find(item => item.id === editingCharacterId)?.createdAt ?? Date.now())
      : Date.now();

    const character: Character = {
      id: editingCharacterId ?? uuidv4(),
      spaceId: currentSpaceId,
      name: name.trim(),
      appearancePrompt: appearance.trim(),
      personalityPrompt: personality.trim(),
      characterBackground: characterBackground.trim(),
      referenceImageUrl: imageUrl.trim() || undefined,
      voiceId: selectedVoiceId || undefined,
      createdAt
    };
    await characterRepo.save(character);
    showToast('success', t(editingCharacterId ? 'character.updateSuccess' : 'character.saveSuccess'));
    resetForm();
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: t('character.confirmDeleteTitle'),
      message: t('character.confirmDelete'),
      confirmLabel: t('character.deleteConfirmBtn'),
      danger: true
    });
    if (!ok) return;
    await storyService.removeCharacterFromSegments(id);
    await characterRepo.delete(id);
    showToast('success', t('character.deleteSuccess'));
  };

  const handleCopyToSpace = async (charId: string, targetSpaceId: string) => {
    if (!targetSpaceId) return;
    await storySpaceService.copyCharacterToSpace(charId, targetSpaceId);
    finishCopy();
    showToast('success', t('character.copySuccess'));
  };

  const otherSpaces = allSpaces?.filter(s => s.id !== currentSpaceId) ?? [];

  const handleGenerateCharacterImage = async (characterId: string) => {
    setGeneratingCharId(characterId);
    try {
      await imageGenerationService.generateCharacterImage(characterId, generateAspectRatio);
      showToast('success', t('character.generateImageSuccess'));
    } catch (e: unknown) {
      const message = getErrorMessage(e, t('character.generateImageFailed'));
      showToast('error', message);
    } finally {
      setGeneratingCharId(null);
    }
  };

  return (
    <div className="character-page fade-in">
      <div className="page-header">
        <div>
          <h1>{t('character.title')}</h1>
          <p>{t('character.subtitle')}</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={openCreateForm}>
          <Plus size={16} /> {t('character.newBtn')}
        </button>
      </div>

      {isFormOpen && (
        <form className="glass-panel character-form" onSubmit={handleSave}>
          <h3>{editingCharacterId ? t('character.editTitle') : t('character.createTitle')}</h3>

          {/* Basic info — horizontal form section */}
          <div className="form-section">
            <div className="form-section-item">
              <div className="form-group">
                <label className="form-label">{t('character.nameLabel')}</label>
                <InputWithCounter
                  className="form-input"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                  placeholder={t('character.namePlaceholder')}
                  maxLength={TEXT_LIMITS.CHAR_NAME_MAX}
                />
              </div>
            </div>
            <div className="form-section-item">
              <div className="form-group">
                <label className="form-label">{t('character.appearanceLabel')}</label>
                <TextAreaWithCounter
                  className="form-textarea"
                  value={appearance}
                  onChange={e => setAppearance(e.target.value)}
                  placeholder={t('character.appearancePlaceholder')}
                  style={{ minHeight: '60px' }}
                  maxLength={TEXT_LIMITS.CHAR_APPEARANCE_MAX}
                />
                <button type="button" className="btn btn-secondary character-form-refine-btn"
                  disabled={!appearance.trim() || refiningField === 'appearance'}
                  onClick={async () => {
                    setRefiningField('appearance');
                    try { const result = await textGenerationService.refinePrompt(appearance, 'character_appearance'); setAppearance(result.content); showToast('success', t('textAI.promptRefined')); }
                    catch (e) { showToast('error', getErrorMessage(e, t('textAI.promptRefineFailed'))); }
                    finally { setRefiningField(null); }
                  }}>
                  {refiningField === 'appearance' ? <RefreshCw size={10} className="spin" /> : <Wand2 size={10} />}
                  {refiningField === 'appearance' ? t('textAI.refiningPrompt') : t('textAI.refineCharAppearance')}
                </button>
              </div>
            </div>
            <div className="form-section-item">
              <div className="form-group">
                <label className="form-label">{t('character.personalityLabel')}</label>
                <TextAreaWithCounter
                  className="form-textarea"
                  value={personality}
                  onChange={e => setPersonality(e.target.value)}
                  placeholder={t('character.personalityPlaceholder')}
                  style={{ minHeight: '60px' }}
                  maxLength={TEXT_LIMITS.CHAR_PERSONALITY_MAX}
                />
                <button type="button" className="btn btn-secondary character-form-refine-btn"
                  disabled={!personality.trim() || refiningField === 'personality'}
                  onClick={async () => {
                    setRefiningField('personality');
                    try { const result = await textGenerationService.refinePrompt(personality, 'character_personality'); setPersonality(result.content); showToast('success', t('textAI.promptRefined')); }
                    catch (e) { showToast('error', getErrorMessage(e, t('textAI.promptRefineFailed'))); }
                    finally { setRefiningField(null); }
                  }}>
                  {refiningField === 'personality' ? <RefreshCw size={10} className="spin" /> : <Wand2 size={10} />}
                  {refiningField === 'personality' ? t('textAI.refiningPrompt') : t('textAI.refineCharPersonality')}
                </button>
              </div>
            </div>
            <div className="form-section-item">
              <div className="form-group">
                <label className="form-label">{t('character.backgroundLabel')}</label>
                <TextAreaWithCounter
                  className="form-textarea"
                  value={characterBackground}
                  onChange={e => setCharacterBackground(e.target.value)}
                  placeholder={t('character.backgroundPlaceholder')}
                  style={{ minHeight: '60px' }}
                  maxLength={TEXT_LIMITS.CHAR_BACKGROUND_MAX}
                />
              </div>
            </div>
          </div>

          {/* Voice Selection */}
          <div className="character-form-section">
            <div className="character-form-section-label" style={{ color: 'var(--primary-color)' }}>
              <Mic size={14} /> {t('character.voiceLabel')}
            </div>
            <div className="form-group">
              <select className="form-select" value={selectedVoiceId} onChange={e => setSelectedVoiceId(e.target.value)}>
                <option value="">{t('character.noVoice')}</option>
                {Object.entries(VOICES_BY_LANGUAGE).map(([lang, voices]) => (
                  <optgroup key={lang} label={LANGUAGE_LABELS[lang] || lang}>
                    {voices.map(v => (<option key={v.voiceId} value={v.voiceId}>{v.name}</option>))}
                  </optgroup>
                ))}
              </select>
            </div>
            <button type="button" className="btn btn-secondary btn-xs"
              onClick={() => openPicker('voice', (asset) => { if ('voiceId' in asset) setSelectedVoiceId((asset as SavedVoice).voiceId || ''); })}>
              {t('assetLibrary.pickerTitle', '从素材库选择').replace('{{type}}', t('assetLibrary.typeVoice', '音色'))}
            </button>
          </div>

          {/* Voice Clone */}
          <div className="character-form-section" style={{ borderColor: 'rgba(99,102,241,0.2)' }}>
            <div className="character-form-section-label" style={{ color: 'var(--primary-color)' }}>
              <Upload size={14} /> {t('character.cloneVoice')}
            </div>
            <div className="form-group">
              <label className="form-label" style={{ fontSize: '0.75rem' }}>{t('character.cloneAudioLabel')}</label>
              <input className="form-input" type="file" accept="audio/mp3,audio/m4a,audio/wav,audio/mpeg" onChange={e => setCloneAudioFile(e.target.files?.[0] || null)} />
              <p className="character-form-section-hint">{t('character.cloneAudioHint')}</p>
            </div>
            <div className="form-group">
              <label className="form-label" style={{ fontSize: '0.75rem' }}>{t('character.promptAudioLabel')}</label>
              <input className="form-input" type="file" accept="audio/mp3,audio/m4a,audio/wav,audio/mpeg" onChange={e => setPromptAudioFile(e.target.files?.[0] || null)} />
              <p className="character-form-section-hint">{t('character.promptAudioHint')}</p>
            </div>
            <div className="form-group">
              <label className="form-label" style={{ fontSize: '0.75rem' }}>{t('character.promptTextLabel')}</label>
              <InputWithCounter className="form-input" value={promptText} onChange={e => setPromptText(e.target.value)} maxLength={TEXT_LIMITS.VOICE_CLONE_PROMPT_MAX} />
            </div>
            <button type="button" className="btn btn-secondary btn-xs"
              disabled={isCloning || !cloneAudioFile}
              onClick={async () => {
                if (!cloneAudioFile) return;
                setIsCloning(true);
                try {
                  const customVoiceId = `clone_${Date.now()}`;
                  const text = personality.trim() || appearance.trim() || '你好，我是' + (name.trim() || '角色');
                  const clonedVoiceId = await voiceService.cloneVoice(cloneAudioFile, customVoiceId, text, promptAudioFile || undefined, promptText || undefined);
                  setSelectedVoiceId(clonedVoiceId);
                  showToast('success', t('character.cloneVoiceSuccess'));
                } catch (e: unknown) { showToast('error', getErrorMessage(e, t('character.cloneVoiceFailed'))); }
                finally { setIsCloning(false); }
              }}>
              {isCloning ? <RefreshCw size={12} className="spin" /> : <Upload size={12} />}
              {isCloning ? t('character.cloneVoiceCloning') : t('character.cloneVoiceBtn')}
            </button>
          </div>

          {/* Voice Design */}
          <div className="character-form-section" style={{ borderColor: 'rgba(168,85,247,0.2)' }}>
            <div className="character-form-section-label" style={{ color: 'var(--lab-color-image)' }}>
              <Palette size={14} /> {t('character.designVoice')}
            </div>
            <div className="form-group">
              <label className="form-label" style={{ fontSize: '0.75rem' }}>{t('character.voiceDesignPromptLabel')}</label>
              <InputWithCounter className="form-input" value={voiceDesignPrompt} onChange={e => setVoiceDesignPrompt(e.target.value)} placeholder={t('character.voiceDesignPromptPlaceholder')} maxLength={TEXT_LIMITS.VOICE_DESIGN_PROMPT_MAX} />
              <p className="character-form-section-hint">{t('character.voiceDesignPromptHint')}</p>
            </div>
            <div className="form-group">
              <label className="form-label" style={{ fontSize: '0.75rem' }}>{t('character.voiceDesignPreviewLabel')}</label>
              <InputWithCounter className="form-input" value={voiceDesignPreviewText} onChange={e => setVoiceDesignPreviewText(e.target.value)} maxLength={TEXT_LIMITS.VOICE_DESIGN_PREVIEW_MAX} />
            </div>
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <button type="button" className="btn btn-secondary btn-xs"
                disabled={isDesigningVoice || !voiceDesignPrompt.trim()}
                onClick={async () => {
                  if (!voiceDesignPrompt.trim()) return;
                  setIsDesigningVoice(true); setDesignPreviewAudioUrl(null);
                  try {
                    const result = await voiceService.designVoice(voiceDesignPrompt, voiceDesignPreviewText);
                    setSelectedVoiceId(result.voiceId);
                    if (result.trialAudioHex) { setDesignPreviewAudioUrl(`data:audio/mp3;base64,${result.trialAudioHex}`); }
                    showToast('success', t('character.designVoiceSuccess'));
                  } catch (e: unknown) { showToast('error', getErrorMessage(e, t('character.designVoiceFailed'))); }
                  finally { setIsDesigningVoice(false); }
                }}>
                {isDesigningVoice ? <RefreshCw size={12} className="spin" /> : <Palette size={12} />}
                {isDesigningVoice ? t('character.designingVoice') : t('character.designVoiceBtn')}
              </button>
              {designPreviewAudioUrl && (
                <button type="button" className="btn btn-secondary btn-xs"
                  onClick={() => { const audio = new Audio(designPreviewAudioUrl); audio.play().catch(() => {}); }}>
                  <Play size={10} /> {t('character.previewVoice')}
                </button>
              )}
            </div>
          </div>

          {/* Image Source */}
          <div className="character-form-section">
            <div className="character-form-section-label">
              <Sparkles size={14} /> {t('character.imageSourceLabel')}
            </div>
            <div className="form-group">
              <select className="form-select" value={imageInputMode} onChange={e => switchImageMode(e.target.value as 'url' | 'upload' | 'generate')}>
                <option value="url">{t('character.imageSourceUrl')}</option>
                <option value="upload">{t('character.imageSourceUpload')}</option>
                <option value="generate">{t('character.imageSourceGenerate')}</option>
              </select>
            </div>
            {imageInputMode === 'url' ? (
              <div className="form-group">
                <InputWithCounter className="form-input" value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder={t('character.imagePlaceholder')} maxLength={TEXT_LIMITS.URL_MAX} />
              </div>
            ) : imageInputMode === 'upload' ? (
              <div className="form-group">
                <input className="form-input" type="file" accept="image/*" onChange={handleImageUpload} />
                {imageUploadError && <p style={{ marginTop: '0.3rem', color: 'lightcoral', fontSize: '0.75rem' }}>{imageUploadError}</p>}
              </div>
            ) : (
              <div className="form-group">
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <select className="form-select" style={{ width: '100px' }} value={generateAspectRatio} onChange={e => setGenerateAspectRatio(e.target.value)}>
                    <option value="1:1">1:1</option><option value="16:9">16:9</option><option value="4:3">4:3</option><option value="3:4">3:4</option><option value="9:16">9:16</option>
                  </select>
                  <button type="button" className="btn btn-primary btn-xs"
                    disabled={isGenerating || (!appearance.trim() && !personality.trim())}
                    onClick={async () => {
                      if (!appearance.trim() && !personality.trim()) { showToast('warning', t('character.noPromptForImage')); return; }
                      const prompt = [appearance.trim(), personality.trim()].filter(Boolean).join(', ');
                      try { const result = await imageAdapter.generateImage({ prompt, aspectRatio: generateAspectRatio as ImageAspectRatio, promptOptimizer: true }); setImageUrl(result.imageDataUri || result.imageUrls?.[0] || ''); }
                      catch (err: unknown) { showToast('error', getErrorMessage(err, 'Image generation failed')); }
                    }}>
                    <Sparkles size={12} /> {isGenerating ? t('character.generatingImage') : t('character.generateBtn')}
                  </button>
                </div>
              </div>
            )}
            {imageUrl && (
              <img src={imageUrl} alt={t('character.previewAlt')} className="character-form-image-preview"
                onError={(e) => (e.currentTarget.style.display = 'none')} />
            )}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="submit" className="btn btn-primary btn-sm">{editingCharacterId ? t('character.updateBtn') : t('character.saveBtn')}</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={resetForm}>{t('character.cancelBtn')}</button>
          </div>
        </form>
      )}

      <div className="character-grid">
        {characters?.map(char => (
          <div key={char.id} className="glass-panel character-card">
            {char.referenceImageUrl ? (
              <img src={char.referenceImageUrl} alt={char.name} className="character-card-image"
                onError={(e) => (e.currentTarget.style.display = 'none')} />
            ) : (
              <div className="character-card-image" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Users size={24} style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
              </div>
            )}
            <div className="character-card-info">
              <h4 className="character-card-name">{char.name}</h4>
              {char.appearancePrompt && (
                <div className="character-card-field">
                  <strong>{t('character.appearance')}</strong>
                  <span className={`character-card-field-text${expandedFields.has(`${char.id}-appearance`) ? ' expanded' : ''}`}>{char.appearancePrompt}</span>
                  {char.appearancePrompt.length > 80 && (
                    <button className="character-card-expand-btn" onClick={() => toggleExpand(`${char.id}-appearance`)}>
                      {expandedFields.has(`${char.id}-appearance`) ? <><ChevronUp size={10} /> {t('common.collapse')}</> : <><ChevronDown size={10} /> {t('common.expand')}</>}
                    </button>
                  )}
                </div>
              )}
              {char.personalityPrompt && (
                <div className="character-card-field">
                  <strong>{t('character.personality')}</strong>
                  <span className={`character-card-field-text${expandedFields.has(`${char.id}-personality`) ? ' expanded' : ''}`}>{char.personalityPrompt}</span>
                  {char.personalityPrompt.length > 80 && (
                    <button className="character-card-expand-btn" onClick={() => toggleExpand(`${char.id}-personality`)}>
                      {expandedFields.has(`${char.id}-personality`) ? <><ChevronUp size={10} /> {t('common.collapse')}</> : <><ChevronDown size={10} /> {t('common.expand')}</>}
                    </button>
                  )}
                </div>
              )}
              {char.characterBackground && (
                <div className="character-card-field">
                  <strong>{t('character.background')}</strong>
                  <span className={`character-card-field-text${expandedFields.has(`${char.id}-bg`) ? ' expanded' : ''}`}>{char.characterBackground}</span>
                  {char.characterBackground.length > 80 && (
                    <button className="character-card-expand-btn" onClick={() => toggleExpand(`${char.id}-bg`)}>
                      {expandedFields.has(`${char.id}-bg`) ? <><ChevronUp size={10} /> {t('common.collapse')}</> : <><ChevronDown size={10} /> {t('common.expand')}</>}
                    </button>
                  )}
                </div>
              )}
              {char.voiceId && (
                <div className="character-card-voice">
                  <Volume2 size={10} style={{ color: 'var(--primary-color)' }} />
                  {SYSTEM_VOICES.find(v => v.voiceId === char.voiceId)?.name || char.voiceId}
                </div>
              )}
              <div className="character-card-actions">
                <button className="character-card-action-btn sparkle" onClick={() => handleGenerateCharacterImage(char.id)} disabled={generatingCharId === char.id} title={t('character.generateImage')}>
                  {generatingCharId === char.id ? <RefreshCw size={14} className="spin" /> : <Sparkles size={14} />}
                </button>
                <button className="character-card-action-btn" onClick={() => handleEdit(char.id)} title={t('character.editTitle')}><Pencil size={14} /></button>
                <button className="character-card-action-btn" onClick={() => handleDelete(char.id)} title={t('character.deleteConfirmBtn')}><Trash2 size={14} /></button>
                <button className="character-card-action-btn" title={t('character.copyToSpace')} onClick={() => startCopy(char.id)}><Copy size={14} /></button>
              </div>
              {copyingId === char.id && otherSpaces.length > 0 && (
                <div className="character-card-copy-row">
                  <select className="form-select" style={{ flex: 1, fontSize: '0.75rem', padding: '0.25rem 0.4rem' }}
                    value={copyTargetSpaceId} onChange={e => setCopyTargetSpaceId(e.target.value)}>
                    <option value="">{t('space.selectTarget')}</option>
                    {otherSpaces.map(s => (<option key={s.id} value={s.id}>{s.name}</option>))}
                  </select>
                  <button className="btn btn-primary btn-xs" disabled={!copyTargetSpaceId}
                    onClick={() => handleCopyToSpace(char.id, copyTargetSpaceId)}>✓</button>
                </div>
              )}
            </div>
          </div>
        ))}
        {characters?.length === 0 && !isFormOpen && (
          <div className="glass-panel character-empty">
            <Users size={36} style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }} />
            <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>{t('character.empty')}</p>
            <button className="btn btn-primary btn-sm" onClick={openCreateForm}><Plus size={14} /> {t('character.newBtn')}</button>
          </div>
        )}
      </div>
      {assetPickerState.isOpen && currentSpaceId && (
        <AssetPicker type={assetPickerState.type} spaceId={currentSpaceId} category={assetPickerState.category}
          onSelect={assetPickerState.onSelect!} onClose={closePicker} />
      )}
    </div>
  );
};
