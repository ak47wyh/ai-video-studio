/**
 * SubtitleStyleEditor —— 字幕样式编辑器（SU-2）
 *
 * 预设选择（抖音/B站/电影感）+ 字体/字号/颜色/加粗/描边/位置/边距，
 * Canvas 实时预览示例字幕，产出 SubtitleStyle。
 */

import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { SubtitleStyle } from '../../domain/ports/PostProcessPorts';
import { SUBTITLE_PRESETS, SUBTITLE_PRESET_IDS, matchesPreset } from '../../domain/data/subtitlePresets';

const FONTS = ['Arial', 'Georgia', 'PingFang SC', 'Microsoft YaHei', 'Times New Roman', 'Courier New'];
const POSITIONS: Array<{ id: NonNullable<SubtitleStyle['position']>; labelKey: string }> = [
  { id: 'top', labelKey: 'subtitleStyleEditor.positionTop' },
  { id: 'center', labelKey: 'subtitleStyleEditor.positionCenter' },
  { id: 'bottom', labelKey: 'subtitleStyleEditor.positionBottom' },
];

interface SubtitleStyleEditorProps {
  value: SubtitleStyle;
  onChange: (style: SubtitleStyle) => void;
}

export const SubtitleStyleEditor: React.FC<SubtitleStyleEditorProps> = ({ value, onChange }) => {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const set = (patch: Partial<SubtitleStyle>) => onChange({ ...value, ...patch });

  // 实时预览：Canvas 渲染示例字幕
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let ctx;
    try { ctx = canvas.getContext('2d'); } catch { ctx = null; }
    if (!ctx) return;
    const W = 320;
    const H = 90;
    canvas.width = W;
    canvas.height = H;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);
    const fontSize = value.fontSize ?? 24;
    const fam = value.fontFamily ?? 'Arial';
    ctx.font = `${value.bold ? 'bold ' : ''}${fontSize}px ${fam}`;
    ctx.textAlign = 'center';
    const text = t('subtitleStyleEditor.previewText', '示例字幕 Preview');
    const y = value.position === 'top' ? fontSize + 14 : value.position === 'center' ? H / 2 + fontSize / 3 : H - (value.marginV ?? 40) + fontSize / 3;
    const primary = value.primaryColor ?? '#FFFFFF';
    const outline = value.outlineColor ?? '#000000';
    const ow = Math.max(0, Math.min(4, value.outlineWidth ?? 2));
    ctx.lineWidth = ow * 2;
    ctx.strokeStyle = outline;
    ctx.strokeText(text, W / 2, y);
    ctx.fillStyle = primary;
    ctx.fillText(text, W / 2, y);
  }, [value, t]);

  const currentPresetId = SUBTITLE_PRESET_IDS.find(id => matchesPreset(value, id));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.8rem' }}>
      <div>
        <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
          {t('subtitleStyleEditor.presetLabel', '预设')}
        </label>
        <select
          id="subtitle-style-preset"
          className="input"
          value={currentPresetId ?? ''}
          onChange={e => {
            const id = e.target.value as keyof typeof SUBTITLE_PRESETS;
            if (SUBTITLE_PRESETS[id]) set({ ...SUBTITLE_PRESETS[id] });
          }}
        >
          <option value="">{t('subtitleStyleEditor.custom', '自定义')}</option>
          {SUBTITLE_PRESET_IDS.map(id => (
            <option key={id} value={id}>{t(`subtitleStyleEditor.presetOption.${id}`)}</option>
          ))}
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
            {t('subtitleStyleEditor.font', '字体')}
          </label>
          <select id="subtitle-style-font" className="input" value={value.fontFamily ?? 'Arial'} onChange={e => set({ fontFamily: e.target.value })}>
            {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
            {t('subtitleStyleEditor.fontSize', '字号')} {value.fontSize ?? 24}
          </label>
          <input
            id="subtitle-style-font-size"
            className="input"
            type="range" min={14} max={48} step={1}
            value={value.fontSize ?? 24}
            onChange={e => set({ fontSize: Number(e.target.value) })}
            style={{ width: '100%' }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
            {t('subtitleStyleEditor.primaryColor', '字体颜色')}
          </label>
          <input
            type="color"
            value={value.primaryColor ?? '#FFFFFF'}
            onChange={e => set({ primaryColor: e.target.value })}
            style={{ width: '100%', height: 30, padding: 0, border: 'none', background: 'transparent' }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
            {t('subtitleStyleEditor.outlineColor', '描边颜色')}
          </label>
          <input
            type="color"
            value={value.outlineColor ?? '#000000'}
            onChange={e => set({ outlineColor: e.target.value })}
            style={{ width: '100%', height: 30, padding: 0, border: 'none', background: 'transparent' }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
            {t('subtitleStyleEditor.outlineWidth', '描边粗细')} {value.outlineWidth ?? 2}
          </label>
          <input
            className="input"
            type="range" min={0} max={4} step={1}
            value={value.outlineWidth ?? 2}
            onChange={e => set({ outlineWidth: Number(e.target.value) })}
            style={{ width: '100%' }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
            {t('subtitleStyleEditor.position', '位置')}
          </label>
          <select id="subtitle-style-position" className="input" value={value.position ?? 'bottom'} onChange={e => set({ position: e.target.value as SubtitleStyle['position'] })}>
            {POSITIONS.map(p => <option key={p.id} value={p.id}>{t(p.labelKey)}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
            {t('subtitleStyleEditor.marginV', '底部边距')} {value.marginV ?? 40}
          </label>
          <input
            className="input"
            type="range" min={10} max={120} step={5}
            value={value.marginV ?? 40}
            onChange={e => set({ marginV: Number(e.target.value) })}
            style={{ width: '100%' }}
          />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem' }}>
          <input id="subtitle-style-bold" type="checkbox" checked={value.bold ?? false} onChange={e => set({ bold: e.target.checked })} />
          {t('subtitleStyleEditor.bold', '加粗')}
        </label>
      </div>

      <div>
        <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
          {t('subtitleStyleEditor.preview', '实时预览')}
        </label>
        <canvas ref={canvasRef} style={{ width: '100%', borderRadius: 8, background: '#000' }} />
      </div>
    </div>
  );
};
