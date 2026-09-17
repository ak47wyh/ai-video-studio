import type { FinalCut } from '../entities/models';
import type { VersionCostSummary, VersionNode } from '../ports/VersionComparePorts';
import type { ICostMeter, ILoggerPort } from '../ports/CrossCuttingPorts';

export interface VersionCompareServiceDeps {
  costMeter: ICostMeter;
  logger: ILoggerPort;
}

/**
 * P2-10 同源版本对比服务
 *
 * - buildVersionTree：按 sourceVersionId 构建同源版本树（回改链）
 * - listVersionsByStory：同一故事下版本列表（version 升序）
 * - getVersionCost：按 pipelineTaskId 归因单版本成本（调用次数/Token，不估算金额）
 */
export class VersionCompareService {
  private readonly deps: VersionCompareServiceDeps;

  constructor(deps: VersionCompareServiceDeps) {
    this.deps = deps;
  }

  /** 构建版本树：根 = 无 sourceVersionId 或父缺失；children 按 createdAt 升序 */
  static buildVersionTree(cuts: FinalCut[]): VersionNode[] {
    const byId = new Map<string, FinalCut>();
    for (const cut of cuts) byId.set(cut.id, cut);

    const build = (cut: FinalCut, depth: number): VersionNode => {
      const children = cuts
        .filter(c => c.sourceVersionId === cut.id)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(c => build(c, depth + 1));
      return { cut, children, depth };
    };

    const roots = cuts
      .filter(c => !c.sourceVersionId || !byId.has(c.sourceVersionId))
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(c => build(c, 0));
    return roots;
  }

  /** 同一故事下版本列表（version 升序，无 version 的按 createdAt） */
  listVersionsByStory(cuts: FinalCut[], storyId: string): FinalCut[] {
    return cuts
      .filter(c => c.storyId === storyId)
      .sort((a, b) => (a.version ?? Number.MAX_SAFE_INTEGER) - (b.version ?? Number.MAX_SAFE_INTEGER) || a.createdAt - b.createdAt);
  }

  /** 单版本成本归因（口径：调用次数与 Token，不估算金额） */
  getVersionCost(pipelineTaskId?: string): VersionCostSummary {
    if (!pipelineTaskId) {
      return { callCount: 0, tokenCount: 0, byModel: {}, attributable: false };
    }
    const summary = this.deps.costMeter.getSummary({ pipelineTaskId });
    this.deps.logger.info('version cost queried', {
      service: 'VersionCompareService',
      method: 'getVersionCost',
      pipelineTaskId,
      callCount: summary.totalCalls,
      tokenCount: summary.totalTokens,
    });
    const byModel: Record<string, number> = {};
    for (const [model, stat] of Object.entries(summary.byModel)) {
      byModel[model] = stat.calls;
    }
    return {
      callCount: summary.totalCalls,
      tokenCount: summary.totalTokens,
      byModel,
      attributable: true,
    };
  }
}
