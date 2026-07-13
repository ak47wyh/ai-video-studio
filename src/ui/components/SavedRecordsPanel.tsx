/**
 * SavedRecordsPanel —— 实验室页面"已保存到素材库"记录面板
 *
 * 保存成功后自动展开，展示本会话已保存的缩略图列表。
 * 点击缩略图可重新预览、复制名称。
 */

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, CheckCircle2 } from 'lucide-react';
import type { SavedImage } from '../../domain/entities/models';
import { assetLibraryService } from '../../dependencies';

interface SavedRecordsPanelProps {
  images: SavedImage[];
  /** 外部触发自动展开（如保存成功后） */
  autoExpandKey?: number;
}

export const SavedRecordsPanel: React.FC<SavedRecordsPanelProps> = ({ images, autoExpandKey }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});

  // autoExpandKey 变化时自动展开（React 19 推荐：render 期间同步 state，避免 effect 级联渲染）
  const [prevAutoExpandKey, setPrevAutoExpandKey] = useState(autoExpandKey);
  if (autoExpandKey !== prevAutoExpandKey) {
    setPrevAutoExpandKey(autoExpandKey);
    if (autoExpandKey !== undefined && autoExpandKey > 0) {
      setExpanded(true);
    }
  }

  // 加载缩略图 URL
  useEffect(() => {
    let cancelled = false;
    const localUrls: Record<string, string> = {};
    (async () => {
      for (const img of images) {
        try {
          localUrls[img.id] = await assetLibraryService.getImageBlobUrl(img);
        } catch {
          localUrls[img.id] = '';
        }
      }
      if (!cancelled) setUrls(localUrls);
    })();
    return () => {
      cancelled = true;
      Object.values(localUrls).forEach(u => { if (u) URL.revokeObjectURL(u); });
    };
  }, [images]);

  if (images.length === 0) return null;

  return (
    <div style={{
      marginTop: '1rem',
      border: '1px solid var(--border-color, #333)',
      borderRadius: '0.5rem',
      overflow: 'hidden',
    }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.6rem 0.8rem',
          cursor: 'pointer',
          background: 'var(--bg-secondary, rgba(255,255,255,0.03))',
          fontSize: '0.85rem',
        }}
      >
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <CheckCircle2 size={14} style={{ color: '#22c55e' }} />
        <span>
          {t('imageLab.savedRecords', '已保存到素材库')}
          <span style={{ color: 'var(--text-muted)', marginLeft: '0.4rem' }}>
            ({images.length})
          </span>
        </span>
      </div>
      {expanded && (
        <div style={{
          display: 'flex',
          gap: '0.5rem',
          padding: '0.6rem 0.8rem',
          overflowX: 'auto',
        }}>
          {images.map(img => (
            <div
              key={img.id}
              title={`${img.name}\n${new Date(img.createdAt).toLocaleString()}\n标签：${img.tags.join(', ')}`}
              style={{
                flex: '0 0 auto',
                width: '80px',
                cursor: 'pointer',
              }}
              onClick={() => {
                if (urls[img.id]) {
                  navigator.clipboard?.writeText(img.name).catch(() => undefined);
                }
              }}
            >
              {urls[img.id] ? (
                <img
                  src={urls[img.id]}
                  alt={img.name}
                  style={{ width: '80px', height: '60px', objectFit: 'cover', borderRadius: '0.25rem' }}
                />
              ) : (
                <div style={{ width: '80px', height: '60px', background: 'rgba(0,0,0,0.3)', borderRadius: '0.25rem' }} />
              )}
              <div style={{
                fontSize: '0.65rem',
                marginTop: '0.2rem',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                color: 'var(--text-muted)',
              }}>
                {img.name}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
