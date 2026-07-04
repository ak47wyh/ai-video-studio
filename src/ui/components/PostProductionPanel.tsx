import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Wand2, RefreshCw, Camera, Scissors, Subtitles, Film } from 'lucide-react';
import { postProcessService, subtitleService, autoEditService, cinematographyService } from '../../dependencies';
import type { ShotType, CameraMovement } from '../../domain/services/CinematographyService';
import { useToast } from '../contexts/ToastContext';
import { getErrorMessage } from '../utils/errorUtils';
import { TextAreaWithCounter } from './TextAreaWithCounter';
import { TEXT_LIMITS } from '../../domain/constants/textLimits';

interface PostProductionPanelProps {
  videoBlob: Blob | null;
  videoUrl: string | null;
  storyContent?: string;
  onVideoProcessed: (result: { blob: Blob; url?: string }) => void;
}

type ActiveTool = 'none' | 'speed' | 'trim' | 'crop' | 'subtitle' | 'autoEdit' | 'cinematography';

export const PostProductionPanel: React.FC<PostProductionPanelProps> = ({
  videoBlob, videoUrl, storyContent, onVideoProcessed,
}) => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [activeTool, setActiveTool] = useState<ActiveTool>('none');
  const [processing, setProcessing] = useState(false);

  // Speed change
  const [speed, setSpeed] = useState(1.0);

  // Trim
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(10);

  // Crop
  const [cropX, setCropX] = useState(0);
  const [cropY, setCropY] = useState(0);
  const [cropW, setCropW] = useState(1920);
  const [cropH, setCropH] = useState(1080);

  // Subtitle
  const [subtitleLang, setSubtitleLang] = useState('zh');
  const [subtitleText, setSubtitleText] = useState('');

  // Cinematography
  const [shotType, setShotType] = useState('medium');
  const [cameraMovement, setCameraMovement] = useState('static');
  const [cinematographyPrompt, setCinematographyPrompt] = useState('');

  const fetchVideoBlob = async (): Promise<Blob> => {
    if (videoBlob) return videoBlob;
    if (!videoUrl) throw new Error('No video available');
    const res = await fetch(videoUrl);
    return res.blob();
  };

  const handleSpeedChange = async () => {
    if (!videoBlob && !videoUrl) return;
    setProcessing(true);
    try {
      const blob = await fetchVideoBlob();
      const result = await postProcessService.changeSpeed(blob, speed);
      onVideoProcessed({ blob: result });
      showToast('success', t('postProcess.speedChanged'));
    } catch (e) {
      showToast('error', getErrorMessage(e));
    } finally {
      setProcessing(false);
    }
  };

  const handleTrim = async () => {
    if (!videoBlob && !videoUrl) return;
    setProcessing(true);
    try {
      const blob = await fetchVideoBlob();
      const result = await postProcessService.trim(blob, trimStart, trimEnd);
      onVideoProcessed({ blob: result });
      showToast('success', t('postProcess.trimmed'));
    } catch (e) {
      showToast('error', getErrorMessage(e));
    } finally {
      setProcessing(false);
    }
  };

  const handleCrop = async () => {
    if (!videoBlob && !videoUrl) return;
    setProcessing(true);
    try {
      const blob = await fetchVideoBlob();
      const result = await postProcessService.crop(blob, { x: cropX, y: cropY, width: cropW, height: cropH });
      onVideoProcessed({ blob: result });
      showToast('success', t('postProcess.cropped'));
    } catch (e) {
      showToast('error', getErrorMessage(e));
    } finally {
      setProcessing(false);
    }
  };

  const handleGenerateSubtitle = async () => {
    if (!videoBlob && !videoUrl) return;
    setProcessing(true);
    try {
      const blob = await fetchVideoBlob();
      const srt = await subtitleService.generateSrtFromSegments(blob, []);
      setSubtitleText(srt);
      showToast('success', t('postProcess.subtitleGenerated'));
    } catch (e) {
      showToast('error', getErrorMessage(e));
    } finally {
      setProcessing(false);
    }
  };

  const handleTranslateSubtitle = async () => {
    if (!subtitleText) return;
    setProcessing(true);
    try {
      const translated = await subtitleService.translateSrt(subtitleText, subtitleLang);
      setSubtitleText(translated);
      showToast('success', t('postProcess.subtitleTranslated'));
    } catch (e) {
      showToast('error', getErrorMessage(e));
    } finally {
      setProcessing(false);
    }
  };

  const handleAutoEdit = async () => {
    if (!videoBlob && !videoUrl) return;
    setProcessing(true);
    try {
      const blob = await fetchVideoBlob();
      const editedVideo = await autoEditService.autoTrim(blob);
      onVideoProcessed({ blob: editedVideo });
      showToast('success', t('postProcess.autoEdited'));
    } catch (e) {
      showToast('error', getErrorMessage(e));
    } finally {
      setProcessing(false);
    }
  };

  const handleGenerateCinematography = async () => {
    if (!storyContent) {
      showToast('warning', t('postProcess.noStoryContent'));
      return;
    }
    setProcessing(true);
    try {
      const result = await cinematographyService.enhancePromptWithShot(storyContent, { shotType: shotType as ShotType, movement: cameraMovement as CameraMovement, angle: 'eye-level' as const, durationSec: 6, description: '', promptEnhancement: '' });
      setCinematographyPrompt(result);
      showToast('success', t('postProcess.cinematographyGenerated'));
    } catch (e) {
      showToast('error', getErrorMessage(e));
    } finally {
      setProcessing(false);
    }
  };

  const hasVideo = !!(videoBlob || videoUrl);

  const toolButtons: { key: ActiveTool; icon: React.ReactNode; label: string }[] = [
    { key: 'speed', icon: <Film size={14} />, label: t('postProcess.speed') },
    { key: 'trim', icon: <Scissors size={14} />, label: t('postProcess.trim') },
    { key: 'crop', icon: <Camera size={14} />, label: t('postProcess.crop') },
    { key: 'subtitle', icon: <Subtitles size={14} />, label: t('postProcess.subtitle') },
    { key: 'autoEdit', icon: <Wand2 size={14} />, label: t('postProcess.autoEdit') },
    { key: 'cinematography', icon: <Camera size={14} />, label: t('postProcess.cinematography') },
  ];

  return (
    <div style={{
      padding: '1rem 1.25rem', borderRadius: 'var(--radius-lg)',
      background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.2)',
    }}>
      <h3 style={{ fontSize: '0.95rem', margin: '0 0 0.75rem 0', color: '#34d399' }}>
        {t('postProcess.title')}
      </h3>

      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        {toolButtons.map(btn => (
          <button key={btn.key} className="btn btn-secondary"
            style={{
              fontSize: '0.75rem', padding: '0.3rem 0.6rem',
              display: 'flex', alignItems: 'center', gap: '0.3rem',
              background: activeTool === btn.key ? 'color-mix(in srgb, var(--color-success) 15%, transparent)' : undefined,
              borderColor: activeTool === btn.key ? 'var(--color-success)' : undefined,
              color: activeTool === btn.key ? 'var(--color-success)' : undefined,
            }}
            disabled={!hasVideo && btn.key !== 'cinematography'}
            onClick={() => setActiveTool(activeTool === btn.key ? 'none' : btn.key)}>
            {btn.icon} {btn.label}
          </button>
        ))}
      </div>

      {activeTool === 'speed' && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <label style={{ fontSize: '0.8rem' }}>{t('postProcess.speedLabel')}</label>
          <input type="range" min="0.25" max="4" step="0.25" value={speed}
            onChange={e => setSpeed(Number(e.target.value))} style={{ flex: 1 }} />
          <span style={{ fontSize: '0.8rem', fontWeight: 600, minWidth: '2rem' }}>{speed}x</span>
          <button className="btn btn-primary" style={{ fontSize: '0.75rem', padding: '0.3rem 0.8rem' }}
            disabled={processing} onClick={handleSpeedChange}>
            {processing ? <RefreshCw size={12} className="spin" /> : t('postProcess.apply')}
          </button>
        </div>
      )}

      {activeTool === 'trim' && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <label style={{ fontSize: '0.8rem' }}>{t('postProcess.trimStart')}</label>
          <input type="number" className="form-input" style={{ width: '60px', fontSize: '0.8rem' }}
            value={trimStart} onChange={e => setTrimStart(Number(e.target.value))} min={0} />
          <label style={{ fontSize: '0.8rem' }}>{t('postProcess.trimEnd')}</label>
          <input type="number" className="form-input" style={{ width: '60px', fontSize: '0.8rem' }}
            value={trimEnd} onChange={e => setTrimEnd(Number(e.target.value))} min={0} />
          <button className="btn btn-primary" style={{ fontSize: '0.75rem', padding: '0.3rem 0.8rem' }}
            disabled={processing} onClick={handleTrim}>
            {processing ? <RefreshCw size={12} className="spin" /> : t('postProcess.apply')}
          </button>
        </div>
      )}

      {activeTool === 'crop' && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: '0.75rem' }}>X</label>
          <input type="number" className="form-input" style={{ width: '50px', fontSize: '0.75rem' }}
            value={cropX} onChange={e => setCropX(Number(e.target.value))} />
          <label style={{ fontSize: '0.75rem' }}>Y</label>
          <input type="number" className="form-input" style={{ width: '50px', fontSize: '0.75rem' }}
            value={cropY} onChange={e => setCropY(Number(e.target.value))} />
          <label style={{ fontSize: '0.75rem' }}>W</label>
          <input type="number" className="form-input" style={{ width: '60px', fontSize: '0.75rem' }}
            value={cropW} onChange={e => setCropW(Number(e.target.value))} />
          <label style={{ fontSize: '0.75rem' }}>H</label>
          <input type="number" className="form-input" style={{ width: '60px', fontSize: '0.75rem' }}
            value={cropH} onChange={e => setCropH(Number(e.target.value))} />
          <button className="btn btn-primary" style={{ fontSize: '0.75rem', padding: '0.3rem 0.8rem' }}
            disabled={processing} onClick={handleCrop}>
            {processing ? <RefreshCw size={12} className="spin" /> : t('postProcess.apply')}
          </button>
        </div>
      )}

      {activeTool === 'subtitle' && (
        <div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
            <button className="btn btn-primary" style={{ fontSize: '0.75rem', padding: '0.3rem 0.8rem' }}
              disabled={processing} onClick={handleGenerateSubtitle}>
              {processing ? <RefreshCw size={12} className="spin" /> : t('postProcess.generateSrt')}
            </button>
            <select className="form-select" style={{ width: '80px', fontSize: '0.75rem' }}
              value={subtitleLang} onChange={e => setSubtitleLang(e.target.value)}>
              <option value="en">English</option>
              <option value="zh">中文</option>
              <option value="ja">日本語</option>
              <option value="ko">한국어</option>
              <option value="fr">Français</option>
            </select>
            <button className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.3rem 0.8rem' }}
              disabled={processing || !subtitleText} onClick={handleTranslateSubtitle}>
              {t('postProcess.translateSrt')}
            </button>
          </div>
          {subtitleText && (
            <textarea className="form-textarea" style={{ fontSize: '0.75rem', width: '100%', minHeight: '80px' }}
              value={subtitleText} onChange={e => setSubtitleText(e.target.value)} />
          )}
        </div>
      )}

      {activeTool === 'autoEdit' && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0, flex: 1 }}>
            {t('postProcess.autoEditDesc')}
          </p>
          <button className="btn btn-primary" style={{ fontSize: '0.75rem', padding: '0.3rem 0.8rem' }}
            disabled={processing} onClick={handleAutoEdit}>
            {processing ? <RefreshCw size={12} className="spin" /> : <><Wand2 size={12} /> {t('postProcess.autoEditBtn')}</>}
          </button>
        </div>
      )}

      {activeTool === 'cinematography' && (
        <div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
            <select className="form-select" style={{ width: '100px', fontSize: '0.75rem' }}
              value={shotType} onChange={e => setShotType(e.target.value)}>
              {['extreme_close_up', 'close_up', 'medium_close_up', 'medium', 'medium_long', 'long', 'extreme_long', 'over_shoulder', 'point_of_view'].map(s => (
                <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
              ))}
            </select>
            <select className="form-select" style={{ width: '100px', fontSize: '0.75rem' }}
              value={cameraMovement} onChange={e => setCameraMovement(e.target.value)}>
              {['static', 'pan_left', 'pan_right', 'tilt_up', 'tilt_down', 'dolly_in', 'dolly_out', 'tracking', 'crane'].map(m => (
                <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>
              ))}
            </select>
            <button className="btn btn-primary" style={{ fontSize: '0.75rem', padding: '0.3rem 0.8rem' }}
              disabled={processing} onClick={handleGenerateCinematography}>
              {processing ? <RefreshCw size={12} className="spin" /> : <><Camera size={12} /> {t('postProcess.generatePrompt')}</>}
            </button>
          </div>
          {cinematographyPrompt && (
            <TextAreaWithCounter className="form-textarea" style={{ fontSize: '0.75rem', width: '100%', minHeight: '60px' }}
              value={cinematographyPrompt} onChange={e => setCinematographyPrompt(e.target.value)}
              maxLength={TEXT_LIMITS.CINEMATOGRAPHY_PROMPT_MAX} />
          )}
        </div>
      )}
    </div>
  );
};