import React from 'react';
import { useTranslation } from 'react-i18next';
import { Play, RefreshCw, Users, Download, Volume2, Music, Trash2, ChevronDown, ChevronUp, Image as ImageIcon, FileText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { StorySegment, Character, VideoTask, Background } from '../../domain/entities/models';
import { BGMPanel } from './BGMPanel';
import { AssetPicker } from './AssetPicker';
import { useAssetPicker } from '../hooks/useAssetPicker';
import { useSpace } from '../contexts/SpaceContext';
import { InputWithCounter } from './InputWithCounter';
import { TEXT_LIMITS } from '../../domain/constants/textLimits';

interface SegmentCardProps {
  segment: StorySegment;
  index: number;
  task: VideoTask | undefined;
  characterMap: Map<string, Character>;
  backgrounds: Background[] | undefined;
  narrationStatus: string | undefined;
  narrationUrl: string | undefined;
  isBGMEditing: boolean;
  bgmPrompt: string;
  bgmMode: 'instrumental' | 'autoLyrics' | 'customLyrics' | 'cover';
  bgmLyrics: string;
  bgmModel: 'music-2.6' | 'music-2.6-free' | 'music-cover' | 'music-cover-free';
  bgmCoverAudioUrl: string;
  isGeneratingBGM: boolean;
  isGeneratingLyrics: boolean;
  suggestingBGMStyle: boolean;
  onSelectBackground: (segmentId: string, bgId: string) => Promise<void>;
  onGenerateVideo: (segmentId: string) => Promise<void>;
  onGenerateNarration: (segmentId: string, content: string, characterIds: string[]) => Promise<void>;
  onRemoveBGM: (segmentId: string) => Promise<void>;
  onBGMEditStart: () => void;
  onBGMEditCancel: () => void;
  onBgmPromptChange: (value: string) => void;
  onBgmModeChange: (mode: 'instrumental' | 'autoLyrics' | 'customLyrics' | 'cover') => void;
  onBgmModelChange: (model: 'music-2.6' | 'music-2.6-free' | 'music-cover' | 'music-cover-free') => void;
  onBgmLyricsChange: (lyrics: string) => void;
  onBgmCoverAudioUrlChange: (url: string) => void;
  onGenerateBGM: () => void;
  onGenerateLyrics: () => void;
  onSuggestBGMStyle: (segmentContent: string) => Promise<void>;
  onUpdateActionContent?: (segmentId: string, content: string) => void;
  onUpdateFirstFrameImage?: (segmentId: string, imageUrl: string) => void;
  onPickImage?: () => void;
  onPickNarrationPrompt?: () => void;
}

const getStatusColor = (status: VideoTask['status']) => {
  switch (status) {
    case 'SUCCESS': return 'var(--color-success)';
    case 'FAILED': return 'var(--color-danger)';
    case 'PROCESSING': return 'var(--color-warning)';
    case 'PENDING': return 'var(--text-muted)';
  }
};

const getStatusLabel = (status: VideoTask['status'], t: (key: string) => string) => {
  switch (status) {
    case 'SUCCESS': return t('workbench.statusSuccess');
    case 'FAILED': return t('workbench.statusFailed');
    case 'PROCESSING': return t('workbench.statusProcessing');
    case 'PENDING': return t('workbench.statusPending');
  }
};

export const SegmentCard: React.FC<SegmentCardProps> = React.memo(({
  // Phase 4 性能优化：包裹 React.memo 后，仅当本 segment 的 props 真正变化时才会重渲染
  // 父组件 StoryWorkbench 已对共享回调做 useCallback 稳定化
  segment, index, task, characterMap, backgrounds,
  narrationStatus, narrationUrl,
  isBGMEditing, bgmPrompt, bgmMode, bgmLyrics, bgmModel, bgmCoverAudioUrl,
  isGeneratingBGM, isGeneratingLyrics, suggestingBGMStyle,
  onSelectBackground, onGenerateVideo, onGenerateNarration, onRemoveBGM,
  onBGMEditStart, onBGMEditCancel,
  onBgmPromptChange, onBgmModeChange, onBgmModelChange,
  onBgmLyricsChange, onBgmCoverAudioUrlChange,
  onGenerateBGM, onGenerateLyrics, onSuggestBGMStyle,
  onUpdateActionContent, onUpdateFirstFrameImage,
  onPickImage, onPickNarrationPrompt,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { currentSpaceId } = useSpace();
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const { state: assetPickerState, closePicker } = useAssetPicker();

  const mentionedCharNames = segment.mentionedCharacters
    .map(id => characterMap.get(id)?.name)
    .filter((name): name is string => !!name);

  return (
    <div className="glass-panel segment-card">
      <div className="segment-index">
        <span className="segment-index-num">#{index + 1}</span>
      </div>
      <div className="segment-body">
        <p className="segment-content">{segment.content}</p>

        {mentionedCharNames.length > 0 && (
          <div className="segment-characters">
            {mentionedCharNames.map(name => (
              <span key={name} className="segment-character-chip" onClick={() => navigate('/characters')} title={t('workbench.goCharacters')}>
                <Users size={12} /> {name}
              </span>
            ))}
          </div>
        )}

        <div className="segment-actions">
          <select className="form-select" style={{ width: '160px', fontSize: '0.8rem', padding: '0.35rem 0.5rem' }}
            value={segment.selectedBackgroundId || ''}
            onChange={(e) => onSelectBackground(segment.id, e.target.value)}>
            <option value="">{t('workbench.selectBg')}</option>
            {backgrounds?.map(bg => (
              <option key={bg.id} value={bg.id}>{bg.name}</option>
            ))}
          </select>

          <button
            className="btn btn-primary btn-sm"
            disabled={!segment.selectedBackgroundId || task?.status === 'PROCESSING' || task?.status === 'PENDING'}
            onClick={() => onGenerateVideo(segment.id)}
          >
            <Play size={14} />
            {task?.status === 'PROCESSING' || task?.status === 'PENDING'
              ? t('workbench.generating')
              : t('workbench.generateBtn')}
          </button>

          {task?.status === 'FAILED' && (
            <button className="btn btn-secondary btn-sm" disabled={!segment.selectedBackgroundId}
              onClick={() => onGenerateVideo(segment.id)}>
              <RefreshCw size={12} /> {t('workbench.retryBtn')}
            </button>
          )}

          {task && (
            <div className="segment-status" style={{ color: getStatusColor(task.status) }}>
              <span className={`segment-status-dot${task.status === 'PROCESSING' || task.status === 'PENDING' ? ' segment-status-dot-pulse' : ''}`} style={{ background: getStatusColor(task.status) }} />
              {getStatusLabel(task.status, t)}
            </div>
          )}
        </div>

        {/* Advanced Options Toggle */}
        <div className="segment-advanced">
          <button
            className="advanced-toggle"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            <span className="advanced-toggle-icon">
              {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </span>
            <span>{t('workbench.advancedOptions', '高级选项 (运镜与参考图)')}</span>
          </button>

          {showAdvanced && (
            <div className="segment-advanced-content">
              <div className="segment-advanced-field">
                <label>
                  {t('workbench.actionContent', '运镜与动作提示词 (Action / Camera)')}
                </label>
                <InputWithCounter
                  maxLength={TEXT_LIMITS.SEGMENT_ACTION_MAX}
                  type="text"
                  className="form-input"
                  placeholder={t('workbench.actionContentPlaceholder', '例如：向左平移，特写镜头')}
                  value={segment.actionContent || ''}
                  onChange={(e) => onUpdateActionContent?.(segment.id, e.target.value)}
                  style={{ width: '100%', fontSize: '0.85rem', padding: '0.5rem' }}
                />
              </div>
              <div className="segment-advanced-field">
                <label>
                  <ImageIcon size={14} /> {t('workbench.firstFrameImage', '视频参考图 (首帧/尾帧 URL)')}
                </label>
                <InputWithCounter
                  maxLength={TEXT_LIMITS.URL_MAX}
                  type="text"
                  className="form-input"
                  placeholder={t('workbench.firstFrameImagePlaceholder', '输入图片链接 (可选)')}
                  value={segment.firstFrameImage || ''}
                  onChange={(e) => onUpdateFirstFrameImage?.(segment.id, e.target.value)}
                  style={{ width: '100%', fontSize: '0.85rem', padding: '0.5rem' }}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-xs"
                  style={{ marginTop: '0.3rem' }}
                  onClick={() => onPickImage?.()}
                >
                  <ImageIcon size={12} /> {t('assetLibrary.pickerTitle', '从素材库选择').replace('{{type}}', t('assetLibrary.typeImage', '图片'))}
                </button>
              </div>
            </div>
          )}
        </div>

        {task?.status === 'FAILED' && task.errorMessage && (
          <p className="segment-error">
            {task.errorMessage}
          </p>
        )}

        {task?.status === 'SUCCESS' && task.videoUrl && (
          <div className="segment-video-result">
            <video src={task.videoUrl} controls />
            <a href={task.videoUrl} download target="_blank" rel="noopener noreferrer"
              className="segment-video-download">
              <Download size={14} /> {t('workbench.downloadVideo')}
            </a>
          </div>
        )}

        <div className="segment-narration">
          <button className="btn btn-secondary btn-xs"
            disabled={narrationStatus === 'running'}
            onClick={() => onGenerateNarration(segment.id, segment.content, segment.mentionedCharacters)}>
            {narrationStatus === 'running' ? <RefreshCw size={12} className="spin" /> : <Volume2 size={12} />}
            {narrationStatus === 'running' ? t('character.generatingNarration') : t('character.generateNarration')}
          </button>
          {onPickNarrationPrompt && (
            <button className="btn btn-secondary btn-xs"
              onClick={() => onPickNarrationPrompt()}>
              <FileText size={12} /> {t('assetLibrary.pickerTitle', '从素材库选择提示词').replace('{{type}}', t('assetLibrary.typePrompt', '提示词'))}
            </button>
          )}
        </div>
        {narrationUrl && (
          <audio controls src={narrationUrl} style={{ width: '100%', height: '28px', marginTop: '0.25rem' }} />
        )}

        <div className="segment-bgm">
          <div className="segment-bgm-header">
            <Music size={14} className="segment-bgm-header-icon" />
            <span className="segment-bgm-header-text">{t('music.title')}</span>
          </div>

          {segment.bgmAudioUrl ? (
            <div>
              <audio controls src={segment.bgmAudioUrl} style={{ width: '100%', height: '28px' }} />
              {segment.bgmPrompt && (
                <span className="segment-bgm-info">
                  {segment.bgmIsInstrumental ? '\uD83C\uDFB5' : '\uD83C\uDFA4'} {segment.bgmPrompt}
                </span>
              )}
              <button className="btn btn-secondary btn-xs" style={{ marginTop: '0.3rem', color: 'var(--color-danger)' }}
                onClick={() => onRemoveBGM(segment.id)}>
                <Trash2 size={12} /> {t('music.removeBGMBtn')}
              </button>
            </div>
          ) : isBGMEditing ? (
            <BGMPanel
              bgmPrompt={bgmPrompt}
              bgmMode={bgmMode}
              bgmLyrics={bgmLyrics}
              bgmModel={bgmModel}
              bgmCoverAudioUrl={bgmCoverAudioUrl}
              isGeneratingBGM={isGeneratingBGM}
              isGeneratingLyrics={isGeneratingLyrics}
              suggestingBGMStyle={suggestingBGMStyle}
              onBgmPromptChange={onBgmPromptChange}
              onBgmModeChange={onBgmModeChange}
              onBgmModelChange={onBgmModelChange}
              onBgmLyricsChange={onBgmLyricsChange}
              onBgmCoverAudioUrlChange={onBgmCoverAudioUrlChange}
              onGenerateBGM={onGenerateBGM}
              onGenerateLyrics={onGenerateLyrics}
              onSuggestStyle={() => onSuggestBGMStyle(segment.content)}
              onCancel={onBGMEditCancel}
            />
          ) : (
            <button className="btn btn-secondary btn-sm"
              onClick={onBGMEditStart}>
              <Music size={14} /> {t('music.generateBGM')}
            </button>
          )}
        </div>
      </div>
      {assetPickerState.isOpen && currentSpaceId && (
        <AssetPicker
          type={assetPickerState.type}
          spaceId={currentSpaceId}
          category={assetPickerState.category}
          onSelect={assetPickerState.onSelect!}
          onClose={closePicker}
        />
      )}
    </div>
  );
});

SegmentCard.displayName = 'SegmentCard';
