import React, { useState } from 'react';
import { Upload, Link, X } from 'lucide-react';
import {
  fileToBase64,
  validateImageFile,
  IMAGE_MAX_SIZE_MB,
  compressOnUpload,
  formatBytes,
  UPLOAD_COMPRESS_DEFAULTS,
  type UploadCompressResult,
} from '../utils/imageUtils';
import { TEXT_LIMITS } from '../../domain/constants/textLimits';
import { useToast } from '../contexts/ToastContext';

// 递增 ID 用于图片上传 input
let imageUploadCounter = 0;

export interface ImageUploadFieldProps {
  label: string;
  value: string | null;
  onChange: (url: string | null) => void;
  borderColor?: string;
  bgColor?: string;
  placeholder?: string;
  maxHeight?: string;
  /**
   * 是否启用上传时自动压缩（F1，默认 true）。
   * 启用后，上传文件先走 compressOnUpload 输出 Blob URL，替代 Base64，消除 33% 体积膨胀。
   * 失败时降级到 fileToBase64。
   */
  autoCompress?: boolean;
}

/** 图片上传组件：支持本地上传（自动压缩，F1）和 URL 输入 */
export const ImageUploadField: React.FC<ImageUploadFieldProps> = ({
  label, value, onChange, borderColor, bgColor, placeholder, maxHeight = '200px',
  autoCompress = UPLOAD_COMPRESS_DEFAULTS.enabled,
}) => {
  const { showToast } = useToast();
  const [mode, setMode] = useState<'file' | 'url'>('file');
  const [urlInput, setUrlInput] = useState('');
  const [fileInputId] = useState(() => `img-upload-${++imageUploadCounter}`);
  /** 上次压缩的元数据，用于显示「已压缩 X MB → Y MB」提示条（F1 UX） */
  const [compressInfo, setCompressInfo] = useState<UploadCompressResult | null>(null);
  /** 是否处于压缩中 */
  const [compressing, setCompressing] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // 架构违规修复（F4）：用 Toast 替代 alert，符合 IConfirmPort/INotificationPort 边界
    const err = validateImageFile(file);
    if (err) { showToast('error', err); return; }

    // F1：上传时自动压缩，输出 Blob URL（替代 Base64，消除 33% 体积膨胀）
    if (autoCompress) {
      setCompressing(true);
      try {
        const result = await compressOnUpload(file);
        setCompressInfo(result);
        onChange(result.blobUrl);
        // 显示压缩提示（F1 UX）：仅当节省比例 > 5% 才提示，避免无意义提示
        if (result.savedRatio > 0.05) {
          const savedPct = Math.round(result.savedRatio * 100);
          showToast(
            'success',
            `已自动压缩 ${formatBytes(result.originalSize)} → ${formatBytes(result.size)}（节省 ${savedPct}%）`,
          );
        }
        return;
      } catch {
        // 压缩失败降级：用 Base64 路径兜底，保证功能可用
        setCompressInfo(null);
      } finally {
        setCompressing(false);
      }
    }

    // 降级路径：Base64（原行为）
    const base64 = await fileToBase64(file);
    setCompressInfo(null);
    onChange(base64);
  };

  /** 撤销压缩，回退到原图 Base64（F1 UX，仅 UI state 层面） */
  const handleUndoCompress = async () => {
    // 原始 File 已不可得，清空 value 由用户重新上传
    setCompressInfo(null);
    onChange(null);
  };

  const handleUrlConfirm = () => {
    const trimmed = urlInput.trim();
    if (trimmed) {
      setCompressInfo(null);
      onChange(trimmed);
    }
  };

  const borderStyle = borderColor || 'var(--border-color)';
  const bgStyle = bgColor || 'rgba(0,0,0,0.1)';

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <label className="form-label" style={{ marginBottom: 0 }}>{label}</label>
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          <button
            className={`btn ${mode === 'file' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem' }}
            onClick={() => setMode('file')}
          >本地上传</button>
          <button
            className={`btn ${mode === 'url' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem' }}
            onClick={() => setMode('url')}
          ><Link size={10} /> URL</button>
        </div>
      </div>

      {mode === 'file' ? (
        <div
          style={{ border: `2px dashed ${borderStyle}`, borderRadius: 'var(--radius-md)', padding: value ? '0.5rem' : '2rem', textAlign: 'center', cursor: 'pointer', background: bgStyle, marginTop: '0.5rem', overflow: 'hidden' }}
          onClick={() => document.getElementById(fileInputId)?.click()}
        >
          {value ? (
            <div style={{ position: 'relative' }}>
              <img src={value} alt={label} style={{ maxWidth: '100%', maxHeight, borderRadius: 'var(--radius-md)' }} />
              <button
                onClick={e => { e.stopPropagation(); onChange(null); setCompressInfo(null); }}
                style={{ position: 'absolute', top: '0.25rem', right: '0.25rem', background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: '50%', color: '#fff', cursor: 'pointer', padding: '0.2rem', lineHeight: 1 }}
                aria-label="移除图片"
              ><X size={14} /></button>
              {compressInfo && compressInfo.savedRatio > 0.05 && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: '0.25rem',
                    left: '0.25rem',
                    right: '0.25rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.5rem',
                    padding: '0.25rem 0.5rem',
                    background: 'rgba(34, 197, 94, 0.85)',
                    color: '#fff',
                    borderRadius: 'var(--radius-sm, 0.25rem)',
                    fontSize: '0.75rem',
                  }}
                  role="status"
                  aria-live="polite"
                >
                  <span>
                    已压缩 {formatBytes(compressInfo.originalSize)} → {formatBytes(compressInfo.size)}（节省 {Math.round(compressInfo.savedRatio * 100)}%）
                  </span>
                  <button
                    onClick={e => { e.stopPropagation(); handleUndoCompress(); }}
                    style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.5)', color: '#fff', cursor: 'pointer', padding: '0.1rem 0.4rem', borderRadius: 'var(--radius-sm, 0.25rem)', fontSize: '0.7rem', lineHeight: 1 }}
                  >撤销</button>
                </div>
              )}
            </div>
          ) : (
            <>
              <Upload size={32} style={{ color: 'var(--text-muted)', marginBottom: '0.5rem' }} />
              <p style={{ margin: 0, color: 'var(--text-color)', fontSize: '0.85rem' }}>
                {compressing ? '压缩中...' : (placeholder || `点击上传图片 (JPG/PNG/WebP, <${IMAGE_MAX_SIZE_MB}MB)`)}
              </p>
              {autoCompress && !compressing && (
                <p style={{ margin: '0.25rem 0 0', color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                  上传自动压缩至 1920px · WebP · 质量 85
                </p>
              )}
            </>
          )}
          <input id={fileInputId} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
          <input
            className="form-input"
            placeholder="粘贴图片 URL (https://...)"
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleUrlConfirm()}
            style={{ flex: 1, fontSize: '0.85rem' }}
            maxLength={TEXT_LIMITS.URL_MAX}
          />
          <button className="btn btn-secondary" style={{ fontSize: '0.8rem' }} onClick={handleUrlConfirm} disabled={!urlInput.trim()}>确认</button>
        </div>
      )}
    </div>
  );
};
