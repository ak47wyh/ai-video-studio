/**
 * InspectorPanel —— 剪辑工作台右侧属性面板
 *
 * 显示当前选中 clip 的属性：
 * - 起始时间 / 时长
 * - 入点 / 出点（秒）
 * - 转场类型（下拉）
 * - 文本（字幕轨用）
 *
 * 所有修改通过 onPatch(clipId, patch) 回调上抛。
 */

import React from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TimelineClip, TransitionType } from '../../../domain/ports/PostProcessPorts';
import { normalizeTransition } from '../../../domain/ports/PostProcessPorts';
import { TEXT_LIMITS } from '../../../domain/constants/textLimits';

const TRANSITIONS: Array<{ value: TransitionType | 'none'; label: string }> = [
  { value: 'none', label: '无' },
  { value: 'fade', label: '淡入淡出' },
  { value: 'fadeblack', label: '黑场过渡' },
  { value: 'fadewhite', label: '白场过渡' },
  { value: 'wipeleft', label: '左擦除' },
  { value: 'wiperight', label: '右擦除' },
  { value: 'slideup', label: '上滑' },
  { value: 'slidedown', label: '下滑' },
  { value: 'circlecrop', label: '圆形裁切' },
];

interface InspectorPanelProps {
  clip: TimelineClip | null;
  onPatch: (clipId: string, patch: Partial<TimelineClip>) => void;
  onRemove: (clipId: string) => void;
}

export const InspectorPanel: React.FC<InspectorPanelProps> = ({ clip, onPatch, onRemove }) => {
  const { t } = useTranslation();

  if (!clip) {
    return (
      <div style={{
        width: 240, flexShrink: 0, padding: '1rem',
        background: 'rgba(0,0,0,0.2)', borderRadius: 'var(--radius-md)',
        color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center',
      }}>
        {t('editor.inspector.empty', '选中片段以编辑属性')}
      </div>
    );
  }

  const inPointSec = clip.sourceRef?.inPointSec ?? 0;
  const outPointSec = clip.sourceRef?.outPointSec ?? (clip.duration / 1000);
  // T-1：转场参数（兼容旧字符串字段迁移）
  const curTransition = normalizeTransition(clip.transition);

  const patchSourceRef = (patch: Partial<NonNullable<TimelineClip['sourceRef']>>) => {
    if (!clip.sourceRef) return;
    onPatch(clip.id, { sourceRef: { ...clip.sourceRef, ...patch } });
  };

  return (
    <div style={{
      width: 240, flexShrink: 0, padding: '0.75rem',
      background: 'rgba(0,0,0,0.2)', borderRadius: 'var(--radius-md)',
      display: 'flex', flexDirection: 'column', gap: '0.75rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>
          {t('editor.inspector.title', '片段属性')}
        </span>
        <button
          className="btn btn-secondary"
          style={{ padding: '0.2rem 0.4rem', border: 'none' }}
          onClick={() => onRemove(clip.id)}
          title={t('editor.inspector.remove', '删除')}
        >
          <Trash2 size={12} />
        </button>
      </div>

      <Field label={t('editor.inspector.startTime', '起始时间 (s)')}>
        <input
          type="number"
          className="input"
          step={0.1}
          value={(clip.startTime / 1000).toFixed(2)}
          onChange={e => onPatch(clip.id, { startTime: Math.max(0, parseFloat(e.target.value) * 1000) })}
        />
      </Field>

      <Field label={t('editor.inspector.duration', '时长 (s)')}>
        <input
          type="number"
          className="input"
          step={0.1}
          value={(clip.duration / 1000).toFixed(2)}
          onChange={e => onPatch(clip.id, { duration: Math.max(100, parseFloat(e.target.value) * 1000) })}
        />
      </Field>

      {clip.sourceRef && (clip.sourceRef.kind === 'videoTask' || clip.sourceRef.kind === 'savedVideo' || clip.sourceRef.kind === 'finalCut') && (
        <>
          <Field label={t('editor.inspector.inPoint', '入点 (s)')}>
            <input
              type="number"
              className="input"
              step={0.1}
              min={0}
              value={inPointSec.toFixed(2)}
              onChange={e => patchSourceRef({ inPointSec: Math.max(0, parseFloat(e.target.value)) })}
            />
          </Field>
          <Field label={t('editor.inspector.outPoint', '出点 (s)')}>
            <input
              type="number"
              className="input"
              step={0.1}
              value={outPointSec.toFixed(2)}
              onChange={e => patchSourceRef({ outPointSec: Math.max(0, parseFloat(e.target.value)) })}
            />
          </Field>
        </>
      )}

      <Field label={t('editor.inspector.transition', '转场')}>
        <select
          className="input"
          value={curTransition?.type ?? 'none'}
          onChange={e => {
            const type = e.target.value as TransitionType;
            onPatch(clip.id, {
              transition: {
                type,
                durationSec: type === 'none' ? 0.5 : (curTransition?.durationSec ?? 0.5),
              },
            });
          }}
        >
          {TRANSITIONS.map(tr => (
            <option key={tr.value} value={tr.value}>{tr.label}</option>
          ))}
        </select>
        {curTransition && curTransition.type !== 'none' && (
          <Field label={t('editor.inspector.transitionDuration', '转场时长 (s)')}>
            <input
              type="range"
              className="input"
              min={0.1}
              max={2}
              step={0.1}
              value={curTransition.durationSec}
              onChange={e => onPatch(clip.id, {
                transition: { type: curTransition.type, durationSec: Number(e.target.value) },
              })}
            />
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {curTransition.durationSec.toFixed(1)}s
            </div>
          </Field>
        )}
      </Field>

      {clip.type === 'subtitle' && (
        <Field label={t('editor.inspector.text', '字幕文本')}>
          <textarea
            className="input"
            rows={3}
            value={clip.text ?? ''}
            onChange={e => onPatch(clip.id, { text: e.target.value })}
            placeholder={t('editor.inspector.textPlaceholder', '输入字幕文本...')}
            maxLength={TEXT_LIMITS.SUBTITLE_CLIP_TEXT_MAX}
          />
        </Field>
      )}

      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
        <div>{t('editor.inspector.source', '来源')}: {clip.sourceRef?.kind ?? clip.source ?? '—'}</div>
        {clip.sourceRef?.storagePath && (
          <div style={{ wordBreak: 'break-all', marginTop: '0.2rem', opacity: 0.6 }}>
            {clip.sourceRef.storagePath}
          </div>
        )}
      </div>
    </div>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>{label}</label>
    {children}
  </div>
);
