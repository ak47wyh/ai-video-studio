/**
 * ImageStyleSelector — 图片风格选择器
 *
 * 设计目标(对应 Image_Generation_Model_Style_Design.md §5.4):
 *   - 从 `ImageAdvancedSettings` 折叠面板提升为一级控件
 *   - 仅当 `supported === true`(即当前模型 `capabilities.style === true`)时渲染
 *   - 10 种统一抽象风格,UI 层不感知平台差异(由 Adapter 内部映射)
 *
 * 替代旧版 ImageAdvancedSettings 内部硬编码的 7 种风格下拉框。
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { IMAGE_STYLE_PRESETS, type ImageStyleKey } from '../../domain/data/imageStylePresets';

export interface ImageStyleSelectorProps {
  /** 当前风格 key */
  value: ImageStyleKey;
  /** 切换风格回调 */
  onChange: (style: ImageStyleKey) => void;
  /** 当前模型是否支持风格(不支持则隐藏整个控件) */
  supported: boolean;
  /** 是否禁用 */
  disabled?: boolean;
}

export const ImageStyleSelector: React.FC<ImageStyleSelectorProps> = ({
  value,
  onChange,
  supported,
  disabled = false,
}) => {
  const { t } = useTranslation();
  if (!supported) return null;

  return (
    <div className="lab-model-config-item" style={{ minWidth: '140px' }}>
      <label className="form-label">{t('imageLab.style', '图片风格')}</label>
      <select
        className="form-select"
        value={value}
        onChange={e => onChange(e.target.value as ImageStyleKey)}
        disabled={disabled}
        aria-label={t('imageLab.style', '图片风格')}
      >
        {IMAGE_STYLE_PRESETS.map(s => (
          <option key={s.key} value={s.key}>
            {t(s.label)}
          </option>
        ))}
      </select>
    </div>
  );
};
