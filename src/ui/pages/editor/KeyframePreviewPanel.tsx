/**
 * KeyframePreviewPanel —— 关键帧预览面板
 *
 * M2.3 AutoEditService 接入 VideoEditor（EVOLUTION_DESIGN.md §6.3）：
 *   在 VideoEditor 顶部工具栏增加"AI 智能剪切"按钮，
 *   点击后弹出本面板，展示 AutoEditService 检测到的关键帧 + 剪切建议，
 *   用户勾选要保留的片段后一键应用剪切。
 *
 * 流程：
 *   [EditorToolbar] "智能剪切" → [KeyframePreviewPanel]
 *   → AutoEditService.detectKeyframes(videoBlob)
 *   → 展示关键帧时间轴
 *   → 用户勾选保留片段
 *   → AutoEditService.autoTrim()
 *   → 新视频替换当前 timeline 的 video clip
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Scissors, Loader2, Check, Play } from 'lucide-react';
import { autoEditService } from '../../../dependencies';
import { useToast } from '../../contexts/ToastContext';
import type { KeyframeInfo, CutSuggestion } from '../../../domain/services/AutoEditService';

export interface KeyframePreviewPanelProps {
  isOpen: boolean;
  videoBlob: Blob | null;
  onClose: () => void;
  onApplyTrim?: (keptSegments: Array<{ startSec: number; endSec: number }>) => void;
}

export const KeyframePreviewPanel: React.FC<KeyframePreviewPanelProps> = ({
  isOpen, videoBlob, onClose, onApplyTrim,
}) => {
  const { t } = useTranslation();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(false);
  const [keyframes, setKeyframes] = useState<KeyframeInfo[]>([]);
  const [cuts, setCuts] = useState<CutSuggestion[]>([]);
  const [selectedCutIds, setSelectedCutIds] = useState<Set<number>>(new Set());
  const [applying, setApplying] = useState(false);

  // 视频变化时重新检测关键帧
  useEffect(() => {
    if (!isOpen || !videoBlob) return;
    let cancelled = false;

    autoEditService.suggestCuts(videoBlob)
      .then(suggestions => {
        if (cancelled) return;
        setCuts(suggestions);
        // 默认全选
        setSelectedCutIds(new Set(suggestions.map((_, i) => i)));
      })
      .catch(e => {
        console.error('detect keyframes failed', e);
        showToast('error', t('autoEdit.detectFailed', '关键帧检测失败'));
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    // 进入新检测周期，重置旧状态属于 effect 副作用
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    setKeyframes([]);
    setCuts([]);
    setSelectedCutIds(new Set());
    /* eslint-enable react-hooks/set-state-in-effect */
    return () => { cancelled = true; };
  }, [isOpen, videoBlob, showToast, t]);

  const handleToggle = useCallback((idx: number) => {
    setSelectedCutIds(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const handleApply = useCallback(() => {
    if (selectedCutIds.size === 0) {
      showToast('warning', t('autoEdit.noSelection', '请至少选择一个片段'));
      return;
    }
    setApplying(true);
    const keptSegments = cuts
      .filter((_, i) => selectedCutIds.has(i))
      .map(c => ({ startSec: c.startSec, endSec: c.endSec }));
    onApplyTrim?.(keptSegments);
    setApplying(false);
    showToast('success', t('autoEdit.applied', `已应用剪切，保留 ${keptSegments.length} 个片段`));
    onClose();
  }, [selectedCutIds, cuts, onApplyTrim, showToast, t, onClose]);

  if (!isOpen) return null;

  const totalKeptSec = cuts
    .filter((_, i) => selectedCutIds.has(i))
    .reduce((sum, c) => sum + (c.endSec - c.startSec), 0);

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t('autoEdit.title', 'AI 智能剪切')}
      onClick={onClose}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="modal-content" style={{ maxWidth: 800, maxHeight: '85vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Scissors size={18} />
            {t('autoEdit.title', 'AI 智能剪切')}
          </h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
            <Loader2 size={24} className="spin" />
            <p style={{ marginTop: 8, fontSize: 13 }}>{t('autoEdit.detecting', '正在检测关键帧…')}</p>
          </div>
        ) : cuts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
            {t('autoEdit.noCuts', '未检测到剪切建议')}
          </div>
        ) : (
          <>
            {/* 统计信息 */}
            <div style={{ marginBottom: 12, padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 12, color: 'var(--text-muted)' }}>
              {t('autoEdit.stats', {
                total: cuts.length,
                selected: selectedCutIds.size,
                duration: totalKeptSec.toFixed(1),
                default: `共 ${cuts.length} 个片段，已选 ${selectedCutIds.size} 个，保留时长 ${totalKeptSec.toFixed(1)}s`,
              })}
            </div>

            {/* 关键帧时间轴 */}
            {keyframes.length > 0 && (
              <div style={{ marginBottom: 12, display: 'flex', gap: 4, overflowX: 'auto', padding: '4px 0' }}>
                {keyframes.map((kf, i) => (
                  <div key={i} style={{ position: 'relative', flexShrink: 0 }}>
                    <img
                      src={kf.thumbnail}
                      alt={`frame ${kf.timestamp.toFixed(1)}s`}
                      style={{ width: 64, height: 36, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border-color)' }}
                    />
                    <span style={{ position: 'absolute', bottom: 2, right: 2, fontSize: 11, background: 'color-mix(in srgb, var(--bg-dark) 70%, transparent)', color: 'var(--text-inverse)', padding: '0 3px', borderRadius: 2 }}>
                      {kf.timestamp.toFixed(1)}s
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* 剪切建议列表 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
              {cuts.map((cut, i) => {
                const selected = selectedCutIds.has(i);
                const duration = (cut.endSec - cut.startSec).toFixed(1);
                return (
                  <div
                    key={i}
                    onClick={() => handleToggle(i)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 12px', borderRadius: 6, cursor: 'pointer',
                      border: `1px solid ${selected ? 'var(--primary)' : 'var(--border-color)'}`,
                      background: selected ? 'var(--primary-bg)' : 'var(--bg-secondary)',
                    }}
                  >
                    <div style={{
                      width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                      border: `1.5px solid ${selected ? 'var(--primary)' : 'var(--border-color)'}`,
                      background: selected ? 'var(--primary)' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {selected && <Check size={12} color="#fff" />}
                    </div>
                    <span style={{ flex: 1, fontSize: 13 }}>
                      <strong>{cut.startSec.toFixed(1)}s - {cut.endSec.toFixed(1)}s</strong>
                      <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>({duration}s)</span>
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {cut.reason}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* 底部操作 */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button className="btn" onClick={onClose} disabled={applying}>
                {t('common.cancel', '取消')}
              </button>
              <button className="btn btn-primary" onClick={handleApply} disabled={applying || selectedCutIds.size === 0}>
                {applying ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
                {t('autoEdit.apply', '应用剪切')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
