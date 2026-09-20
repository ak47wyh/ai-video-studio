import type {
  AiMetadata,
  PreflightInput,
  PreflightResult,
} from '../ports/CompliancePorts';
import type { ILoggerPort } from '../ports/CrossCuttingPorts';

export interface ComplianceServiceDeps {
  logger: ILoggerPort;
}

/** 平台发布规格（抖音/B站/通用） */
export interface PlatformSpec {
  id: string;
  maxDurationSec: number;
  minResolutionLabel: string;
  /** 分辨率下限（数字等级，越高越严格） */
  minResolutionLevel: number;
  aspectHint: string;
}

const RESOLUTION_LEVEL: Record<string, number> = {
  '512P': 1,
  '720P': 2,
  '768P': 3,
  '1080P': 4,
};

export const PLATFORM_SPECS: Record<string, PlatformSpec> = {
  douyin: {
    id: 'douyin',
    maxDurationSec: 900, // 15 分钟
    minResolutionLabel: '720P',
    minResolutionLevel: 2,
    aspectHint: '竖版 9:16 优先',
  },
  bilibili: {
    id: 'bilibili',
    maxDurationSec: 14400, // 4 小时
    minResolutionLabel: '1080P',
    minResolutionLevel: 4,
    aspectHint: '横版 16:9 优先',
  },
  generic: {
    id: 'generic',
    maxDurationSec: 86400,
    minResolutionLabel: '720P',
    minResolutionLevel: 2,
    aspectHint: '通用平台，建议 720P 以上',
  },
};

/**
 * P2-9 内容合规与标识服务
 *
 * - 平台发布预检（尺寸/时长/字幕/敏感词/AI 标识）
 * - AI 生成内容声明元数据构建与序列化（写入导出文件元数据）
 * 敏感词表可配置（默认空表），不内置敏感内容。
 */
export class ComplianceService {
  private readonly deps: ComplianceServiceDeps;

  constructor(deps: ComplianceServiceDeps) {
    this.deps = deps;
  }

  /** 平台发布预检清单 */
  preflight(input: PreflightInput, platform: string): PreflightResult {
    const spec = PLATFORM_SPECS[platform] ?? PLATFORM_SPECS.generic;
    const rules: PreflightResult['rules'] = [];

    // 时长：超过平台上限 → error
    rules.push({
      id: 'duration',
      passed: input.durationSec <= spec.maxDurationSec,
      severity: 'error',
      message: input.durationSec <= spec.maxDurationSec
        ? `时长 ${input.durationSec.toFixed(0)}s 在平台上限 ${Math.floor(spec.maxDurationSec / 60)} 分钟内`
        : `时长 ${input.durationSec.toFixed(0)}s 超过平台上限 ${Math.floor(spec.maxDurationSec / 60)} 分钟，可能发布失败`,
    });

    // 分辨率：低于平台建议 → warning
    if (input.resolution) {
      const level = RESOLUTION_LEVEL[input.resolution] ?? 0;
      rules.push({
        id: 'resolution',
        passed: level >= spec.minResolutionLevel,
        severity: 'warning',
        message: level >= spec.minResolutionLevel
          ? `分辨率 ${input.resolution} 达到平台建议（${spec.minResolutionLabel}）`
          : `分辨率 ${input.resolution} 低于平台建议 ${spec.minResolutionLabel}，建议重新导出高清版本`,
      });
    } else {
      rules.push({
        id: 'resolution',
        passed: true,
        severity: 'warning',
        message: '未记录成片分辨率，跳过检查',
      });
    }

    // 画面比例提示
    if (input.aspectRatio) {
      const ideal = platform === 'douyin' ? '9:16' : '16:9';
      rules.push({
        id: 'aspect_ratio',
        passed: input.aspectRatio === ideal,
        severity: 'warning',
        message: input.aspectRatio === ideal
          ? `画面比例 ${input.aspectRatio} 符合${platform === 'douyin' ? '抖音竖版' : 'B站横版'}偏好`
          : `画面比例 ${input.aspectRatio}，${platform === 'douyin' ? '抖音建议 9:16 竖版' : 'B站建议 16:9 横版'}`,
      });
    }

    // 字幕
    rules.push({
      id: 'subtitles',
      passed: input.hasSubtitles !== false,
      severity: 'warning',
      message: input.hasSubtitles === false ? '成片未烧录字幕，建议开启字幕提升完播率' : '成片已含字幕',
    });

    // 敏感词（可配置词表，默认空）
    const hits = this.checkSensitiveWords(input.text ?? '', input.sensitiveWords ?? []);
    rules.push({
      id: 'sensitive_words',
      passed: hits.length === 0,
      severity: 'error',
      message: hits.length === 0 ? '文案未命中敏感词' : `文案命中敏感词：${hits.join('、')}，请修改后重试`,
    });

    // AI 生成标识
    rules.push({
      id: 'ai_metadata',
      passed: input.aiMetadataWritten !== false,
      severity: 'warning',
      message: input.aiMetadataWritten === false
        ? '成片尚未写入 AI 生成标识（建议导出时声明，合规要求）'
        : '成片已声明 AI 生成标识',
    });

    const hasError = rules.some(r => r.severity === 'error' && !r.passed);
    this.deps.logger.info('preflight evaluated', {
      service: 'ComplianceService',
      method: 'preflight',
      platform,
      passed: !hasError,
      ruleCount: rules.length,
    });

    return {
      passed: !hasError,
      rules,
      spec: {
        platform,
        maxDurationSec: spec.maxDurationSec,
        minResolutionLabel: spec.minResolutionLabel,
        aspectHint: spec.aspectHint,
      },
    };
  }

  /** 敏感词检查（大小写不敏感、支持子串匹配） */
  checkSensitiveWords(text: string, wordList: string[]): string[] {
    if (wordList.length === 0 || !text) return [];
    const lower = text.toLowerCase();
    return wordList.filter(w => w && lower.includes(w.toLowerCase()));
  }

  /** P3-2 词表规范化：trim + 去空 + 去重（命中预览与导入共用，保证单一口径） */
  static normalizeWords(raw: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of raw) {
      const w = String(r ?? '').trim();
      if (!w || seen.has(w)) continue;
      seen.add(w);
      out.push(w);
    }
    return out;
  }

  /** 构建 AI 生成内容声明元数据 */
  buildAiMetadata(sourceVersion?: number): AiMetadata {
    return {
      aiGenerated: true,
      generator: 'ai-video-studio',
      generatedAt: Date.now(),
      sourceVersion,
    };
  }

  /** 序列化为可写入媒体元数据的单行文本（MP4 comment 字段） */
  serializeAiMetadata(meta: AiMetadata): string {
    const parts = [
      `ai-generated:${meta.aiGenerated}`,
      `generator:${meta.generator}`,
      `generated-at:${new Date(meta.generatedAt).toISOString()}`,
    ];
    if (meta.sourceVersion !== undefined) parts.push(`source-version:${meta.sourceVersion}`);
    return parts.join(';');
  }
}
