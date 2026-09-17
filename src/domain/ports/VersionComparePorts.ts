// ===== P2-10 同源版本对比端口 =====

import type { FinalCut } from '../entities/models';

/** 版本树节点 */
export interface VersionNode {
  cut: FinalCut;
  /** 子版本（回改衍生，按 createdAt 升序） */
  children: VersionNode[];
  /** 树深度（根为 0） */
  depth: number;
}

/** 单版本成本摘要（按 pipelineTaskId 归因，口径：调用次数与 Token 用量，不估算金额） */
export interface VersionCostSummary {
  /** 该版本生成链路的总调用次数 */
  callCount: number;
  /** 文本类调用 Token 总数 */
  tokenCount: number;
  /** 按模型分组（模型 → 调用次数） */
  byModel: Record<string, number>;
  /** 是否有关联 pipelineTaskId（无则成本不可归因） */
  attributable: boolean;
}
