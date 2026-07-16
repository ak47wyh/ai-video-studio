/**
 * useImageModels — 图片模型选择 Hook
 *
 * 设计目标(对应 Image_Generation_Model_Style_Design.md §5.2):
 *   1. 按激活平台 + 当前 Tab(t2i/i2i)从注册表读取并过滤可用模型
 *   2. 返回当前选中模型的描述符,供 UI 层基于能力标志联动风格/尺寸/数量
 *   3. 当选中模型不在过滤后列表中(如切换 Tab/平台),自动回退到推荐模型
 *
 * 联动重置(风格/尺寸/数量)不在此 Hook 内实现,由 ImageLab 基于
 * `currentModel.capabilities` 在 `handleModelChange` 中统一处理,
 * 避免与多个 useState 产生耦合。
 *
 * 用法示例:
 *   ```ts
 *   const { models, currentModel, fallbackModelId } = useImageModels(activePlatform, 't2i', model);
 *   if (!currentModel) setModel(fallbackModelId);
 *   ```
 */

import { useMemo } from 'react';
import {
  getImageModels,
  type ImageModelDescriptor,
} from '../../domain/services/platformCapabilities';
import type { PlatformId } from '../../domain/entities/platform';

export interface UseImageModelsResult {
  /** 当前平台 + Tab 过滤后的模型列表(已按 recommended 排序) */
  models: ImageModelDescriptor[];
  /** 当前选中模型描述符(若 currentModelId 不在列表中则为 undefined) */
  currentModel: ImageModelDescriptor | undefined;
  /** 推荐模型 ID(用于 currentModel 缺失时回退) */
  fallbackModelId: string;
}

/**
 * 按 Tab 能力过滤模型。
 * - T2I:`capabilities.t2i === true`
 * - I2I:`capabilities.i2i === true`
 */
function filterByTab(models: ImageModelDescriptor[], tab: 't2i' | 'i2i'): ImageModelDescriptor[] {
  return models.filter(m => (tab === 't2i' ? m.capabilities.t2i : m.capabilities.i2i));
}

export function useImageModels(
  activePlatform: PlatformId,
  tab: 't2i' | 'i2i',
  currentModelId: string,
): UseImageModelsResult {
  const models = useMemo(
    () => filterByTab(getImageModels(activePlatform), tab),
    [activePlatform, tab],
  );

  const currentModel = useMemo(
    () => models.find(m => m.id === currentModelId),
    [models, currentModelId],
  );

  // 回退顺序:推荐模型 → 列表首个 → 空字符串
  const fallbackModelId = useMemo(() => {
    const recommended = models.find(m => m.recommended);
    if (recommended) return recommended.id;
    return models[0]?.id ?? '';
  }, [models]);

  return { models, currentModel, fallbackModelId };
}
