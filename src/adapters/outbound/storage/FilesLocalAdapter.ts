import type { IFileStoragePort, FileStorageStats } from '../../../domain/ports/FileStoragePorts';
import type { GeneratedFileType } from '../../../domain/entities/models';

/**
 * FilesLocalError —— 服务端错误响应携带的 code 分类错误
 *
 * 与 Vite 插件统一返回 { code, error, maxBytes? } 格式匹配：
 *   - code: 错误码（PAYLOAD_TOO_LARGE / INVALID_PATH / WRITE_FAILED 等）
 *   - status: HTTP 状态码
 *   - message: 服务端的 error 字段
 *   - maxBytes: 仅 PAYLOAD_TOO_LARGE 时有值
 *
 * 前端用 instanceof FilesLocalError 识别，按 code 给出针对性解决建议。
 */
export class FilesLocalError extends Error {
  readonly code: string;
  readonly status: number;
  readonly maxBytes?: number;

  constructor(code: string, status: number, message: string, maxBytes?: number) {
    super(message);
    this.name = 'FilesLocalError';
    this.code = code;
    this.status = status;
    this.maxBytes = maxBytes;
  }
}

/**
 * FilesLocalAdapter —— 通过 Vite 开发服务器提供的本地 HTTP 端点存取 Blob
 *
 * 背景：
 *   之前 OPFSFileStorageAdapter 需要先用 fetch() 把外部 URL（如 OSS 签名 URL）
 *   转成 Blob，再写入 OPFS。当外部 URL 不带 CORS 头时，fetch 会被浏览器拦截，
 *   导致"图片保存失败：Failed to fetch"。
 *
 *   本适配器改为：
 *   - 应用层直接拿到 Blob（来源可能是 data URI、Canvas 截屏、用户上传、生成器的
 *     二进制响应等），不调用 fetch
 *   - 通过 POST /__files/upload 把 Blob 提交到本地 Vite 插件
 *   - 插件把文件落到磁盘（默认 docs/files，可配置）
 *
 *   适用场景：开发期把生成的素材直接落到本地磁盘，无需调用任何外部接口。
 *
 * 路由契约（与 vite/filesStoragePlugin 配套）：
 *   POST   /__files/upload?path=<dir>/<name>     body = Blob
 *   DELETE /__files/delete?path=<dir>/<name>
 *   HEAD   /__files/exists?path=<dir>/<name>
 *   GET    /__files/list?dir=<dir>
 *   GET    /files/<dir>/<name>                   静态访问
 *
 * 配置（来自 localStorage FILES_BASE_URL，运行时可改）：
 *   FILES_BASE_URL —— 默认 '/__files' 与 '/files'
 */
export class FilesLocalAdapter implements IFileStoragePort {
  private readonly apiBase: string;
  private readonly publicPath: string;
  private activeObjectUrls = new Set<string>();
  private initialized = false;

  /** 与 OPFSFileStorageAdapter 对齐的 4 个分类目录（用于 getStats 聚合） */
  private static readonly DIRECTORIES = ['images', 'audio', 'video', 'other'] as const;

  /** getObjectUrl 结果缓存（path → URL），避免重复字符串拼接 */
  private readonly urlCache = new Map<string, string>();

  constructor(options?: { apiBase?: string; publicPath?: string }) {
    // Vite base 路径前缀（如 /ai-video-studio/），需要在所有请求 URL 前加上
    const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
    const prefix = base !== '/' ? base.replace(/\/$/, '') : '';
    // 基础路径可通过构造器或环境变量注入；运行时用户可在设置面板里改 localStorage
    this.apiBase = options?.apiBase ?? (typeof window !== 'undefined'
      ? (window.localStorage.getItem('ai_vido_files_api_base') || `${prefix}/__files`)
      : '/__files');
    this.publicPath = options?.publicPath ?? (typeof window !== 'undefined'
      ? (window.localStorage.getItem('ai_vido_files_public_path') || `${prefix}/files`)
      : '/files');
  }

  /**
   * 重置 URL 缓存。当 apiBase / publicPath 在运行时变更时需要调用。
   * 主要由 FileStorageAdapterFactory 在探测失败重试时调用。
   */
  resetCache(): void {
    this.urlCache.clear();
  }

  /**
   * 路径合法性校验 —— 与 vite/filesStoragePlugin 配套，禁止 .. / 绝对路径 / 协议前缀。
   * 这里再校验一次作为前端纵深防御。
   */
  private assertValidPath(path: string): void {
    if (!path || typeof path !== 'string') {
      throw new Error(`[FilesLocal] Invalid path: empty`);
    }
    if (path.includes('..')) {
      throw new Error(`[FilesLocal] Invalid path "${path}": '..' not allowed`);
    }
    if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) {
      throw new Error(`[FilesLocal] Invalid path "${path}": must be relative`);
    }
    if (!/^[\w./-]+$/.test(path)) {
      throw new Error(`[FilesLocal] Invalid path "${path}": only [\\w./-] allowed`);
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    // 用 HEAD 请求 /__files/list?dir=images 验证插件可用
    try {
      const res = await fetch(`${this.apiBase}/list?dir=images`, { method: 'GET' });
      if (!res.ok && res.status !== 404) {
        throw new Error(`Plugin responded ${res.status}`);
      }
      this.initialized = true;
    } catch (e) {
      throw new Error(
        `[FilesLocal] 初始化失败：无法连接 Vite 文件存储插件 (${this.apiBase})。` +
        `请确认 vite.config.ts 中已注册 filesStoragePlugin。根因：${e instanceof Error ? e.message : e}`,
        { cause: e }
      );
    }
  }

  async storeBlob(path: string, blob: Blob): Promise<void> {
    this.assertValidPath(path);
    try {
      const res = await fetch(`${this.apiBase}/upload?path=${encodeURIComponent(path)}`, {
        method: 'POST',
        body: blob,
      });
      if (!res.ok) {
        // 尝试解析 JSON 错误响应（带 code 字段）。
        // 注意：Response body 只能读一次。parseErrorCode 内部用 clone() 避免污染。
        const code = await this.parseErrorCode(res);
        throw new FilesLocalError(
          code?.code ?? 'UPLOAD_FAILED',
          res.status,
          code?.error ?? `HTTP ${res.status}`,
          code?.maxBytes,
        );
      }
    } catch (e) {
      if (e instanceof FilesLocalError) {
        throw this.wrapUploadError(e, path);
      }
      const reason = e instanceof Error ? e.message : String(e);
      throw new Error(
        `[FilesLocal] 写入 "${path}" 失败：${reason}。` +
        `提示：这是本地 HTTP 上传，不需要 fetch 外部 URL；如果失败请检查 Vite dev server 是否运行。`,
        { cause: e }
      );
    }
  }

  /**
   * 解析服务端 JSON 错误响应。
   * 服务端统一返回 { code?, error, maxBytes? } 格式。
   *
   * 兼容两种 JSON 形态：
   *   1. 完整错误：{ code: 'PAYLOAD_TOO_LARGE', error: '...', maxBytes: N }
   *   2. 简化错误：{ error: '...' }（兼容老版本 / 测试 mock）
   *
   * 注意：必须 clone() 后再读 body，避免污染原始 Response。
   */
  private async parseErrorCode(res: Response): Promise<{ code?: string; error: string; maxBytes?: number } | null> {
    try {
      const ct = res.headers.get('Content-Type') ?? '';
      if (!ct.includes('json')) return null;
      const cloned = res.clone();
      const data = await cloned.json();
      if (typeof data?.error === 'string') {
        return {
          code: typeof data.code === 'string' ? data.code : undefined,
          error: data.error,
          maxBytes: typeof data.maxBytes === 'number' ? data.maxBytes : undefined,
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  /** 把 FilesLocalError 转换为可读的 Error，含原因 + 解决建议 */
  private wrapUploadError(e: FilesLocalError, path: string): Error {
    let suggestion: string;
    switch (e.code) {
      case 'PAYLOAD_TOO_LARGE':
        suggestion = `文件过大（>${(e.maxBytes ?? 0) / 1024 / 1024}MB）。可在 vite.config.ts 中通过 filesStoragePlugin({ maxUploadBytes: N }) 调整，或设置环境变量 FILES_MAX_SIZE_MB。`;
        break;
      case 'INVALID_PATH':
        suggestion = '路径包含非法字符（不允许 "..", "/", 盘符等）。';
        break;
      case 'MISSING_PATH':
        suggestion = '服务端收到的请求缺少 path 参数；这是前端代码 bug。';
        break;
      case 'EMPTY_BODY':
        suggestion = '请求体为空；可能是 Blob 未正确生成。';
        break;
      case 'WRITE_FAILED':
        suggestion = '磁盘写入失败；检查磁盘空间与目录权限。';
        break;
      default:
        suggestion = '检查 Vite dev server 日志。';
    }
    const out = new Error(
      `[FilesLocal] 写入 "${path}" 失败（${e.code}）：${e.message}。\n` +
      `建议：${suggestion}`,
      { cause: e }
    );
    return out;
  }

  async getBlob(path: string): Promise<Blob | null> {
    this.assertValidPath(path);
    try {
      const res = await fetch(`${this.publicPath}/${path}`);
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.blob();
    } catch {
      return null;
    }
  }

  async deleteBlob(path: string): Promise<void> {
    this.assertValidPath(path);
    try {
      await fetch(`${this.apiBase}/delete?path=${encodeURIComponent(path)}`, {
        method: 'DELETE',
      });
    } catch {
      // 文件不存在或插件未启动时静默
    }
  }

  async blobExists(path: string): Promise<boolean> {
    this.assertValidPath(path);
    try {
      const res = await fetch(`${this.apiBase}/exists?path=${encodeURIComponent(path)}`, {
        method: 'HEAD',
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async getObjectUrl(path: string): Promise<string> {
    this.assertValidPath(path);
    // 命中缓存直接返回（同一 path 多次调用只拼接一次）
    const cached = this.urlCache.get(path);
    if (cached) return cached;
    // 直接返回 /files/<path> 的 URL，无需 Object URL（HTTP 资源自带缓存）
    const url = `${this.publicPath}/${path}`;
    this.urlCache.set(path, url);
    this.activeObjectUrls.add(url);
    return url;
  }

  revokeObjectUrl(url: string): void {
    if (this.activeObjectUrls.has(url)) {
      this.activeObjectUrls.delete(url);
    }
    // 真正的 Object URL（blob: 协议）由浏览器管理；HTTP URL 不需要 revoke
  }

  async getStats(): Promise<FileStorageStats> {
    const stats: FileStorageStats = {
      totalSize: 0,
      totalFiles: 0,
      byType: {
        image: { count: 0, size: 0 },
        audio: { count: 0, size: 0 },
        video: { count: 0, size: 0 },
        other: { count: 0, size: 0 },
      },
      maxCapacity: Number.MAX_SAFE_INTEGER, // 本地存储无内置上限
    };

    // 优先调用 /__files/stats 端点（一次请求拿到全部聚合）
    try {
      const res = await fetch(`${this.apiBase}/stats`);
      if (res.ok) {
        const data = await res.json() as {
          totalSize: number;
          totalFiles: number;
          byType: Record<string, { count: number; size: number }>;
        };
        stats.totalSize = data.totalSize ?? 0;
        stats.totalFiles = data.totalFiles ?? 0;
        const map: Record<string, 'image' | 'audio' | 'video' | 'other'> = {
          images: 'image',
          audio: 'audio',
          video: 'video',
          other: 'other',
        };
        for (const [dirName, info] of Object.entries(data.byType ?? {})) {
          const key = map[dirName];
          if (key && stats.byType[key]) {
            stats.byType[key].count = info.count ?? 0;
            stats.byType[key].size = info.size ?? 0;
          }
        }
        return stats;
      }
    } catch {
      // 端点不可用（老版本插件无 /stats），回退到旧实现
    }

    // 回退：依次 list + head + getBlob（旧逻辑保留以兼容旧插件）
    for (const dir of FilesLocalAdapter.DIRECTORIES) {
      const fileType = this.dirToFileType(dir);
      try {
        const res = await fetch(`${this.apiBase}/list?dir=${encodeURIComponent(dir)}`);
        if (!res.ok) continue;
        const data = await res.json() as { entries?: string[] };
        const entries = data.entries ?? [];
        for (const name of entries) {
          const blob = await this.getBlob(`${dir}/${name}`);
          if (blob) {
            stats.byType[fileType].count++;
            stats.byType[fileType].size += blob.size;
            stats.totalSize += blob.size;
            stats.totalFiles++;
          }
        }
      } catch {
        // 目录不存在时跳过
      }
    }

    return stats;
  }

  async evictLRU(_maxSizeBytes: number): Promise<number> {
    // 本地磁盘通常无配额限制；如需实现可在 Settings 面板配置
    // 此处返回 0 表示未做淘汰
    return 0;
  }

  async clearAll(): Promise<void> {
    for (const dir of FilesLocalAdapter.DIRECTORIES) {
      try {
        const res = await fetch(`${this.apiBase}/list?dir=${encodeURIComponent(dir)}`);
        if (!res.ok) continue;
        const data = await res.json() as { entries?: string[] };
        for (const name of data.entries ?? []) {
          await this.deleteBlob(`${dir}/${name}`);
        }
      } catch {
        // 忽略
      }
    }
  }

  isAvailable(): boolean {
    // 开发环境：依赖 Vite 插件；生产环境：依赖 reverse proxy / Nginx 类似实现
    return typeof window !== 'undefined';
  }

  getStorageType(): 'local' {
    return 'local';
  }

  // ===== Private helpers =====

  private dirToFileType(dirName: string): GeneratedFileType {
    switch (dirName) {
      case 'images': return 'image';
      case 'audio': return 'audio';
      case 'video': return 'video';
      default: return 'other';
    }
  }
}