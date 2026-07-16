import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ImageModelDescriptor } from '../../domain/services/platformCapabilities';

/**
 * 图片高级设置值。
 *
 * 注:`style` 字段已提升为一级控件(`ImageStyleSelector`),
 * 不再属于高级设置范畴。
 */
export interface ImageAdvancedSettingsValue {
  /** 生成数量(1..maxN) */
  n: number;
  /** 随机种子(留空则随机) */
  seed: string;
  /** 是否添加水印 */
  watermark: boolean;
  /** 是否启用自定义尺寸 */
  customSizeEnabled: boolean;
  /** 自定义宽度 */
  customWidth: number;
  /** 自定义高度 */
  customHeight: number;
}

interface ImageAdvancedSettingsProps {
  value: ImageAdvancedSettingsValue;
  onChange: (value: ImageAdvancedSettingsValue) => void;
  /** 当前模型描述符(替代旧 model: ImageModel,基于能力标志控制显示) */
  model: ImageModelDescriptor;
}

/** 生成数量候选值(受 model.maxN 限制) */
const N_CANDIDATES = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * 高级设置折叠面板:生成数量、种子、水印、自定义尺寸。
 *
 * v2.0 改造(对应 Image_Generation_Model_Style_Design.md §5.6):
 *   - Props.model 从 `ImageModel` 改为 `ImageModelDescriptor`
 *   - 画风控件移出,由 `ImageStyleSelector` 一级控件承担
 *   - 自定义尺寸仅当 `model.capabilities.customSize` 显示
 *   - 生成数量上限 = `model.maxN`
 */
export const ImageAdvancedSettings: React.FC<ImageAdvancedSettingsProps> = ({
  value,
  onChange,
  model,
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const supportsCustomSize = model.capabilities.customSize;
  const maxN = model.maxN;

  const update = (patch: Partial<ImageAdvancedSettingsValue>) => {
    onChange({ ...value, ...patch });
  };

  return (
    <div>
      <button
        className="btn btn-secondary"
        style={{ fontSize: '0.8rem' }}
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        {' '}
        {t('imageLab.advancedSettings', '高级设置')}
      </button>
      {expanded && (
        <div style={{
          marginTop: '0.75rem',
          padding: '1rem',
          background: 'rgba(0,0,0,0.15)',
          borderRadius: 'var(--radius-md)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '1.5rem',
        }}>
          {/* 生成数量(上限受 model.maxN 约束) */}
          <div>
            <label className="form-label" style={{ fontSize: '0.85rem' }}>
              {t('imageLab.generateCount', '生成数量')}
            </label>
            <select
              className="form-select"
              style={{ width: '80px' }}
              value={Math.min(value.n, maxN)}
              onChange={e => update({ n: Number(e.target.value) })}
            >
              {N_CANDIDATES.filter(n => n <= maxN).map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>

          {/* 随机种子 */}
          <div>
            <label className="form-label" style={{ fontSize: '0.85rem' }}>
              {t('imageLab.seed', '随机种子 (可复现)')}
            </label>
            <input
              className="form-input"
              type="number"
              placeholder={t('imageLab.seedPlaceholder', '留空则随机')}
              value={value.seed}
              onChange={e => update({ seed: e.target.value })}
              style={{ width: '140px', fontSize: '0.85rem' }}
            />
          </div>

          {/* 水印 */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem',
              fontSize: '0.85rem',
              paddingTop: '1.5rem',
            }}
          >
            <input
              type="checkbox"
              checked={value.watermark}
              onChange={e => update({ watermark: e.target.checked })}
              style={{ accentColor: 'var(--primary-color)' }}
            />
            {t('imageLab.watermark', '添加水印')}
          </label>

          {/* 自定义尺寸(仅当模型支持) */}
          {supportsCustomSize && (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.5rem' }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  fontSize: '0.85rem',
                  paddingBottom: '0.4rem',
                }}
              >
                <input
                  type="checkbox"
                  checked={value.customSizeEnabled}
                  onChange={e => update({ customSizeEnabled: e.target.checked })}
                  style={{ accentColor: 'var(--primary-color)' }}
                />
                {t('imageLab.customSize', '自定义尺寸')}
              </label>
              {value.customSizeEnabled && (
                <>
                  <input
                    className="form-input"
                    type="number"
                    min={512}
                    max={2048}
                    step={8}
                    placeholder={t('imageLab.width', '宽')}
                    value={value.customWidth}
                    onChange={e => update({ customWidth: Number(e.target.value) })}
                    style={{ width: '70px', fontSize: '0.85rem' }}
                  />
                  <span style={{ paddingBottom: '0.4rem' }}>×</span>
                  <input
                    className="form-input"
                    type="number"
                    min={512}
                    max={2048}
                    step={8}
                    placeholder={t('imageLab.height', '高')}
                    value={value.customHeight}
                    onChange={e => update({ customHeight: Number(e.target.value) })}
                    style={{ width: '70px', fontSize: '0.85rem' }}
                  />
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
