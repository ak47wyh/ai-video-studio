import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Music as MusicIcon, Sparkles, RefreshCw, FileText, Mic2,
  ChevronUp, ChevronDown, ArrowRight, BookmarkPlus, Wand2, CheckCircle2, Send,
} from 'lucide-react';
import { musicLabService, assetLibraryService } from '../../dependencies';
import type {
  MusicModel, MusicGenerationContext, LyricsGenerationContext,
  LyricsGenerationResult, CoverPreprocessResult,
} from '../../domain/ports/OutboundPorts';
import type { ResolvedMusicResult } from '../../domain/services/MusicLabService';
import { useToast } from '../contexts/ToastContext';
import { getErrorMessage } from '../utils/errorUtils';
import { useSpace } from '../contexts/SpaceContext';
import { AssetSaveDialog } from '../components/AssetPicker';
import { LabPageLayout } from '../components/LabPageLayout';
import { AsyncState } from '../components/AsyncState';
import { UnsupportedCapabilityNotice } from '../components/UnsupportedCapabilityNotice';
import { usePlatformCapabilities } from '../hooks/usePlatformCapabilities';
import { usePlatform } from '../contexts/PlatformContext';
import { ApiConfigStore } from '../../adapters/outbound/config/ApiConfigStore';
import { isPlatformReady } from '../utils/platformReady';
import { AudioPreviewPlayer } from '../components/AudioPreviewPlayer';
import { AudioUploadField } from '../components/AudioUploadField';
import { LyricsDisplay } from '../components/LyricsDisplay';
import { TextAreaWithCounter } from '../components/TextAreaWithCounter';
import { InputWithCounter } from '../components/InputWithCounter';
import { SegmentPicker, type SegmentBindField } from '../components/SegmentPicker';
import { TEXT_LIMITS } from '../../domain/constants/textLimits';
import { validateTextLimit } from '../utils/validateTextLimit';

type MusicLabTab = 'compose' | 'lyrics' | 'cover';

interface MusicHistoryItem {
  id: string;
  audioUrl: string;
  prompt: string;
  model: MusicModel;
  lyrics?: string;
  duration: number;
  createdAt: number;
}

// 语义化下载文件名
const buildDownloadFilename = (prompt: string, ext = 'mp3'): string => {
  const prefix = prompt.substring(0, 20).replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');
  return `${prefix || 'ai-music'}_${Date.now()}.${ext}`;
};

export const MusicLab: React.FC = () => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { currentSpaceId } = useSpace();
  const { hasCapability } = usePlatformCapabilities();
  const { activePlatform } = usePlatform();
  const platformReady = isPlatformReady(ApiConfigStore.load(), activePlatform);

  const [activeTab, setActiveTab] = useState<MusicLabTab>('compose');

  // ==================== Compose Tab State ====================
  const [composeModel, setComposeModel] = useState<MusicModel>('music-2.6');
  const [composePrompt, setComposePrompt] = useState('');
  const [composeLyrics, setComposeLyrics] = useState('');
  const [isInstrumental, setIsInstrumental] = useState(false);
  const [lyricsOptimizer, setLyricsOptimizer] = useState(false);
  const [showAdvancedCompose, setShowAdvancedCompose] = useState(false);
  const [sampleRate, setSampleRate] = useState(44100);
  const [bitrate, setBitrate] = useState(256000);
  const [audioFormat, setAudioFormat] = useState('mp3');
  const [isComposing, setIsComposing] = useState(false);
  const [composeResult, setComposeResult] = useState<ResolvedMusicResult | null>(null);
  const [history, setHistory] = useState<MusicHistoryItem[]>([]);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveTarget, setSaveTarget] = useState<MusicHistoryItem | null>(null);

  // ==================== Lyrics Tab State ====================
  const [lyricsMode, setLyricsMode] = useState<'write_full_song' | 'edit'>('write_full_song');
  const [lyricsPrompt, setLyricsPrompt] = useState('');
  const [lyricsInput, setLyricsInput] = useState('');
  const [lyricsTitle, setLyricsTitle] = useState('');
  const [isGeneratingLyrics, setIsGeneratingLyrics] = useState(false);
  const [lyricsResult, setLyricsResult] = useState<LyricsGenerationResult | null>(null);

  // ==================== Cover Tab State ====================
  const [coverAudio, setCoverAudio] = useState<string | null>(null);
  const [isPreprocessing, setIsPreprocessing] = useState(false);
  const [coverPreprocess, setCoverPreprocess] = useState<CoverPreprocessResult | null>(null);
  const [coverLyrics, setCoverLyrics] = useState('');
  const [coverPrompt, setCoverPrompt] = useState('');
  const [coverModel, setCoverModel] = useState<'music-cover' | 'music-cover-free'>('music-cover');
  const [isGeneratingCover, setIsGeneratingCover] = useState(false);
  const [coverResult, setCoverResult] = useState<ResolvedMusicResult | null>(null);

  // ==================== SegmentPicker (发送到分镜) ====================
  const [pickerAsset, setPickerAsset] = useState<{ url: string; field: SegmentBindField; prompt?: string } | null>(null);

  // ==================== Blob URL 内存管理 ====================
  const blobUrlsRef = useRef<Set<string>>(new Set());

  const registerBlobUrl = useCallback((url: string): string => {
    blobUrlsRef.current.add(url);
    return url;
  }, []);

  const revokeBlobUrl = useCallback((url: string) => {
    if (blobUrlsRef.current.has(url)) {
      URL.revokeObjectURL(url);
      blobUrlsRef.current.delete(url);
    }
  }, []);

  // 组件卸载时释放所有 Blob URL
  useEffect(() => {
    const blobs = blobUrlsRef.current;
    return () => {
      blobs.forEach(url => URL.revokeObjectURL(url));
    };
  }, []);

  // ==================== Compose Handlers ====================
  const handleCompose = async () => {
    if (!composePrompt.trim()) return;
    if (!isInstrumental && !composeLyrics.trim()) {
      showToast('error', t('musicLab.lyricsRequired', '请输入歌词或开启纯音乐模式'));
      return;
    }
    if (!validateTextLimit(composePrompt, TEXT_LIMITS.MUSIC_PROMPT_MAX, '音乐描述', showToast)) return;
    if (!isInstrumental && !validateTextLimit(composeLyrics, TEXT_LIMITS.MUSIC_LYRICS_MAX, '歌词', showToast)) return;
    setIsComposing(true);
    if (composeResult) revokeBlobUrl(composeResult.audioUrl);
    setComposeResult(null);
    try {
      const context: MusicGenerationContext = {
        prompt: composePrompt,
        model: composeModel,
        lyrics: isInstrumental ? undefined : composeLyrics,
        isInstrumental,
        lyricsOptimizer,
        audioSetting: { sampleRate, bitrate, format: audioFormat },
      };
      const result = await musicLabService.generateMusic(context);
      const audioUrl = registerBlobUrl(result.audioUrl);
      const resolved: ResolvedMusicResult = { ...result, audioUrl };
      setComposeResult(resolved);

      // 加入历史记录
      const historyItem: MusicHistoryItem = {
        id: `music_${Date.now()}`,
        audioUrl,
        prompt: composePrompt,
        model: composeModel,
        lyrics: isInstrumental ? undefined : composeLyrics,
        duration: result.duration,
        createdAt: Date.now(),
      };
      setHistory(prev => [historyItem, ...prev].slice(0, 10));

      showToast('success', t('musicLab.composeSuccess', '音乐生成成功'));
    } catch (e) {
      showToast('error', getErrorMessage(e, t('musicLab.composeFailed', '音乐生成失败')));
    } finally {
      setIsComposing(false);
    }
  };

  // ==================== Lyrics Handlers ====================
  const handleGenerateLyrics = async () => {
    if (lyricsMode === 'write_full_song' && !lyricsPrompt.trim()) {
      showToast('error', t('musicLab.promptRequired', '请输入歌曲描述'));
      return;
    }
    if (lyricsMode === 'edit' && !lyricsInput.trim()) {
      showToast('error', t('musicLab.lyricsInputRequired', '请输入需要修改的歌词'));
      return;
    }
    setIsGeneratingLyrics(true);
    setLyricsResult(null);
    try {
      const context: LyricsGenerationContext = {
        mode: lyricsMode,
        prompt: lyricsMode === 'write_full_song' ? lyricsPrompt : undefined,
        lyrics: lyricsMode === 'edit' ? lyricsInput : undefined,
        title: lyricsTitle || undefined,
      };
      const result = await musicLabService.generateLyrics(context);
      setLyricsResult(result);
      showToast('success', t('musicLab.lyricsSuccess', '歌词生成成功'));
    } catch (e) {
      showToast('error', getErrorMessage(e, t('musicLab.lyricsFailed', '歌词生成失败')));
    } finally {
      setIsGeneratingLyrics(false);
    }
  };

  // 业务闭环：歌词 → 作曲（跨 Tab 流转）
  const handleUseLyricsForCompose = () => {
    if (!lyricsResult?.lyrics) return;
    setComposeLyrics(lyricsResult.lyrics);
    setIsInstrumental(false);
    if (lyricsResult.songTitle && !composePrompt.trim()) {
      setComposePrompt(`${lyricsResult.songTitle} ${lyricsResult.styleTags}`.trim());
    }
    setActiveTab('compose');
    showToast('success', t('musicLab.lyricsApplied', '歌词已填入作曲 Tab'));
  };

  // ==================== Cover Handlers ====================
  // Step 1: 预处理
  const handlePreprocessCover = async () => {
    if (!coverAudio) {
      showToast('error', t('musicLab.coverAudioRequired', '请先上传参考音频'));
      return;
    }
    setIsPreprocessing(true);
    setCoverPreprocess(null);
    setCoverLyrics('');
    try {
      const result = await musicLabService.preprocessCover(coverAudio);
      setCoverPreprocess(result);
      setCoverLyrics(result.formattedLyrics);
      showToast('success', t('musicLab.preprocessSuccess', '音频预处理完成，可继续生成翻唱'));
    } catch (e) {
      showToast('error', getErrorMessage(e, t('musicLab.preprocessFailed', '音频预处理失败')));
    } finally {
      setIsPreprocessing(false);
    }
  };

  // Step 2: 生成翻唱
  const handleGenerateCover = async () => {
    if (!coverPreprocess?.coverFeatureId) {
      showToast('error', t('musicLab.preprocessFirst', '请先完成音频预处理'));
      return;
    }
    if (!coverLyrics.trim()) {
      showToast('error', t('musicLab.coverLyricsRequired', '请输入或保留歌词'));
      return;
    }
    if (!coverPrompt.trim()) {
      showToast('error', t('musicLab.coverPromptRequired', '请输入翻唱风格描述'));
      return;
    }
    if (!validateTextLimit(coverPrompt, TEXT_LIMITS.MUSIC_COVER_PROMPT_MAX, '翻唱风格描述', showToast)) return;
    if (!validateTextLimit(coverLyrics, TEXT_LIMITS.MUSIC_COVER_LYRICS_MAX, '歌词', showToast)) return;
    setIsGeneratingCover(true);
    if (coverResult) revokeBlobUrl(coverResult.audioUrl);
    setCoverResult(null);
    try {
      const result = await musicLabService.generateCover({
        coverFeatureId: coverPreprocess.coverFeatureId,
        lyrics: coverLyrics,
        prompt: coverPrompt,
        model: coverModel,
        audioSetting: { sampleRate, bitrate, format: audioFormat },
      });
      const audioUrl = registerBlobUrl(result.audioUrl);
      setCoverResult({ ...result, audioUrl });
      showToast('success', t('musicLab.coverSuccess', '翻唱生成成功'));
    } catch (e) {
      showToast('error', getErrorMessage(e, t('musicLab.coverFailed', '翻唱生成失败')));
    } finally {
      setIsGeneratingCover(false);
    }
  };

  // ==================== 下载 ====================
  const handleDownload = useCallback((blobUrl: string, filename: string) => {
    musicLabService.downloadMusic(blobUrl, filename);
    showToast('success', t('common.downloadStart', '开始下载'));
  }, [showToast, t]);

  // ==================== 保存到素材库 ====================
  const handleSaveClick = useCallback((item: MusicHistoryItem) => {
    setSaveTarget(item);
    setShowSaveDialog(true);
  }, []);

  const handleSaveConfirm = async (name: string, tags: string) => {
    if (!saveTarget || !currentSpaceId) return;
    try {
      await assetLibraryService.saveVoiceFromUrl({
        spaceId: currentSpaceId,
        name,
        audioUrl: saveTarget.audioUrl,
        voiceId: saveTarget.model,
        model: saveTarget.model,
        speed: 1,
        sampleText: saveTarget.prompt,
        tags: tags ? tags.split(',').map(tg => tg.trim()).filter(Boolean) : [],
        sourceType: 'lab',
      });
      showToast('success', t('assetLibrary.saveSuccess', '素材保存成功'));
      setShowSaveDialog(false);
      setSaveTarget(null);
    } catch (e) {
      showToast('error', getErrorMessage(e, t('assetLibrary.saveFailed', '素材保存失败')));
    }
  };

  // ==================== Tab 切换时清理资源 ====================
  const handleTabChange = useCallback((tab: MusicLabTab) => {
    // 切换 Tab 时保留生成结果（用户可能想对比），仅清理当前 Tab 的临时状态
    setActiveTab(tab);
  }, []);

  // ==================== Tab 配置 ====================
  const tabs: { key: MusicLabTab; label: string; icon: React.ReactNode; color: string }[] = [
    { key: 'compose', label: t('musicLab.tabCompose', 'AI 作曲'), icon: <MusicIcon size={16} />, color: 'var(--lab-color-music)' },
    { key: 'lyrics', label: t('musicLab.tabLyrics', '歌词创作'), icon: <FileText size={16} />, color: 'var(--lab-color-video)' },
    { key: 'cover', label: t('musicLab.tabCover', '翻唱生成'), icon: <Mic2 size={16} />, color: 'var(--lab-color-image)' },
  ];

  // P1 平台能力前置检测：音乐生成仅部分平台支持，不支持时渲染提示替代页面主体
  if (!hasCapability('music')) {
    return <UnsupportedCapabilityNotice capability="music" />;
  }

  return (
    <LabPageLayout
      icon={<MusicIcon size={32} />}
      iconBg="color-mix(in srgb, var(--lab-color-music) 10%, transparent)"
      iconColor="var(--lab-color-music)"
      title={t('musicLab.title', '音乐实验室 (Music Lab)')}
      subtitle={t('musicLab.desc', 'AI 作曲、歌词创作、翻唱生成，支持多模型与音频参数调节')}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={(key) => handleTabChange(key as MusicLabTab)}
    >

      {/* ==================== Compose Tab ==================== */}
      {activeTab === 'compose' && (
        <div className="glass-panel slide-up lab-tab-panel">
          {/* 歌曲描述 */}
          <div>
            <label className="form-label">{t('musicLab.prompt', '歌曲描述 (Prompt)')}</label>
            <TextAreaWithCounter
              className="form-input lab-textarea-compact"
              rows={3}
              placeholder={t('musicLab.promptPlaceholder', '描述你想要的音乐风格、情绪、场景，例如：轻快的电子流行曲，夏日海滩氛围...')}
              value={composePrompt}
              onChange={e => setComposePrompt(e.target.value)}
              maxLength={TEXT_LIMITS.MUSIC_PROMPT_MAX}
            />
          </div>

          {/* 歌词 */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <label className="form-label" style={{ marginBottom: 0 }}>{t('musicLab.lyrics', '歌词')}</label>
              <label className="lab-checkbox-label">
                <input
                  type="checkbox"
                  checked={isInstrumental}
                  onChange={e => setIsInstrumental(e.target.checked)}
                  style={{ width: '14px', height: '14px', accentColor: 'var(--lab-color-music)' }}
                />
                {t('musicLab.instrumental', '纯音乐（无歌词）')}
              </label>
            </div>
            <TextAreaWithCounter
              className="form-input lab-textarea-compact"
              rows={6}
              placeholder={isInstrumental
                ? t('musicLab.instrumentalHint', '已开启纯音乐模式，无需填写歌词')
                : t('musicLab.lyricsPlaceholder', '输入歌词，支持结构标签如 [Verse] [Chorus] [Bridge]...')}
              value={isInstrumental ? '' : composeLyrics}
              onChange={e => setComposeLyrics(e.target.value)}
              disabled={isInstrumental}
              style={{ opacity: isInstrumental ? 0.5 : 1 }}
              maxLength={TEXT_LIMITS.MUSIC_LYRICS_MAX}
            />
          </div>

          {/* 模型 + 歌词优化 */}
          <div className="lab-model-config">
            <div className="lab-model-config-item" style={{ minWidth: '200px' }}>
              <label className="form-label">{t('musicLab.model', '生成模型')}</label>
              <select className="form-select" value={composeModel} onChange={e => setComposeModel(e.target.value as MusicModel)}>
                <option value="music-2.6">music-2.6 (推荐，高质量)</option>
                <option value="music-2.6-free">music-2.6-free (免费档)</option>
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: '0.5rem' }}>
              <label className="lab-checkbox-label">
                <input
                  type="checkbox"
                  checked={lyricsOptimizer}
                  onChange={e => setLyricsOptimizer(e.target.checked)}
                  disabled={isInstrumental}
                  style={{ width: '16px', height: '16px', accentColor: 'var(--lab-color-music)' }}
                />
                {t('musicLab.lyricsOptimizer', '歌词智能优化')}
              </label>
            </div>
          </div>

          {/* 高级设置 */}
          <div>
            <button className="advanced-toggle" onClick={() => setShowAdvancedCompose(!showAdvancedCompose)}>
              <span className="advanced-toggle-icon">
                {showAdvancedCompose ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </span>
              <span>{t('musicLab.advanced', '高级设置')}</span>
            </button>
            {showAdvancedCompose && (
              <div className="advanced-content">
                <div style={{ flex: 1, minWidth: '150px' }}>
                  <label className="form-label">{t('musicLab.sampleRate', '采样率')}</label>
                  <select className="form-select" value={sampleRate} onChange={e => setSampleRate(Number(e.target.value))}>
                    <option value={16000}>16000</option>
                    <option value={24000}>24000</option>
                    <option value={44100}>44100 (CD 音质)</option>
                    <option value={48000}>48000</option>
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: '150px' }}>
                  <label className="form-label">{t('musicLab.bitrate', '比特率')}</label>
                  <select className="form-select" value={bitrate} onChange={e => setBitrate(Number(e.target.value))}>
                    <option value={128000}>128 kbps</option>
                    <option value={192000}>192 kbps</option>
                    <option value={256000}>256 kbps (推荐)</option>
                    <option value={320000}>320 kbps</option>
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: '120px' }}>
                  <label className="form-label">{t('musicLab.audioFormat', '音频格式')}</label>
                  <select className="form-select" value={audioFormat} onChange={e => setAudioFormat(e.target.value)}>
                    <option value="mp3">MP3</option>
                    <option value="wav">WAV</option>
                    <option value="flac">FLAC</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* 生成按钮 */}
          <button
            className="btn btn-primary btn-generate"
            style={{ background: '#8b5cf6' }}
            disabled={!composePrompt.trim() || (!isInstrumental && !composeLyrics.trim()) || isComposing || !platformReady}
            onClick={handleCompose}
          >
            {isComposing ? <RefreshCw className="spin" size={20} /> : <Sparkles size={20} />}
            {isComposing ? t('musicLab.composing', '正在生成音乐...') : t('musicLab.composeBtn', '立即生成音乐')}
          </button>

          {/* 生成结果 */}
          {composeResult && (
            <div className="lab-result-card" style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.3)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <CheckCircle2 size={16} style={{ color: 'var(--lab-color-music)' }} />
                <span style={{ color: 'var(--lab-color-music)', fontWeight: 600 }}>{t('musicLab.composeSuccess', '音乐生成成功')}</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                  {Math.round(composeResult.duration / 1000)}s · {composeResult.sampleRate}Hz · {Math.round(composeResult.bitrate / 1000)}kbps
                </span>
              </div>
              <AudioPreviewPlayer
                key={composeResult.audioUrl}
                src={composeResult.audioUrl}
                autoPlay
                accentColor="#8b5cf6"
                downloadFilename={buildDownloadFilename(composePrompt, audioFormat)}
                onDownload={handleDownload}
              />
              <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setPickerAsset({ url: composeResult.audioUrl, field: 'bgm', prompt: composePrompt })}
                >
                  <Send size={12} /> {t('segmentPicker.sendToSegment', '发送到分镜')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================== Lyrics Tab ==================== */}
      {activeTab === 'lyrics' && (
        <div className="glass-panel slide-up lab-tab-panel">
          {/* 模式选择 */}
          <div>
            <label className="form-label">{t('musicLab.lyricsMode', '创作模式')}</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                className={`btn btn-sm ${lyricsMode === 'write_full_song' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: 1, background: lyricsMode === 'write_full_song' ? 'var(--lab-color-image)' : undefined }}
                onClick={() => setLyricsMode('write_full_song')}
              >
                <Wand2 size={14} /> {t('musicLab.modeWriteFull', '全新创作')}
              </button>
              <button
                className={`btn btn-sm ${lyricsMode === 'edit' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: 1, background: lyricsMode === 'edit' ? 'var(--lab-color-image)' : undefined }}
                onClick={() => setLyricsMode('edit')}
              >
                <FileText size={14} /> {t('musicLab.modeEdit', '润色修改')}
              </button>
            </div>
          </div>

          {/* 歌曲标题 */}
          <div>
            <label className="form-label">{t('musicLab.songTitle', '歌曲标题（可选）')}</label>
            <InputWithCounter
              type="text"
              className="form-input"
              placeholder={t('musicLab.songTitlePlaceholder', '给这首歌起个名字')}
              value={lyricsTitle}
              onChange={e => setLyricsTitle(e.target.value)}
              maxLength={TEXT_LIMITS.SONG_TITLE_MAX}
            />
          </div>

          {/* 描述 / 现有歌词 */}
          {lyricsMode === 'write_full_song' ? (
            <div>
              <label className="form-label">{t('musicLab.lyricsPrompt', '歌曲描述')}</label>
              <TextAreaWithCounter
                className="form-input lab-textarea-compact"
                rows={4}
                placeholder={t('musicLab.lyricsPromptPlaceholder', '描述你想要的歌曲主题、风格、情绪，例如：一首关于夏日告别的抒情流行歌...')}
                value={lyricsPrompt}
                onChange={e => setLyricsPrompt(e.target.value)}
                maxLength={TEXT_LIMITS.MUSIC_LYRICS_PROMPT_MAX}
              />
            </div>
          ) : (
            <div>
              <label className="form-label">{t('musicLab.lyricsInput', '需要修改的歌词')}</label>
              <TextAreaWithCounter
                className="form-input lab-textarea-compact"
                rows={8}
                placeholder={t('musicLab.lyricsInputPlaceholder', '粘贴你已有的歌词，AI 将帮你润色修改...')}
                value={lyricsInput}
                onChange={e => setLyricsInput(e.target.value)}
                maxLength={TEXT_LIMITS.MUSIC_LYRICS_INPUT_MAX}
              />
            </div>
          )}

          {/* 生成按钮 */}
          <button
            className="btn btn-primary btn-generate"
            style={{ background: '#3b82f6' }}
            disabled={(lyricsMode === 'write_full_song' && !lyricsPrompt.trim()) || (lyricsMode === 'edit' && !lyricsInput.trim()) || isGeneratingLyrics || !platformReady}
            onClick={handleGenerateLyrics}
          >
            {isGeneratingLyrics ? <RefreshCw className="spin" size={20} /> : <FileText size={20} />}
            {isGeneratingLyrics ? t('musicLab.generatingLyrics', '正在创作歌词...') : t('musicLab.generateLyricsBtn', '生成歌词')}
          </button>

          {/* 歌词结果 */}
          {lyricsResult && (
            <div className="lab-result-card" style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)' }}>
              <div style={{ marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                  <CheckCircle2 size={16} style={{ color: '#60a5fa' }} />
                  <span style={{ color: '#60a5fa', fontWeight: 600 }}>{t('musicLab.lyricsSuccess', '歌词生成成功')}</span>
                </div>
                {lyricsResult.songTitle && (
                  <p style={{ margin: '0.25rem 0', fontSize: '0.95rem' }}>
                    <strong>{t('musicLab.songTitle', '标题')}:</strong> {lyricsResult.songTitle}
                  </p>
                )}
                {lyricsResult.styleTags && (
                  <p style={{ margin: '0.25rem 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    <strong>{t('musicLab.styleTags', '风格')}:</strong> {lyricsResult.styleTags}
                  </p>
                )}
              </div>
              <LyricsDisplay lyrics={lyricsResult.lyrics} />
              <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  className="btn btn-sm"
                  style={{ background: '#8b5cf6', color: '#fff' }}
                  onClick={handleUseLyricsForCompose}
                >
                  <ArrowRight size={14} /> {t('musicLab.useForCompose', '用作作曲歌词')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================== Cover Tab ==================== */}
      {activeTab === 'cover' && (
        <div className="glass-panel slide-up lab-tab-panel">
          {/* Step 1: 上传参考音频 */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <span className="lab-step-indicator" style={{ background: coverPreprocess ? 'var(--color-success)' : 'var(--lab-color-voice)' }}>{coverPreprocess ? '✓' : '1'}</span>
              <h3 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-color)' }}>
                {t('musicLab.coverStep1', 'Step 1: 上传参考音频并预处理')}
              </h3>
            </div>
            <AudioUploadField
              label={t('musicLab.referenceAudio', '参考音频（必填，6s-6min）')}
              value={coverAudio}
              onChange={(v) => { setCoverAudio(v); setCoverPreprocess(null); setCoverLyrics(''); }}
              borderColor="rgba(236,72,153,0.3)"
              bgColor="rgba(236,72,153,0.05)"
              placeholder={t('musicLab.coverAudioPlaceholder', '上传参考音频 (MP3/WAV/FLAC, <50MB, 6s-6min)')}
            />
            <button
              className="btn btn-primary btn-sm"
              style={{ marginTop: '0.5rem', background: 'var(--lab-color-voice)' }}
              disabled={!coverAudio || isPreprocessing || !platformReady}
              onClick={handlePreprocessCover}
            >
              {isPreprocessing ? <RefreshCw className="spin" size={18} /> : <Mic2 size={18} />}
              {isPreprocessing ? t('musicLab.preprocessing', '正在预处理...') : t('musicLab.preprocessBtn', '开始预处理')}
            </button>
          </div>

          {/* 预处理结果 */}
          {coverPreprocess && (
            <div className="lab-result-card" style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <CheckCircle2 size={16} style={{ color: 'var(--color-success)' }} />
                <span style={{ color: 'var(--color-success)', fontWeight: 600 }}>{t('musicLab.preprocessSuccess', '预处理完成')}</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                  {t('musicLab.audioDuration', '时长')}: {Math.round(coverPreprocess.audioDuration)}s
                </span>
              </div>
              <p style={{ margin: '0.25rem 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {t('musicLab.coverFeatureId', '特征 ID')}: <code style={{ fontSize: '0.7rem' }}>{coverPreprocess.coverFeatureId.substring(0, 32)}...</code>
              </p>
            </div>
          )}

          {/* Step 2: 生成翻唱 */}
          {coverPreprocess && (
            <div style={{ borderTop: '1px dashed var(--border-color)', paddingTop: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <span className="lab-step-indicator" style={{ background: coverResult ? 'var(--color-success)' : 'var(--lab-color-music)' }}>{coverResult ? '✓' : '2'}</span>
                <h3 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-color)' }}>
                  {t('musicLab.coverStep2', 'Step 2: 编辑歌词并生成翻唱')}
                </h3>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {/* 翻唱风格 */}
                <div>
                  <label className="form-label">{t('musicLab.coverPrompt', '翻唱风格描述')}</label>
                  <TextAreaWithCounter
                    className="form-input lab-textarea-compact"
                    rows={2}
                    placeholder={t('musicLab.coverPromptPlaceholder', '描述翻唱风格，例如：用爵士风格重新演绎，节奏放缓，加入钢琴伴奏...')}
                    value={coverPrompt}
                    onChange={e => setCoverPrompt(e.target.value)}
                    maxLength={TEXT_LIMITS.MUSIC_COVER_PROMPT_MAX}
                  />
                </div>

                {/* 歌词（可编辑预处理结果） */}
                <div>
                  <label className="form-label">{t('musicLab.coverLyrics', '歌词（可编辑预处理结果）')}</label>
                  <TextAreaWithCounter
                    className="form-input lab-textarea-compact"
                    rows={8}
                    placeholder={t('musicLab.coverLyricsPlaceholder', '歌词将自动从预处理结果填入，可按需修改...')}
                    value={coverLyrics}
                    onChange={e => setCoverLyrics(e.target.value)}
                    style={{ fontFamily: 'monospace' }}
                    maxLength={TEXT_LIMITS.MUSIC_COVER_LYRICS_MAX}
                  />
                </div>

                {/* 模型选择 */}
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: '200px' }}>
                    <label className="form-label">{t('musicLab.coverModel', '翻唱模型')}</label>
                    <select className="form-select" value={coverModel} onChange={e => setCoverModel(e.target.value as 'music-cover' | 'music-cover-free')}>
                      <option value="music-cover">music-cover (高质量)</option>
                      <option value="music-cover-free">music-cover-free (免费档)</option>
                    </select>
                  </div>
                </div>

                <button
                  className="btn btn-primary btn-generate"
                  style={{ background: 'var(--lab-color-music)' }}
            disabled={!coverPrompt.trim() || !coverLyrics.trim() || isGeneratingCover || !platformReady}
                  onClick={handleGenerateCover}
                >
                  {isGeneratingCover ? <RefreshCw className="spin" size={20} /> : <Mic2 size={20} />}
                  {isGeneratingCover ? t('musicLab.generatingCover', '正在生成翻唱...') : t('musicLab.generateCoverBtn', '生成翻唱')}
                </button>
              </div>

              {/* 翻唱结果 */}
              {coverResult && (
                <div className="lab-result-card" style={{ marginTop: '0.75rem', background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.3)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    <CheckCircle2 size={16} style={{ color: 'var(--lab-color-music)' }} />
                <span style={{ color: 'var(--lab-color-music)', fontWeight: 600 }}>{t('musicLab.coverSuccess', '翻唱生成成功')}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                      {Math.round(coverResult.duration / 1000)}s · {coverResult.sampleRate}Hz
                    </span>
                  </div>
                  <AudioPreviewPlayer
                    key={coverResult.audioUrl}
                    src={coverResult.audioUrl}
                autoPlay
                accentColor="var(--lab-color-music)"
                downloadFilename={buildDownloadFilename(coverPrompt, audioFormat)}
                    onDownload={handleDownload}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ==================== 历史记录（仅 Compose Tab 显示） ==================== */}
      {activeTab === 'compose' && (
        history.length === 0 ? (
          <AsyncState empty emptyText="尚未生成音乐" />
        ) : (
          <div className="glass-panel slide-up" style={{ marginTop: '0.75rem', padding: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <h3 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-muted)' }}>{t('musicLab.history', '生成历史')} ({history.length})</h3>
              <button
                className="btn btn-secondary btn-xs"
                onClick={() => {
                  history.forEach(h => revokeBlobUrl(h.audioUrl));
                  setHistory([]);
                }}
              >{t('common.clear', '清空')}</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {history.map(item => (
                <div key={item.id} style={{ padding: '0.6rem', background: 'rgba(0,0,0,0.15)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.prompt}
                    </span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{item.model}</span>
                  </div>
                  <AudioPreviewPlayer
                    key={item.audioUrl}
                    src={item.audioUrl}
                    compact
                    accentColor="var(--lab-color-music)"
                    showWaveform={false}
                    downloadFilename={buildDownloadFilename(item.prompt, audioFormat)}
                    onDownload={handleDownload}
                  />
                  <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
                    <button
                      className="btn btn-secondary btn-xs"
                      onClick={() => handleSaveClick(item)}
                    >
                      <BookmarkPlus size={12} /> {t('assetLibrary.saveBtn', '保存到素材库')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      )}

      {/* ==================== 保存对话框 ==================== */}
      {showSaveDialog && saveTarget && (
        <AssetSaveDialog
          title={t('assetLibrary.saveBtn', '保存到素材库')}
          defaultName={saveTarget.prompt.slice(0, 20) + (saveTarget.prompt.length > 20 ? '...' : '')}
          onSave={handleSaveConfirm}
          onCancel={() => { setShowSaveDialog(false); setSaveTarget(null); }}
        />
      )}
      <SegmentPicker
        isOpen={!!pickerAsset}
        assetUrl={pickerAsset?.url ?? ''}
        bindField={pickerAsset?.field ?? 'image'}
        assetPrompt={pickerAsset?.prompt}
        onClose={() => setPickerAsset(null)}
      />
    </LabPageLayout>
  );
};
