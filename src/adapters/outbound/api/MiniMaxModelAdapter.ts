import type { IModelManagementPort, ModelInfo, ModelListResult } from '../../../domain/ports/OutboundPorts';
import { ApiConfigStore } from '../config/ApiConfigStore';
import axios from 'axios';

export class MiniMaxModelAdapter implements IModelManagementPort {

  /**
   * List Models — GET /anthropic/v1/models
   * Note: Uses Authorization: Bearer header (X-Api-Key not allowed by CORS)
   */
  async listModels(limit?: number, afterId?: string): Promise<ModelListResult> {
    const config = ApiConfigStore.load();
    if (!config.minimaxApiKey) {
      throw new Error('API Key not configured — cannot list models');
    }

    const baseUrl = config.minimaxAnthropicBaseUrl.replace(/\/+$/, '');

    const params: Record<string, unknown> = {};
    if (limit) params.limit = limit;
    if (afterId) params.after_id = afterId;

    const response = await axios.get(`${baseUrl}/v1/models`, {
      params,
      headers: {
        Authorization: `Bearer ${config.minimaxApiKey}`,
      },
    });

    const data = response.data;

    const models: ModelInfo[] = (data?.data || []).map((m: Record<string, unknown>) => ({
      id: m.id as string,
      createdAt: m.created_at as string,
      displayName: (m.display_name || m.id) as string,
      type: (m.type || 'text') as string,
    }));

    return {
      models,
      firstId: data?.first_id,
      lastId: data?.last_id,
      hasMore: data?.has_more || false,
    };
  }

  /**
   * Retrieve Model — GET /anthropic/v1/models/{model_id}
   * Note: Uses Authorization: Bearer header (not X-Api-Key)
   */
  async retrieveModel(modelId: string): Promise<ModelInfo> {
    const config = ApiConfigStore.load();
    if (!config.minimaxApiKey) {
      throw new Error('API Key not configured — cannot retrieve model');
    }

    const baseUrl = config.minimaxAnthropicBaseUrl.replace(/\/+$/, '');

    const response = await axios.get(`${baseUrl}/v1/models/${encodeURIComponent(modelId)}`, {
      headers: {
        Authorization: `Bearer ${config.minimaxApiKey}`,
      },
    });

    const m = response.data;

    return {
      id: m.id,
      createdAt: m.created_at,
      displayName: m.display_name || m.id,
      type: m.type || 'text',
    };
  }
}
