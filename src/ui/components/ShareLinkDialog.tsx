/**
 * ShareLinkDialog —— 分享链接对话框（E-3 发布能力一期）
 *
 * 生成 7 天有效分享链接 → 展示 + 复制 + 撤销。
 */

import React, { useState } from 'react';
import { X, Link2, Copy, Check, Loader2, Ban, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { shareService } from '../../dependencies';
import { useToast } from '../contexts/ToastContext';
import { getErrorMessage } from '../utils/errorUtils';

interface ShareLinkDialogProps {
  cutId: string;
  onClose: () => void;
}

export const ShareLinkDialog: React.FC<ShareLinkDialogProps> = ({ cutId, onClose }) => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);

  const handleGenerate = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const url = await shareService.generateShareLink(cutId);
      setLink(url);
    } catch (e) {
      setErrorMsg(getErrorMessage(e, t('share.generatedFailed', '生成分享链接失败')));
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      showToast('success', t('share.copied', '链接已复制'));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('error', t('share.copyFailed', '复制失败'));
    }
  };

  const handleRevoke = async () => {
    if (!link) return;
    setRevoking(true);
    try {
      const token = link.split('/').pop();
      if (token) await shareService.revokeShareLink(token);
      showToast('success', t('share.revoked', '链接已撤销'));
      onClose();
    } catch (e) {
      showToast('error', getErrorMessage(e, t('share.revokeFailed', '撤销失败')));
    } finally {
      setRevoking(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
      }}
    >
      <div
        className="glass-panel"
        onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 440, padding: '1.25rem', position: 'relative' }}
      >
        <button
          className="btn btn-secondary"
          style={{ position: 'absolute', top: '0.6rem', right: '0.6rem', padding: '0.3rem', border: 'none', background: 'transparent' }}
          onClick={onClose}
        >
          <X size={16} />
        </button>
        <h2 style={{ margin: '0 0 0.75rem', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Link2 size={16} /> {t('share.title', '分享链接')}
        </h2>

        {errorMsg && (
          <div style={{ fontSize: '0.8rem', color: 'var(--color-danger)', background: 'rgba(234,102,104,0.1)', padding: '0.5rem 0.6rem', borderRadius: 8, marginBottom: '0.75rem' }}>
            {errorMsg}
          </div>
        )}

        {!link ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {t('share.hint', '生成一个 7 天内有效的公开访问链接，对方无需登录即可观看视频与字幕。')}
            </p>
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleGenerate} disabled={loading}>
              {loading ? <Loader2 size={15} className="spin" /> : <Link2 size={15} />}
              {t('share.generate', '生成分享链接')}
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: '0.4rem',
                background: 'rgba(0,0,0,0.06)', padding: '0.5rem 0.6rem', borderRadius: 8,
                fontSize: '0.75rem', wordBreak: 'break-all',
              }}
            >
              <span style={{ flex: 1, color: 'var(--text-muted)' }}>{link}</span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleCopy}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? t('share.copied', '已复制') : t('share.copy', '复制链接')}
              </button>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={handleRevoke} disabled={revoking}>
                {revoking ? <Loader2 size={14} className="spin" /> : <Ban size={14} />}
                {t('share.revoke', '撤销链接')}
              </button>
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <AlertCircle size={12} />
              {t('share.expiryNote', '链接将在 7 天后自动失效，撤销后立即无法访问。')}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
