import type { FinalCutPipelineOptions } from '../entities/models';

/**
 * P4-2 质量闭环自动化：QC check → 确定性建议映射 + 自动重跑限流。
 * 判定逻辑为纯函数，可独立测试（与 QcService 同风格）。
 * 口径：只给"参数建议/人工核查"两类动作，只预填不强改；不估算金额。
 */

export interface QcSuggestion {
  action: 'rework' | 'manual';
  /** i18n key：qc.suggestion.* */
  hintKey: string;
  /** 预填参数（用户确认后才提交） */
  preset: Partial<FinalCutPipelineOptions>;
}

export interface QcSuggestionInput {
  /** 当前生成时长档位 */
  videoDuration?: 6 | 10;
  /** 当前生成配置（用于回填期望分辨率） */
  pipelineOptions?: FinalCutPipelineOptions;
}

/** error 级 check 的优先级：时长 > 字幕越界 > 静音段 */
const ERROR_PRIORITY = ['duration', 'subtitle_sync', 'silence'] as const;

export function buildSuggestion(issues: ReadonlyArray<{ check: string }>, opts?: QcSuggestionInput): QcSuggestion | null {
  if (issues.length === 0) return null;
  const checks = new Set(issues.map(i => i.check));
  const dur = opts?.videoDuration;

  for (const c of ERROR_PRIORITY) {
    if (!checks.has(c)) continue;
    if (c === 'duration') {
      if (dur !== 6) return { action: 'rework', hintKey: 'qc.suggestion.duration', preset: { videoDuration: 6 } };
      return { action: 'manual', hintKey: 'qc.suggestion.durationManual', preset: {} };
    }
    if (c === 'subtitle_sync') {
      if (dur === 10) return { action: 'rework', hintKey: 'qc.suggestion.subtitleSync', preset: { videoDuration: 6 } };
      return { action: 'manual', hintKey: 'qc.suggestion.subtitleSyncManual', preset: {} };
    }
    return { action: 'rework', hintKey: 'qc.suggestion.silence', preset: { includeNarration: false } };
  }

  if (checks.has('resolution')) {
    const res = opts?.pipelineOptions?.videoResolution;
    return res
      ? { action: 'rework', hintKey: 'qc.suggestion.resolution', preset: { videoResolution: res } }
      : { action: 'manual', hintKey: 'qc.suggestion.resolution', preset: {} };
  }
  if (checks.has('black_frames')) return { action: 'manual', hintKey: 'qc.suggestion.blackFrames', preset: {} };
  if (checks.has('loudness')) return { action: 'manual', hintKey: 'qc.suggestion.loudness', preset: {} };
  if (checks.has('probe')) return { action: 'rework', hintKey: 'qc.suggestion.probe', preset: {} };
  return { action: 'manual', hintKey: 'qc.suggestion.manual', preset: {} };
}

/** 自动重跑记录（按 storyId + 时间窗口） */
export interface ReworkRecord {
  storyId: string;
  at: number;
}

/** 同一故事自动重跑限流窗口：5 分钟（防误触烧额度，对齐 P3-3 成本治理） */
export const REWORK_WINDOW_MS = 5 * 60 * 1000;

export function shouldAllowRework(records: ReadonlyArray<ReworkRecord>, storyId: string, now: number): boolean {
  return !records.some(r => r.storyId === storyId && now - r.at < REWORK_WINDOW_MS);
}

export function recordRework(records: ReadonlyArray<ReworkRecord>, storyId: string, now: number): ReworkRecord[] {
  return [...records.filter(r => now - r.at < REWORK_WINDOW_MS), { storyId, at: now }];
}
