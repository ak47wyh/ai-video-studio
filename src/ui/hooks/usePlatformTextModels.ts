/**
 * usePlatformTextModels — 平台感知的文本模型列表 Hook
 *
 * 根据当前激活平台返回可用的文本模型列表和默认模型。
 * 平台切换时自动更新。
 */
import { useState, useEffect, useCallback } from 'react';
import type { TextModel } from '../../domain/ports/OutboundPorts';
import type { TextModelDescriptor } from '../../domain/services/platformCapabilities';
import { usePlatformCapabilities } from './usePlatformCapabilities';
import { modelRegistry } from '../../dependencies';

export interface UsePlatformTextModelsResult {
  /** 当前平台可用的文本模型列表 */
  textModels: TextModelDescriptor[];
  /** 当前平台的默认文本模型 ID */
  defaultModel: TextModel;
  /** 当前激活平台 ID */
  activePlatform: string;
}

export function usePlatformTextModels(): UsePlatformTextModelsResult {
  const { activePlatform } = usePlatformCapabilities();
  const [textModels, setTextModels] = useState<TextModelDescriptor[]>([]);
  const [defaultModel, setDefaultModel] = useState<TextModel>('MiniMax-M3');

  const refresh = useCallback(() => {
    const models = modelRegistry.getPlatformTextModels();
    const defaultId = modelRegistry.getDefaultTextModel() as TextModel;
    setTextModels(models);
    setDefaultModel(defaultId);
  }, [activePlatform]);

  useEffect(() => {
    refresh();
  }, [activePlatform, refresh]);

  return { textModels, defaultModel, activePlatform };
}
