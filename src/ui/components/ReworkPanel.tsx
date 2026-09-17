import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, X, History } from 'lucide-react';
import { reworkService } from '../../dependencies';
import type { FinalCut, VideoStyle, VideoModel, VideoResolution, FinalCutPipelineOptions } from '../../domain/entities/models';

const STYLES: VideoStyle[] = ['cinematic', 'anime', 'watercolor', 'gufeng', '3dcartoon', 'scifi', 'documentary', 'fairy_tale'];
const MODELS: VideoModel[] = ['MiniMax-Hailuo-2.3', 'MiniMax-Hailuo-2.3-Fast', 'MiniMax-Hailuo-02', 'T2V-01-Director', 'T2V-01', 'I2V-01-Director', 'I2V-01-live', 'I2V-01', 'S2V-01'];
const RESOLUTIONS: VideoResolution[] = ['512P', '720P', '768P', '1080P'];

/**
 * P0-3 成片回改面板：从 FinalCut.pipelineOptions 回显配置 → 重跑 pipeline → 生成新版本。
 * 同源版本列表展示版本链（v1/v2/...），当前版本高亮。
 */
export const ReworkPanel: React.FC<{ cut: FinalCut; storyTitle: string; onClose: () => void; onDone: () => void }> = ({ cut, storyTitle, onClose, onDone }) => {
  const { t } = useTranslation();
  const initial: FinalCutPipelineOptions = cut.pipelineOptions ?? {};

  const [videoStyle, setVideoStyle] = useState<VideoStyle | undefined>(initial.videoStyle);
  const [videoModel, setVideoModel] = useState<VideoModel | undefined>(initial.videoModel);
  const [videoResolution, setVideoResolution] = useState<VideoResolution | undefined>(initial.videoResolution);
  const [videoDuration, setVideoDuration] = useState<6 | 10 | undefined>(initial.videoDuration);
  const [includeNarration, setIncludeNarration] = useState(initial.includeNarration ?? true);
  const [includeBGM, setIncludeBGM] = useState(initial.includeBGM ?? true);
  const [includeSubtitles, setIncludeSubtitles] = useState(initial.includeSubtitles ?? true);
  const [promptOptimizer, setPromptOptimizer] = useState(initial.promptOptimizer ?? true);

  const [versions, setVersions] = useState<FinalCut[]>([]);
  const [running, setRunning] = useState(false);
  const [progressText, setProgressText] = useState('');

  const refreshVersions = useCallback(async () => {
    const list = await reworkService.listVersions(cut.storyId);
    setVersions(list);
  }, [cut.storyId]);

  useEffect(() => {
    let alive = true;
    reworkService.listVersions(cut.storyId)
      .then(list => { if (alive) setVersions(list); })
      .catch(() => {});
    return () => { alive = false; };
  }, [cut.storyId]);

  const runRework = async () => {
    setRunning(true);
    setProgressText('');
    try {
      const result = await reworkService.rework(cut, {
        videoStyle,
        videoModel,
        videoResolution,
        videoDuration,
        includeNarration,
        includeBGM,
        includeSubtitles,
        promptOptimizer,
        onProgress: (_stage, _percent, message) => setProgressText(message),
      });
      setProgressText(`${t('rework.success', '回改完成')} v${result.version ?? ''}`);
      await refreshVersions();
      onDone();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const versionOf = (c: FinalCut): string => `v${c.version ?? 1}`;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }} onClick={onClose}>
      <div className="card" style={{ width: 'min(100%, 620px)', maxHeight: '85vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <RefreshCw size={16} /> {t('rework.title', '成片回改')}
          </h3>
          <button className="btn btn-ghost" onClick={onClose} aria-label={t('rework.close', '关闭')}><X size={16} /></button>
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
          {storyTitle} · {t('rework.baseVersion', '基础版本')} {versionOf(cut)} · {new Date(cut.createdAt).toLocaleDateString()}
          {cut.sourceVersionId && <span> · {t('rework.derivedFrom', '由回改生成')}</span>}
        </div>

        {/* 配置表单（回显） */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem', padding: '0.7rem', background: 'rgba(0,0,0,0.03)', borderRadius: 10, marginBottom: '0.75rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              {t('rework.videoStyle', '画面风格')}
              <select className="input" value={videoStyle ?? ''} onChange={e => setVideoStyle(e.target.value ? e.target.value as VideoStyle : undefined)}>
                <option value="">—</option>
                {STYLES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              {t('rework.videoModel', '视频模型')}
              <select className="input" value={videoModel ?? ''} onChange={e => setVideoModel(e.target.value ? e.target.value as VideoModel : undefined)}>
                <option value="">—</option>
                {MODELS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              {t('rework.videoResolution', '分辨率')}
              <select className="input" value={videoResolution ?? ''} onChange={e => setVideoResolution(e.target.value ? e.target.value as VideoResolution : undefined)}>
                <option value="">—</option>
                {RESOLUTIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              {t('rework.videoDuration', '时长')}
              <select className="input" value={videoDuration ?? ''} onChange={e => setVideoDuration(e.target.value ? Number(e.target.value) as 6 | 10 : undefined)}>
                <option value="">—</option>
                <option value={6}>6s</option>
                <option value={10}>10s</option>
              </select>
            </label>
          </div>
          <div style={{ display: 'flex', gap: '0.9rem', flexWrap: 'wrap', fontSize: '0.8rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><input type="checkbox" checked={includeNarration} onChange={e => setIncludeNarration(e.target.checked)} /> {t('rework.includeNarration', '旁白')}</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><input type="checkbox" checked={includeBGM} onChange={e => setIncludeBGM(e.target.checked)} /> {t('rework.includeBgm', 'BGM')}</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><input type="checkbox" checked={includeSubtitles} onChange={e => setIncludeSubtitles(e.target.checked)} /> {t('rework.includeSubtitles', '字幕')}</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><input type="checkbox" checked={promptOptimizer} onChange={e => setPromptOptimizer(e.target.checked)} /> {t('rework.promptOptimizer', '提示词优化')}</label>
          </div>
          <button className="btn btn-primary" onClick={runRework} disabled={running}>
            <RefreshCw size={14} className={running ? 'spin' : ''} /> {running ? t('rework.running', '生成中...') : t('rework.runBtn', '重新生成')}
          </button>
          {progressText && <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{progressText}</div>}
        </div>

        {/* 同源版本列表 */}
        <div style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <History size={14} /> {t('rework.versionsTitle', '同源版本')}
        </div>
        {versions.length === 0 ? (
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', padding: '0.5rem 0' }}>{t('rework.noVersions', '暂无其他版本')}</div>
        ) : (
          versions.map(c => {
            const isCurrent = c.id === cut.id;
            return (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0', borderBottom: '1px solid var(--color-border)', fontSize: '0.8rem' }}>
                <span style={{ fontWeight: 600, color: isCurrent ? 'var(--primary-color)' : 'var(--text-primary)' }}>{versionOf(c)}</span>
                <span style={{ color: 'var(--text-secondary)' }}>{new Date(c.createdAt).toLocaleString()}</span>
                {isCurrent && <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', background: 'var(--primary-color)', color: '#fff', borderRadius: 8 }}>{t('rework.currentVersion', '当前')}</span>}
                {c.sourceVersionId && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>← {t('rework.fromVersion', '基于')} {versionOf(c)}</span>}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
