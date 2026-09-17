import type {
  IQcMediaPort,
  QcInput,
  QcIssue,
  QcReport,
} from '../ports/QcPorts';
import type { ILoggerPort } from '../ports/CrossCuttingPorts';

export interface QcServiceDeps {
  qcMedia: IQcMediaPort;
  logger: ILoggerPort;
}

const DEFAULT_SILENCE_THRESHOLD_SEC = 1.5;
const DEFAULT_SILENCE_RATIO_LIMIT = 0.03;
const DEFAULT_BLACK_THRESHOLD_SEC = 1;
const DEFAULT_MIN_MAX_VOLUME_DB = -25;
const DURATION_TOLERANCE = 0.15;

/**
 * P2-8 成片 QC 质检服务
 *
 * 自动检查成片：时长/分辨率/黑帧/静音段/字幕同步/音量峰值，
 * 输出 QC 报告与"可忽略(review)/需重生成(regenerate)"建议。
 * 媒体探测委托 IQcMediaPort（FFmpegAdapter 实现），判定逻辑为纯函数，可独立测试。
 */
export class QcService {
  private readonly deps: QcServiceDeps;

  constructor(deps: QcServiceDeps) {
    this.deps = deps;
  }

  /** 运行完整 QC：探测媒体 + 逐项判定 + 综合建议 */
  async runQc(input: QcInput): Promise<QcReport> {
    const { qcMedia, logger } = this.deps;
    const issues: QcIssue[] = [];
    const meta: QcReport['meta'] = { checkedAt: Date.now() };

    let probe: { durationSec: number; width: number; height: number } | null = null;
    try {
      probe = await qcMedia.probe(input.video);
      meta.durationSec = probe.durationSec;
      meta.width = probe.width;
      meta.height = probe.height;
      this.push(issues, QcService.evaluateDuration(probe.durationSec, input.expectedDurationSec));
      this.push(issues, QcService.evaluateResolution(probe.width, probe.height, input.expectedWidth, input.expectedHeight));
    } catch (e) {
      this.push(issues, {
        check: 'probe',
        severity: 'error',
        message: `无法读取成片媒体信息：${e instanceof Error ? e.message : String(e)}`,
      });
    }

    if (probe) {
      // 静音检测
      try {
        const silence = await qcMedia.detectSilence(input.video);
        this.push(issues, QcService.evaluateSilence(silence, probe.durationSec, {
          thresholdSec: input.silenceThresholdSec ?? DEFAULT_SILENCE_THRESHOLD_SEC,
          ratioLimit: input.silenceRatioLimit ?? DEFAULT_SILENCE_RATIO_LIMIT,
        }));
      } catch (e) {
        this.push(issues, QcService.wrapProbeError('silence', e));
      }
      // 黑帧检测
      try {
        const black = await qcMedia.detectBlackFrames(input.video);
        this.push(issues, QcService.evaluateBlackFrames(black, input.blackThresholdSec ?? DEFAULT_BLACK_THRESHOLD_SEC));
      } catch (e) {
        this.push(issues, QcService.wrapProbeError('black_frames', e));
      }
      // 音量检测
      try {
        const loudness = await qcMedia.detectLoudness(input.video);
        this.push(issues, QcService.evaluateLoudness(loudness, input.minMaxVolumeDb ?? DEFAULT_MIN_MAX_VOLUME_DB));
      } catch (e) {
        this.push(issues, QcService.wrapProbeError('loudness', e));
      }
      // 字幕同步（纯逻辑判定）
      if (input.subtitleEndSec !== undefined) {
        this.push(issues, QcService.evaluateSubtitleSync(input.subtitleEndSec, probe.durationSec));
      }
    }

    const hasError = issues.some(i => i.severity === 'error');
    const hasWarning = issues.some(i => i.severity === 'warning');
    logger.info('qc report generated', {
      service: 'QcService',
      method: 'runQc',
      passed: !hasError,
      recommendation: hasError ? 'regenerate' : hasWarning ? 'review' : 'ok',
      issueCount: issues.length,
    });

    return {
      passed: !hasError,
      recommendation: hasError ? 'regenerate' : hasWarning ? 'review' : 'ok',
      issues,
      meta,
    };
  }

  private push(issues: QcIssue[], issue: QcIssue | null): void {
    if (issue) issues.push(issue);
  }

  private static wrapProbeError(check: string, e: unknown): QcIssue {
    return {
      check,
      severity: 'warning',
      message: `检测失败（可忽略，建议人工复核）：${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // ===== 判定纯函数（可独立测试） =====

  /** 时长偏差 > 15% 判 error */
  static evaluateDuration(actualSec: number, expectedSec?: number): QcIssue | null {
    if (expectedSec === undefined) return null;
    const diff = Math.abs(actualSec - expectedSec) / expectedSec;
    if (diff > DURATION_TOLERANCE) {
      return {
        check: 'duration',
        severity: 'error',
        message: `时长偏差 ${(diff * 100).toFixed(0)}%（实际 ${actualSec.toFixed(1)}s / 期望 ${expectedSec.toFixed(1)}s）`,
      };
    }
    return null;
  }

  /** 分辨率不匹配判 warning（可裁剪修复，不强制重生成） */
  static evaluateResolution(actualW: number, actualH: number, expectedW?: number, expectedH?: number): QcIssue | null {
    if (expectedW === undefined || expectedH === undefined) return null;
    if (actualW !== expectedW || actualH !== expectedH) {
      return {
        check: 'resolution',
        severity: 'warning',
        message: `分辨率不符（实际 ${actualW}x${actualH} / 期望 ${expectedW}x${expectedH}）`,
      };
    }
    return null;
  }

  /** 单段静音超阈值或总占比超限判 error */
  static evaluateSilence(
    segments: Array<{ startSec: number; endSec: number }>,
    durationSec: number,
    opts: { thresholdSec: number; ratioLimit: number },
  ): QcIssue | null {
    if (segments.length === 0 || durationSec <= 0) return null;
    const total = segments.reduce((s, seg) => s + (seg.endSec - seg.startSec), 0);
    const ratio = total / durationSec;
    const longSeg = segments.find(seg => seg.endSec - seg.startSec > opts.thresholdSec);
    if (ratio > opts.ratioLimit || longSeg) {
      return {
        check: 'silence',
        severity: 'error',
        message: `检测到异常静音：${segments.length} 段共 ${total.toFixed(1)}s（占 ${(ratio * 100).toFixed(1)}%）`,
      };
    }
    return null;
  }

  /** 黑帧段超阈值判 warning（转场黑帧常见，建议复核） */
  static evaluateBlackFrames(segments: Array<{ startSec: number; endSec: number }>, thresholdSec: number): QcIssue | null {
    const long = segments.find(seg => seg.endSec - seg.startSec > thresholdSec);
    if (long) {
      return {
        check: 'black_frames',
        severity: 'warning',
        message: `检测到黑帧段 ${(long.endSec - long.startSec).toFixed(1)}s（${long.startSec.toFixed(1)}s → ${long.endSec.toFixed(1)}s）`,
      };
    }
    return null;
  }

  /** 音量峰值过低（可能全程静音/音量异常）判 error */
  static evaluateLoudness(
    result: { meanVolumeDb: number; maxVolumeDb: number },
    minMaxVolumeDb: number,
  ): QcIssue | null {
    if (result.maxVolumeDb < minMaxVolumeDb) {
      return {
        check: 'loudness',
        severity: 'error',
        message: `音量峰值过低（max ${result.maxVolumeDb.toFixed(1)}dB，低于 ${minMaxVolumeDb}dB），疑似静音或音量异常`,
      };
    }
    return null;
  }

  /** 字幕最后结束时间超出视频时长判 error */
  static evaluateSubtitleSync(subtitleEndSec: number, durationSec: number): QcIssue | null {
    if (subtitleEndSec > durationSec + 0.5) {
      return {
        check: 'subtitle_sync',
        severity: 'error',
        message: `字幕超出视频时长 ${(subtitleEndSec - durationSec).toFixed(1)}s（字幕 ${subtitleEndSec.toFixed(1)}s / 视频 ${durationSec.toFixed(1)}s）`,
      };
    }
    return null;
  }
}
