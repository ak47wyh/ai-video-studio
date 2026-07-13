import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Film, Sparkles, Pencil, RefreshCw, ArrowRight, Check, X,
  Music, Volume2, ChevronRight, Loader,
} from 'lucide-react';
import { useStoryFilm } from '../hooks/useStoryFilm';
import { VIDEO_STYLE_PRESETS } from '../../domain/data/stylePresets';
import { useSpace } from '../contexts/SpaceContext';
import { usePlatformCapabilities } from '../hooks/usePlatformCapabilities';
import { useConfirm } from '../contexts/ConfirmContext';
import { AsyncState } from '../components/AsyncState';
import { LabPageLayout } from '../components/LabPageLayout';
import type { VideoStyle, PipelineTask } from '../../domain/entities/models';
import type { VoiceInfo, VoiceListResult } from '../../domain/ports/OutboundPorts';
import { voiceService, pipelineService } from '../../dependencies';

/** 管线阶段显示配置 */
const PIPELINE_STAGES: { key: string; i18nKey: string; fallback: string }[] = [
  { key: 'splitting', i18nKey: 'storyFilm.stageSplitting', fallback: '智能拆分' },
  { key: 'generating_images', i18nKey: 'storyFilm.stageImages', fallback: '生成画面' },
  { key: 'generating_audio', i18nKey: 'storyFilm.stageAudio', fallback: '生成旁白' },
  { key: 'generating_bgm', i18nKey: 'storyFilm.stageBgm', fallback: '生成配乐' },
  { key: 'generating_videos', i18nKey: 'storyFilm.stageVideos', fallback: '生成视频' },
  { key: 'post_processing', i18nKey: 'storyFilm.stagePostProcess', fallback: '后期合成' },
  { key: 'generating_srt', i18nKey: 'storyFilm.stageSrt', fallback: '生成字幕' },
  { key: 'burning_subtitles', i18nKey: 'storyFilm.stageBurnSubs', fallback: '烧录字幕' },
];

/** StoryFilmPage —— AI 故事成片页面（三步向导：配置 → 生成 → 预览） */
export const StoryFilmPage: React.FC = () => {
  const { t } = useTranslation();
  const { currentSpaceId } = useSpace();
  const { hasCapability } = usePlatformCapabilities();
  const navigate = useNavigate();
  const location = useLocation();
  const { confirm } = useConfirm();

  const {
    step, progress, result, isGeneratingText, generatedText,
    startFilm, generateText, cancelFilm, resetFilm,
  } = useStoryFilm();

  // ===== 配置状态 =====
  // Phase 6 闭环修复：消费 Dashboard 透传的 location.state.theme
  const initialTheme = ((): string => {
    const state = location.state as { theme?: string } | null;
    return typeof state?.theme === 'string' ? state.theme : '';
  })();
  const [storyText, setStoryText] = useState('');
  /** 输入模式：ai 生成 / 手动粘贴 */
  const [inputMode, setInputMode] = useState<'ai' | 'paste'>('ai');
  const [theme, setTheme] = useState(initialTheme);
  const [keyPointsText, setKeyPointsText] = useState('');
  const [selectedStyle, setSelectedStyle] = useState<VideoStyle>('cinematic');
  const [voiceId, setVoiceId] = useState('');
  const [includeBGM, setIncludeBGM] = useState(true);
  const [includeSubtitles, setIncludeSubtitles] = useState(true);
  const [videoDuration, setVideoDuration] = useState<6 | 10>(6);

  // ===== 音色列表 =====
  const [voiceList, setVoiceList] = useState<VoiceListResult | null>(null);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [voicesLoaded, setVoicesLoaded] = useState(false);
  const [pipelineTask, setPipelineTask] = useState<PipelineTask | null>(null);

  // 首次进入 config 步骤时加载音色
  useEffect(() => {
    if (step !== 'config' || voicesLoaded) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 加载态标记，异步回调中更新
    setIsLoadingVoices(true);
    voiceService.getAvailableVoices('all')
      .then(result => { if (!cancelled) { setVoiceList(result); setVoicesLoaded(true); } })
      .catch(() => { if (!cancelled) { setVoiceList(null); setVoicesLoaded(true); } })
      .finally(() => { if (!cancelled) setIsLoadingVoices(false); });
    return () => { cancelled = true; };
  }, [step, voicesLoaded]);

  // 加载管线任务以获取最终视频 URL
  useEffect(() => {
    if (result?.pipelineTaskId) {
      const task = pipelineService.getTask(result.pipelineTaskId);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 同步读取，非异步回调
      setPipelineTask(task);
    }
  }, [result]);

  const allVoices: VoiceInfo[] = [
    ...(voiceList?.systemVoices ?? []),
    ...(voiceList?.clonedVoices ?? []),
    ...(voiceList?.designedVoices ?? []),
  ];

  // ===== AI 生成文案 =====
  const handleGenerateText = useCallback(async () => {
    if (!theme.trim()) return;
    const keyPoints = keyPointsText
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);
    try {
      const text = await generateText(theme, keyPoints);
      setStoryText(text);
    } catch {
      // 错误已在 hook 内 showToast
    }
  }, [theme, keyPointsText, generateText]);

  // ===== 开始创作 =====
  const handleStartFilm = useCallback(async () => {
    if (!currentSpaceId) return;
    if (inputMode === 'ai' && !generatedText && !storyText) return;
    if (inputMode === 'paste' && !storyText.trim()) return;
    await startFilm({
      storyText: inputMode === 'ai' ? (generatedText || storyText) : storyText,
      theme: inputMode === 'ai' ? theme : undefined,
      keyPoints: inputMode === 'ai'
        ? keyPointsText.split('\n').map(s => s.trim()).filter(Boolean)
        : undefined,
      videoStyle: selectedStyle,
      voiceId: voiceId || undefined,
      videoDuration,
      includeBGM,
      includeSubtitles,
      spaceId: currentSpaceId,
      title: theme || storyText.slice(0, 50),
    });
  }, [currentSpaceId, inputMode, generatedText, storyText, theme, keyPointsText,
    selectedStyle, voiceId, videoDuration, includeBGM, includeSubtitles, startFilm]);

  // ===== 获取阶段状态 =====
  const getStageStatus = useCallback((stageKey: string): 'done' | 'running' | 'pending' => {
    if (!progress) return 'pending';
    const stageIdx = PIPELINE_STAGES.findIndex(s => s.key === stageKey);
    const currentIdx = PIPELINE_STAGES.findIndex(s => s.key === progress.stage);
    if (stageIdx < currentIdx) return 'done';
    if (stageIdx === currentIdx) return 'running';
    return 'pending';
  }, [progress]);

  // ===== 能力检测 =====
  const hasVideoCapability = hasCapability('video');

  // ===== 渲染：配置步骤 =====
  const renderConfigStep = () => (
    <div className="glass-panel fade-in" style={{ padding: '1.5rem' }}>
      {/* 文案输入区 */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-primary)' }}>
          {t('storyFilm.storyInput', '故事文案')}
        </h3>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <button
            className={`btn ${inputMode === 'ai' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.8rem' }}
            onClick={() => setInputMode('ai')}
          >
            <Sparkles size={14} /> {t('storyFilm.modeAI', 'AI 生成')}
          </button>
          <button
            className={`btn ${inputMode === 'paste' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.8rem' }}
            onClick={() => setInputMode('paste')}
          >
            <Pencil size={14} /> {t('storyFilm.modePaste', '手动输入')}
          </button>
        </div>

        {inputMode === 'ai' ? (
          <>
            <input
              className="input"
              placeholder={t('storyFilm.themePlaceholder', '输入故事主题，如：小猫的太空冒险')}
              value={theme}
              onChange={e => setTheme(e.target.value)}
              style={{ marginBottom: '0.5rem', width: '100%' }}
            />
            <textarea
              className="textarea"
              placeholder={t('storyFilm.keyPointsPlaceholder', '关键要点（每行一个，可选）')}
              value={keyPointsText}
              onChange={e => setKeyPointsText(e.target.value)}
              rows={3}
              style={{ marginBottom: '0.75rem', width: '100%' }}
            />
            <button
              className="btn btn-secondary"
              onClick={handleGenerateText}
              disabled={!theme.trim() || isGeneratingText}
            >
              {isGeneratingText
                ? <><Loader size={14} className="spin" /> {t('storyFilm.generatingText', '生成中...')}</>
                : <><Sparkles size={14} /> {t('storyFilm.generateText', 'AI 生成文案')}</>}
            </button>
            {generatedText && (
              <textarea
                className="textarea"
                value={storyText}
                onChange={e => setStoryText(e.target.value)}
                rows={8}
                style={{ marginTop: '0.75rem', width: '100%' }}
                placeholder={t('storyFilm.storyTextPlaceholder', 'AI 生成的文案，可编辑修改')}
              />
            )}
          </>
        ) : (
          <textarea
            className="textarea"
            placeholder={t('storyFilm.pastePlaceholder', '在此粘贴或输入您的故事文案...')}
            value={storyText}
            onChange={e => setStoryText(e.target.value)}
            rows={10}
            style={{ width: '100%' }}
          />
        )}
      </div>

      {/* 画面风格选择 */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-primary)' }}>
          {t('storyFilm.styleSelect', '画面风格')}
        </h3>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '0.75rem',
        }}>
          {VIDEO_STYLE_PRESETS.map(preset => (
            <button
              key={preset.id}
              className="glass-panel"
              onClick={() => setSelectedStyle(preset.id)}
              style={{
                padding: '0.75rem',
                cursor: 'pointer',
                textAlign: 'center',
                border: selectedStyle === preset.id
                  ? `2px solid var(--primary-color)`
                  : '2px solid transparent',
                background: selectedStyle === preset.id
                  ? 'var(--primary-color-alpha, rgba(99,102,241,0.1))'
                  : 'var(--bg-secondary)',
                transition: 'var(--motion-normal)',
              }}
            >
              <div style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>{preset.icon}</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                {t(preset.nameKey, preset.nameKey.split('.').pop() ?? '')}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 配音 & BGM 选项 */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-primary)' }}>
          <Volume2 size={16} style={{ verticalAlign: 'middle', marginRight: '0.25rem' }} />
          {t('storyFilm.voiceAndBgm', '配音与配乐')}
        </h3>

        <div style={{ marginBottom: '0.75rem' }}>
          <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>
            {t('storyFilm.narrationVoice', '旁白音色')}
          </label>
          <select
            className="select"
            value={voiceId}
            onChange={e => setVoiceId(e.target.value)}
            disabled={isLoadingVoices}
            style={{ width: '100%' }}
          >
            <option value="">{t('storyFilm.defaultVoice', '默认音色')}</option>
            {allVoices.map(v => (
              <option key={v.voiceId} value={v.voiceId}>
                {v.voiceName || v.description}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem' }}>
            <input
              type="checkbox"
              checked={includeBGM}
              onChange={e => setIncludeBGM(e.target.checked)}
            />
            <Music size={14} /> {t('storyFilm.includeBgm', '包含配乐')}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem' }}>
            <input
              type="checkbox"
              checked={includeSubtitles}
              onChange={e => setIncludeSubtitles(e.target.checked)}
            />
            {t('storyFilm.includeSubtitles', '包含字幕')}
          </label>
        </div>

        <div style={{ marginTop: '0.75rem' }}>
          <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>
            {t('storyFilm.videoDuration', '视频时长')}
          </label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {([6, 10] as const).map(d => (
              <button
                key={d}
                className={`btn ${videoDuration === d ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setVideoDuration(d)}
                style={{ fontSize: '0.8rem' }}
              >
                {d}s
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 开始创作 */}
      <button
        className="btn btn-primary"
        style={{ width: '100%', padding: '0.75rem', fontSize: '1rem' }}
        onClick={handleStartFilm}
        disabled={
          !currentSpaceId
          || (inputMode === 'paste' && !storyText.trim())
          || (inputMode === 'ai' && !generatedText && !storyText)
        }
      >
        <Film size={18} /> {t('storyFilm.startCreate', '开始创作')}
        <ArrowRight size={16} style={{ marginLeft: '0.25rem' }} />
      </button>
    </div>
  );

  // ===== 渲染：生成进度步骤 =====
  const renderGeneratingStep = () => (
    <div className="glass-panel fade-in" style={{ padding: '1.5rem' }}>
      <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem', color: 'var(--text-primary)' }}>
        <Loader size={18} className="spin" style={{ verticalAlign: 'middle', marginRight: '0.5rem' }} />
        {t('storyFilm.generating', '正在生成...')}
      </h3>

      {/* 8 阶段进度列表 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.25rem' }}>
        {PIPELINE_STAGES.map(stage => {
          const status = getStageStatus(stage.key);
          return (
            <div
              key={stage.key}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.75rem',
                padding: '0.5rem 0.75rem',
                borderRadius: 'var(--radius-md)',
                background: status === 'running' ? 'var(--primary-color-alpha, rgba(99,102,241,0.08))' : 'transparent',
              }}
            >
              <span style={{ fontSize: '1.1rem', width: '1.5rem', textAlign: 'center', flexShrink: 0 }}>
                {status === 'done' && '✅'}
                {status === 'running' && '🔄'}
                {status === 'pending' && '⏳'}
              </span>
              <span style={{
                fontSize: '0.875rem',
                color: status === 'pending' ? 'var(--text-muted)' : 'var(--text-primary)',
                fontWeight: status === 'running' ? 600 : 400,
                flex: 1,
              }}>
                {t(stage.i18nKey, stage.fallback)}
              </span>
              {status === 'running' && progress?.message && (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  {progress.message}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* 总进度条 */}
      <div style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            {t('storyFilm.totalProgress', '总进度')}
          </span>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 600 }}>
            {progress?.percent ?? 0}%
          </span>
        </div>
        <div style={{
          height: '8px',
          borderRadius: '4px',
          background: 'var(--bg-secondary)',
          overflow: 'hidden',
        }}>
          <div
            role="progressbar"
            aria-valuenow={progress?.percent ?? 0}
            aria-valuemin={0}
            aria-valuemax={100}
            style={{
              height: '100%',
              width: `${progress?.percent ?? 0}%`,
              background: 'var(--primary-color)',
              borderRadius: '4px',
              transition: 'width var(--motion-normal)',
            }}
          />
        </div>
      </div>

      {/* 取消按钮 */}
      <button className="btn btn-secondary" onClick={async () => {
        const ok = await confirm({
          title: t('storyFilm.cancelConfirmTitle', '取消生成'),
          message: t('storyFilm.cancelConfirmMessage', '取消后已生成的素材将保留，但需重新开始。确认取消？'),
          danger: true,
        });
        if (ok) cancelFilm();
      }} style={{ width: '100%' }}>
        <X size={14} /> {t('storyFilm.cancel', '取消生成')}
      </button>
    </div>
  );

  // ===== 渲染：预览步骤 =====
  const renderPreviewStep = () => (
    <div className="glass-panel fade-in" style={{ padding: '1.5rem', textAlign: 'center' }}>
      {pipelineTask?.finalVideoUrl && (
        <div style={{ marginBottom: '1rem' }}>
          <video
            src={pipelineTask.finalVideoUrl}
            controls
            style={{ width: '100%', borderRadius: 'var(--radius-lg)', maxHeight: '400px' }}
          />
        </div>
      )}
      <div style={{
        width: '64px', height: '64px', borderRadius: '50%',
        background: 'color-mix(in srgb, var(--color-success) 15%, transparent)', color: 'var(--color-success)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        margin: '0 auto 1rem', fontSize: '1.5rem',
      }}>
        <Check size={32} />
      </div>

      <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
        {t('storyFilm.generateSuccess', '视频生成完成')}
      </h3>

      {/* 成片信息 */}
      {result && (
        <div style={{
          background: 'var(--bg-secondary)',
          borderRadius: 'var(--radius-md)',
          padding: '1rem',
          marginBottom: '1rem',
          textAlign: 'left',
          fontSize: '0.85rem',
          color: 'var(--text-secondary)',
        }}>
          <div style={{ marginBottom: '0.25rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>Story ID: </span>
            <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>{result.storyId.slice(0, 8)}...</span>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Pipeline ID: </span>
            <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>{result.pipelineTaskId.slice(0, 8)}...</span>
          </div>
        </div>
      )}

      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
        {t('storyFilm.previewHint', '您可以在工作台中进一步编辑视频，或重新生成。')}
      </p>

      {/* 操作按钮 */}
      <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
        <button
          className="btn btn-primary"
          onClick={() => result && navigate(`/workbench?story=${result.storyId}`)}
        >
          <ChevronRight size={14} /> {t('storyFilm.goToWorkbench', '进入工作台编辑')}
        </button>
        <button className="btn btn-secondary" onClick={resetFilm}>
          <RefreshCw size={14} /> {t('storyFilm.regenerate', '重新生成')}
        </button>
      </div>
    </div>
  );

  // ===== 主渲染 =====
  if (!hasVideoCapability) {
    return (
      <LabPageLayout
        icon={<Film size={24} />}
        iconBg="color-mix(in srgb, var(--primary-color) 15%, transparent)"
        iconColor="var(--primary-color)"
        title={t('storyFilm.title', 'AI 故事成片')}
        subtitle={t('storyFilm.subtitle', '从故事文本到完整视频，一键生成')}
        tabs={[]}
        activeTab=""
        onTabChange={() => {}}
      >
        <AsyncState
          error={t('storyFilm.capabilityNotSupported', '当前平台不支持视频生成能力')}
        />
      </LabPageLayout>
    );
  }

  return (
    <LabPageLayout
      icon={<Film size={24} />}
      iconBg="color-mix(in srgb, var(--primary-color) 15%, transparent)"
      iconColor="var(--primary-color)"
      title={t('storyFilm.title', 'AI 故事成片')}
      subtitle={t('storyFilm.subtitle', '从故事文本到完整视频，一键生成')}
      tabs={[
        { key: 'config', label: t('storyFilm.tabConfig', '配置'), icon: <Pencil size={14} />, color: 'var(--primary-color)' },
        { key: 'generating', label: t('storyFilm.tabGenerating', '生成'), icon: <Loader size={14} />, color: 'var(--primary-color)' },
        { key: 'preview', label: t('storyFilm.tabPreview', '预览'), icon: <Check size={14} />, color: 'var(--primary-color)' },
      ]}
      activeTab={step}
      onTabChange={() => {/* 向导步骤不可手动切换 */}}
    >
      {step === 'config' && renderConfigStep()}
      {step === 'generating' && renderGeneratingStep()}
      {step === 'preview' && renderPreviewStep()}
    </LabPageLayout>
  );
};
