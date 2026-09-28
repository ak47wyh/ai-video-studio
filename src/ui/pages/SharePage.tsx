/**
 * SharePage —— 分享链接公开访问页（E-3 发布能力一期）
 *
 * 无需登录，仅展示视频 + 字幕，无编辑能力。
 * 链接格式：/share/:token（路由注册在 MainLayout 外，独立全屏页）。
 */

import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Film, Clock, Captions, AlertCircle, FileText, ArrowLeft } from 'lucide-react';
import { shareService } from '../../dependencies';
import { useObjectUrl } from '../hooks/useObjectUrl';
import type { ShareLink } from '../../domain/entities/models';

const formatDuration = (ms: number): string => {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
};

export const SharePage: React.FC = () => {
  const { t } = useTranslation();
  const { token } = useParams<{ token: string }>();
  const [link, setLink] = useState<ShareLink | null>(null);
  const [notFound, setNotFound] = useState(false);
  const videoUrl = useObjectUrl(link?.videoBlob);

  useEffect(() => {
    let cancelled = false;
    if (!token) return;
    shareService.resolveShareLink(token).then((resolved) => {
      if (cancelled) return;
      if (!resolved) {
        setNotFound(true);
        return;
      }
      setLink(resolved);
    }).catch(() => {
      if (!cancelled) setNotFound(true);
    });
    return () => { cancelled = true; };
  }, [token]);

  if (notFound || !token) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', background: 'var(--bg, #0f1117)' }}>
        <div className="glass-panel" style={{ maxWidth: 420, width: '100%', padding: '2rem', textAlign: 'center' }}>
          <AlertCircle size={40} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
          <h2 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>{t('share.expiredTitle')}</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 1rem' }}>
            {t('share.expiredHint')}
          </p>
          <Link className="btn btn-primary" to="/" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
            <ArrowLeft size={14} /> {t('share.backToApp')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', padding: '1.5rem', background: 'var(--bg, #0f1117)' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div className="glass-panel" style={{ padding: '1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <Film size={18} />
          <strong style={{ fontSize: '0.95rem' }}>{link?.storyTitle ?? '…'}</strong>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
            <Clock size={13} /> {link ? formatDuration(link.duration) : '…'}
          </span>
          {link?.hasSubtitles && (
            <span style={{ fontSize: '0.8rem', color: 'var(--color-success)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
              <Captions size={13} /> {t('share.withSubs')}
            </span>
          )}
        </div>

        {videoUrl && (
          <video
            src={videoUrl}
            controls
            autoPlay
            style={{ width: '100%', maxHeight: '70vh', borderRadius: 'var(--radius-md)', background: '#000' }}
          />
        )}

        {link?.srtContent && (
          <div className="glass-panel" style={{ padding: '1rem', marginTop: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <FileText size={15} />
              <strong style={{ fontSize: '0.85rem' }}>{t('share.subtitle')}</strong>
              <a
                href={`data:text/plain;charset=utf-8,${encodeURIComponent(link.srtContent)}`}
                download={`${link.storyTitle}-subtitle.srt`}
                className="btn btn-secondary btn-xs"
                style={{ marginLeft: 'auto', textDecoration: 'none' }}
              >
                {t('share.downloadSrt')}
              </a>
            </div>
            <pre style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'pre-wrap', maxHeight: 240, overflow: 'auto' }}>
              {link.srtContent}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};
