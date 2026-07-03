/**
 * SegmentPicker —— 分镜选择器弹窗
 *
 * M2.1 Lab→Segment 快捷发送（EVOLUTION_DESIGN.md §6.1）：
 *   在任一 Lab 生成素材后，可"发送到当前故事的指定分镜"，
 *   无需手动切页面 + AssetPicker。
 *
 * 交互：
 *   1. Lab 生成素材后点"发送到分镜"按钮
 *   2. 弹出 SegmentPicker 显示当前故事的所有分镜列表
 *   3. 选中后一键绑定到 seg 的对应字段（图片/音频/BGM）
 *   4. 显示 toast "已绑定到分镜 N"
 *
 * 绑定字段映射：
 *   - image → seg.firstFrameImage
 *   - voice → seg.narrationAudioStoragePath / seg.narrationAudioUrl
 *   - bgm   → seg.bgmStoragePath / seg.bgmAudioUrl / seg.bgmPrompt
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Send, Check } from 'lucide-react';
import { segmentRepo, storyRepo } from '../../dependencies';
import { useSpace } from '../contexts/SpaceContext';
import { useToast } from '../contexts/ToastContext';
import type { StorySegment, Story } from '../../domain/entities/models';

export type SegmentBindField = 'image' | 'voice' | 'bgm';

export interface SegmentPickerProps {
  isOpen: boolean;
  /** 当前要绑定的素材 URL / DataURI / 存储路径 */
  assetUrl: string;
  /** 当前要绑定的素材类型，决定写入哪个字段 */
  bindField: SegmentBindField;
  /** 附加 prompt（BGM 类型时可写入 seg.bgmPrompt） */
  assetPrompt?: string;
  onClose: () => void;
  /** 绑定成功回调 */
  onBound?: (segmentId: string, sequenceOrder: number) => void;
}

export const SegmentPicker: React.FC<SegmentPickerProps> = ({
  isOpen, assetUrl, bindField, assetPrompt, onClose, onBound,
}) => {
  const { t } = useTranslation();
  const { currentSpaceId } = useSpace();
  const { showToast } = useToast();

  const [stories, setStories] = useState<Story[]>([]);
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(null);
  const [segments, setSegments] = useState<StorySegment[]>([]);
  const [loading, setLoading] = useState(false);
  const [binding, setBinding] = useState<string | null>(null);

  // 加载当前空间的所有故事
  useEffect(() => {
    if (!isOpen || !currentSpaceId) return;
    let cancelled = false;
    // 启动异步加载：loading 状态由 effect 内派生，符合 React 19 推荐模式
    const loadPromise = storyRepo.findBySpaceId(currentSpaceId).then(list => {
      if (cancelled) return;
      setStories(list);
      // 自动选中第一个故事（如有）
      if (list.length > 0 && !selectedStoryId) {
        setSelectedStoryId(list[0].id);
      }
    }).catch(e => {
      console.error('load stories failed', e);
    });
    // loading 在 promise 完成（成功/失败）后置 false；置 true 由 derived state 计算
    loadPromise.finally(() => { if (!cancelled) setLoading(false); });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 加载中状态属于 effect 副作用，异步开始前同步标记
    setLoading(true);
    return () => { cancelled = true; };
  }, [isOpen, currentSpaceId, selectedStoryId]);

  // 故事切换时加载分镜
  useEffect(() => {
    if (!isOpen || !selectedStoryId) return;
    let cancelled = false;
    const loadPromise = segmentRepo.findByStoryId(selectedStoryId).then(list => {
      if (cancelled) return;
      setSegments(list.sort((a, b) => a.sequenceOrder - b.sequenceOrder));
    }).catch(e => {
      console.error('load segments failed', e);
    });
    loadPromise.finally(() => { if (!cancelled) setLoading(false); });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 加载中状态属于 effect 副作用
    setLoading(true);
    return () => { cancelled = true; };
  }, [isOpen, selectedStoryId]);

  const handleBind = useCallback(async (seg: StorySegment) => {
    setBinding(seg.id);
    try {
      const updated = { ...seg };
      switch (bindField) {
        case 'image':
          updated.firstFrameImage = assetUrl;
          break;
        case 'voice':
          updated.narrationAudioStoragePath = assetUrl;
          updated.narrationAudioUrl = assetUrl;
          break;
        case 'bgm':
          updated.bgmStoragePath = assetUrl;
          updated.bgmAudioUrl = assetUrl;
          if (assetPrompt) updated.bgmPrompt = assetPrompt;
          break;
      }
      await segmentRepo.save(updated);
      showToast(t('segmentPicker.boundSuccess', `已绑定到分镜 ${seg.sequenceOrder + 1}`), 'success');
      onBound?.(seg.id, seg.sequenceOrder);
      onClose();
    } catch (e) {
      console.error('bind segment failed', e);
      showToast(t('segmentPicker.boundFailed', '绑定失败'), 'error');
    } finally {
      setBinding(null);
    }
  }, [assetUrl, bindField, assetPrompt, showToast, t, onBound, onClose]);

  if (!isOpen) return null;

  const fieldLabel = {
    image: t('segmentPicker.imageField', '首帧图片'),
    voice: t('segmentPicker.voiceField', '旁白音频'),
    bgm: t('segmentPicker.bgmField', '背景音乐'),
  }[bindField];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: 560, maxHeight: '80vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
            {t('segmentPicker.title', '发送到分镜')} — {fieldLabel}
          </h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        {/* 故事选择 */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
            {t('segmentPicker.selectStory', '选择故事')}
          </label>
          <select
            className="input"
            value={selectedStoryId ?? ''}
            onChange={e => setSelectedStoryId(e.target.value || null)}
          >
            <option value="">{t('segmentPicker.storyPlaceholder', '请选择…')}</option>
            {stories.map(s => (
              <option key={s.id} value={s.id}>{s.title || t('export.untitledStory', '未命名故事')}</option>
            ))}
          </select>
        </div>

        {/* 分镜列表 */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
            {t('common.loading', '加载中…')}
          </div>
        ) : segments.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
            {t('segmentPicker.noSegments', '该故事暂无分镜')}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {segments.map(seg => {
              const isBound = (
                (bindField === 'image' && seg.firstFrameImage === assetUrl) ||
                (bindField === 'voice' && seg.narrationAudioStoragePath === assetUrl) ||
                (bindField === 'bgm' && seg.bgmStoragePath === assetUrl)
              );
              return (
                <div
                  key={seg.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 12px', borderRadius: 8,
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-secondary)',
                  }}
                >
                  <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <strong>#{seg.sequenceOrder + 1}</strong> {seg.content.slice(0, 60)}
                  </span>
                  {isBound ? (
                    <span style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                      <Check size={14} /> {t('segmentPicker.bound', '已绑定')}
                    </span>
                  ) : (
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={binding === seg.id}
                      onClick={() => handleBind(seg)}
                      style={{ padding: '4px 10px', fontSize: 12 }}
                    >
                      {binding === seg.id ? '...' : (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Send size={12} /> {t('segmentPicker.bind', '绑定')}
                        </span>
                      )}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
