import type { SensitiveWordEntry } from '../entities/models';

/** P3-2 敏感词仓库端口：持久化 + 按平台查询 */
export interface ISensitiveWordRepository {
  listByPlatform(platform: SensitiveWordEntry['platform']): Promise<SensitiveWordEntry[]>;
  listEnabledByPlatform(platform: SensitiveWordEntry['platform']): Promise<SensitiveWordEntry[]>;
  put(entry: SensitiveWordEntry): Promise<void>;
  delete(id: string): Promise<void>;
}

// ===== P2-9 内容合规与标识端口 =====

/** AI 生成内容声明元数据 */
export interface AiMetadata {
  /** 恒为 true：AI 生成声明 */
  aiGenerated: true;
  /** 生成器标识 */
  generator: string;
  /** 生成时间戳（ms） */
  generatedAt: number;
  /** 同源版本号（P0-3 版本链） */
  sourceVersion?: number;
}

/** 预检规则结果 */
export interface PreflightRule {
  /** 规则 id：duration / resolution / subtitles / sensitive_words / ai_metadata */
  id: string;
  passed: boolean;
  /** error：阻止发布；warning：提示不阻止 */
  severity: 'error' | 'warning';
  message: string;
}

/** 平台发布预检结果 */
export interface PreflightResult {
  passed: boolean;
  rules: PreflightRule[];
  /** 平台期望规格（供 UI 展示） */
  spec: {
    platform: string;
    maxDurationSec: number;
    minResolutionLabel: string;
    aspectHint: string;
  };
}

/** 预检输入（成片可观测信息） */
export interface PreflightInput {
  /** 成片时长（秒） */
  durationSec: number;
  /** 期望分辨率（'512P'|'720P'|'768P'|'1080P'） */
  resolution?: string;
  /** 是否含字幕 */
  hasSubtitles?: boolean;
  /** 发布标题/简介/标签合并文本（敏感词检查） */
  text?: string;
  /** 可配置敏感词表（默认空表，由调用方注入） */
  sensitiveWords?: string[];
  /** AI 标识是否已写入成片元数据 */
  aiMetadataWritten?: boolean;
  /** 画面比例（StoryFilm 生成时确定，可选） */
  aspectRatio?: '16:9' | '9:16';
}
