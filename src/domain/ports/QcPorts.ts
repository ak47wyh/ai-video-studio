// ===== P2-8 成片 QC 质检端口 =====

/** 媒体探测结果 */
export interface MediaProbeResult {
  durationSec: number;
  width: number;
  height: number;
}

/** 静音段（秒） */
export interface QcSilenceSegment {
  startSec: number;
  endSec: number;
}

/** 黑帧段（秒） */
export interface QcBlackSegment {
  startSec: number;
  endSec: number;
}

/** 音量检测结果 */
export interface QcLoudnessResult {
  meanVolumeDb: number;
  maxVolumeDb: number;
}

/** QC 媒体探测能力（由 FFmpegAdapter 实现，不引新依赖） */
export interface IQcMediaPort {
  /** 探测时长/分辨率（基于 ffmpeg -i 输出解析） */
  probe(input: Blob): Promise<MediaProbeResult>;
  /** 检测静音段（silencedetect） */
  detectSilence(input: Blob): Promise<QcSilenceSegment[]>;
  /** 检测黑帧段（blackdetect） */
  detectBlackFrames(input: Blob): Promise<QcBlackSegment[]>;
  /** 检测音量（volumedetect） */
  detectLoudness(input: Blob): Promise<QcLoudnessResult>;
}

export type QcSeverity = 'error' | 'warning' | 'info';

export type QcRecommendation = 'ok' | 'review' | 'regenerate';

export interface QcIssue {
  check: string;
  severity: QcSeverity;
  message: string;
}

export interface QcReport {
  /** 是否有 error 级问题（warning 不视为失败） */
  passed: boolean;
  /** 综合建议：ok / review（有 warning）/ regenerate（有 error） */
  recommendation: QcRecommendation;
  issues: QcIssue[];
  meta: {
    durationSec?: number;
    width?: number;
    height?: number;
    checkedAt: number;
  };
}

/** QC 检测输入 */
export interface QcInput {
  video: Blob;
  /** 期望时长（秒），偏差 > 15% 判 error */
  expectedDurationSec?: number;
  /** 期望分辨率（不匹配判 warning） */
  expectedWidth?: number;
  expectedHeight?: number;
  /** 字幕最后一条结束时间（秒），超出视频时长判 error */
  subtitleEndSec?: number;
  /** 单段静音阈值（秒），默认 1.5 */
  silenceThresholdSec?: number;
  /** 静音总占比上限，默认 3%（超出判 error） */
  silenceRatioLimit?: number;
  /** 黑帧单段阈值（秒），默认 1（超出判 warning） */
  blackThresholdSec?: number;
  /** 音量峰值下限（dB），默认 -25（过低判 error） */
  minMaxVolumeDb?: number;
}
