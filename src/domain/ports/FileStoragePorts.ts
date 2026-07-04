import type { GeneratedFile, GeneratedFileType } from '../entities/models';

// ==========================================
// 文件存储端口 — 二进制 Blob 持久化抽象
// ==========================================

/** 文件存储查询参数 */
export interface FileStorageQuery {
  spaceId?: string;
  fileType?: GeneratedFileType;
  sourceEntityType?: string;
  sourceEntityId?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
}

/** 文件存储统计信息 */
export interface FileStorageStats {
  totalSize: number;
  totalFiles: number;
  byType: Record<GeneratedFileType, { count: number; size: number }>;
  maxCapacity: number;
}

/**
 * 文件存储端口 — 抽象二进制 Blob 持久化。
 *
 * 主适配器：OPFSFileStorageAdapter（Origin Private File System）
 * 降级适配器：FilesLocalAdapter（Vite 插件 /__files 路由落盘）
 *
 * 职责：
 * - 按文件系统语义存储/检索/删除二进制 Blob
 * - 按类型（image/audio/video/other）组织目录
 * - 配合 IGeneratedFileRepository 实现 LRU 淘汰
 * - 执行存储配额管理
 */
export interface IFileStoragePort {
  /** 将 Blob 写入指定路径 */
  storeBlob(path: string, blob: Blob): Promise<void>;
  /** 读取指定路径的 Blob，不存在返回 null */
  getBlob(path: string): Promise<Blob | null>;
  /** 删除指定路径的文件 */
  deleteBlob(path: string): Promise<void>;
  /** 检查文件是否存在 */
  blobExists(path: string): Promise<boolean>;
  /** 读取 Blob 并返回 Object URL（convenience 方法） */
  getObjectUrl(path: string): Promise<string>;
  /** 释放 Object URL（防止内存泄漏） */
  revokeObjectUrl(url: string): void;

  /** 初始化存储（创建目录结构） */
  initialize(): Promise<void>;
  /** 获取存储统计信息 */
  getStats(): Promise<FileStorageStats>;
  /** 按 LRU 淘汰至目标大小以下，返回释放的字节数 */
  evictLRU(maxSizeBytes: number): Promise<number>;
  /** 清空所有文件 */
  clearAll(): Promise<void>;

  /** 当前适配器是否可用 */
  isAvailable(): boolean;
  /** 返回底层存储类型 */
  getStorageType(): 'opfs' | 'indexeddb' | 'local';
}

// ==========================================
// 文件元数据仓储端口
// ==========================================

/**
 * GeneratedFile 元数据仓储 — 管理文件注册信息。
 * 实现层使用 Dexie/IndexedDB。
 */
export interface IGeneratedFileRepository {
  save(file: GeneratedFile): Promise<void>;
  getById(id: string): Promise<GeneratedFile | undefined>;
  query(params: FileStorageQuery): Promise<GeneratedFile[]>;
  delete(id: string): Promise<void>;
  findByPath(storagePath: string): Promise<GeneratedFile | undefined>;
  count(spaceId: string): Promise<number>;
  getTotalSize(spaceId?: string): Promise<number>;
  /** 查找最久未访问的文件（LRU 淘汰用） */
  findLeastRecentlyUsed(limit: number): Promise<GeneratedFile[]>;
  /** 更新最近访问时间 */
  touchAccessTime(id: string): Promise<void>;
}
