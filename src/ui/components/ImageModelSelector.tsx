/**
 * ImageModelSelector — 图片模型选择器
 *
 * 设计目标(对应 Image_Generation_Model_Style_Design.md §5.3):
 *   - 下拉框展示真实模型 ID + 中文标签 + 推荐徽标
 *   - 推荐模型置顶(由 useImageModels 已按 recommended 排序)
 *   - 选中后下方展示模型描述(供用户了解能力差异)
 *
 * 替代旧版硬编码 `<option value="image-01">` / `<option value="image-01-live">`。
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ImageModelDescriptor } from '../../domain/services/platformCapabilities';

export interface ImageModelSelectorProps {
  /** 当前平台 + Tab 过滤后的模型列表 */
  models: ImageModelDescriptor[];
  /** 当前选中模型 ID */
  value: string;
  /** 切换模型回调 */
  onChange: (modelId: string) => void;
  /** 是否禁用(如平台未就绪) */
  disabled?: boolean;
}

export const ImageModelSelector: React.FC<ImageModelSelectorProps> = ({
  models,
  value,
  onChange,
  disabled = false,
}) => {
  const { t } = useTranslation();
  const currentModel = models.find(m => m.id === value);

  return (
    <div className="lab-model-config-item" style={{ minWidth: '220px' }}>
      <label className="form-label">{t('imageLab.model', '生成模型')}</label>
      <select
        className="form-select"
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled || models.length === 0}
        aria-label={t('imageLab.model', '生成模型')}
      >
        {models.length === 0 && (
          <option value="">{t('imageLab.noModelAvailable', '当前平台无可用模型')}</option>
        )}
        {models.map(m => (
          <option key={m.id} value={m.id}>
            {m.label}
            {m.recommended ? ` ★` : ''}
            {' — '}
            {m.id}
          </option>
        ))}
      </select>
      {currentModel && (
        <p
          className="form-hint"
          style={{
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            marginTop: '0.25rem',
            lineHeight: 1.4,
          }}
        >
          {currentModel.description}
        </p>
      )}
    </div>
  );
};
