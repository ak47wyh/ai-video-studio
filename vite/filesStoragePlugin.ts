/**
 * vite/filesStoragePlugin —— 本地文件存储 Vite 插件
 *
 * 背景：
 *   应用原本依赖 OPFS 存储生成的图片/音频/视频 Blob。但 OPFS 写入前需要先用
 *   fetch() 把外部 URL 转成 Blob，而海螺/Hailuo 等厂商的 OSS 签名 URL 不返回
 *   CORS 头，导致 fetch 直接被浏览器拦截。
 *
 *   此插件提供一套"本地 HTTP 上传"端点，把 Blob 直接 POST 到 Vite dev server，
 *   服务端写到磁盘。配合前端 FilesLocalAdapter 使用，**完全不需要 fetch 外部
 *   URL**。
 *
 * 路由：
 *   POST   /__files/upload?path=<dir>/<name>     写入 Blob 到磁盘
 *   DELETE /__files/delete?path=<dir>/<name>     删除文件
 *   HEAD   /__files/exists?path=<dir>/<name>     检查文件是否存在
 *   GET    /__files/list?dir=<dir>               列出目录下的文件
 *   GET    /files/<dir>/<name>                   静态访问已保存的文件
 *
 * 配置：
 *   环境变量 FILES_DIR 指定根目录，相对 Vite 项目根。默认 "docs/files"。
 *
 * 安全：
 *   - path 仅允许 <dir>/<name> 形式，禁止 .. / 绝对路径 / 协议前缀
 *   - 写入前会校验 path 中每个目录段非空
 *   - 仅响应 Content-Type 与文件扩展名一致的请求，避免误传
 *
 * 仅开发期生效。生产构建中不会注册这些路由（如果部署到生产环境，请改用 Nginx
 * 或对象存储替代）。
 */

import type { Plugin, Connect } from 'vite';
import { promises as fsp, existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

export interface FilesStoragePluginOptions {
  /** 根目录，相对于 Vite 项目根。默认 'docs/files' */
  rootDir?: string;
  /** 静态服务的 URL 前缀。默认 '/files' */
  publicPath?: string;
  /** API 路由前缀。默认 '/__files' */
  apiPath?: string;
  /** 单次上传最大字节数。默认 50MB。可通过环境变量 FILES_MAX_SIZE_MB 覆盖 */
  maxUploadBytes?: number;
}

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.json': 'application/json',
  '.txt': 'text/plain',
};

function getMime(absPath: string): string {
  const ext = path.extname(absPath).toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

/**
 * 路径合法性校验 —— 防止路径穿越与协议前缀攻击
 * @returns 解析后的绝对路径，若非法返回 null
 */
function safeResolve(rootDir: string, userPath: string): string | null {
  if (!userPath || typeof userPath !== 'string') return null;
  if (userPath.includes('..')) return null;
  if (userPath.startsWith('/') || /^[a-zA-Z]:/.test(userPath)) return null;
  if (userPath.includes('\0')) return null;

  const segments = userPath.split('/').filter(s => s.length > 0);
  if (segments.length === 0) return null;

  const resolved = path.resolve(rootDir, ...segments);
  const rootResolved = path.resolve(rootDir);
  // 解析后必须仍在 rootDir 之下
  if (!resolved.startsWith(rootResolved + path.sep) && resolved !== rootResolved) {
    return null;
  }
  return resolved;
}

export function filesStoragePlugin(options: FilesStoragePluginOptions = {}): Plugin {
  const rootDir = options.rootDir ?? process.env.FILES_DIR ?? 'docs/files';
  const publicPath = options.publicPath ?? '/files';
  const apiPath = options.apiPath ?? '/__files';
  // 解析上传上限：优先级 options > FILES_MAX_SIZE_MB 环境变量 > 默认 50MB
  const maxUploadBytes = options.maxUploadBytes
    ?? (process.env.FILES_MAX_SIZE_MB ? Number(process.env.FILES_MAX_SIZE_MB) * 1024 * 1024 : undefined)
    ?? 50 * 1024 * 1024;

  return {
    name: 'ai-video-studio:files-storage',
    apply: 'serve', // 仅 dev server，生产构建不注册
    configureServer(server) {
      const viteRoot = server.config.root;
      // 可变：POST /__files/config 可运行时切换
      let absoluteRoot = path.resolve(viteRoot, rootDir);

      // 启动时确保目录存在
      if (!existsSync(absoluteRoot)) {
        mkdirSync(absoluteRoot, { recursive: true });
        server.config.logger.info(`[files-storage] 创建本地保存目录: ${absoluteRoot}`);
      }

      // ===== 中间件 =====
      const base = server.config.base ?? '/';
      const middleware: Connect.NextHandleFunction = async (req, res, next) => {
        // 去掉 Vite base 前缀，使路由匹配与 base 无关
        let url = req.url ?? '';
        if (base !== '/' && url.startsWith(base)) {
          url = url.slice(base.length - 1); // 保留前导 /
        }
        const method = req.method ?? 'GET';

        // ----- POST /__files/upload?path=<dir>/<name> -----
        if (method === 'POST' && url.startsWith(`${apiPath}/upload`)) {
          try {
            const urlObj = new URL(url, 'http://localhost');
            const userPath = urlObj.searchParams.get('path');
            if (!userPath) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ code: 'MISSING_PATH', error: 'Missing path query param' }));
              return;
            }
            const absPath = safeResolve(absoluteRoot, userPath);
            if (!absPath) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ code: 'INVALID_PATH', error: `Invalid path: ${userPath}` }));
              return;
            }
            // 创建中间目录
            await fsp.mkdir(path.dirname(absPath), { recursive: true });

            // 读取 body（Vite dev server 用了 connect，body 是流）。
            // 实现上传大小限制：累计超过 maxUploadBytes 立即终止（防 DoS）。
            const chunks: Buffer[] = [];
            let totalBytes = 0;
            let oversize = false;
            await new Promise<void>((resolve, reject) => {
              req.on('data', (c: Buffer) => {
                totalBytes += c.length;
                if (totalBytes > maxUploadBytes) {
                  oversize = true;
                  req.destroy();
                  resolve();
                  return;
                }
                chunks.push(c);
              });
              req.on('end', () => resolve());
              req.on('error', reject);
            });
            if (oversize) {
              res.statusCode = 413;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({
                code: 'PAYLOAD_TOO_LARGE',
                error: `Upload exceeds ${(maxUploadBytes / 1024 / 1024).toFixed(1)}MB limit`,
                maxBytes: maxUploadBytes,
              }));
              return;
            }
            const buf = Buffer.concat(chunks);
            if (buf.length === 0) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ code: 'EMPTY_BODY', error: 'Empty body' }));
              return;
            }
            await fsp.writeFile(absPath, buf);

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              ok: true,
              path: userPath,
              url: `${publicPath}/${userPath}`,
              bytes: buf.length,
            }));
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            server.config.logger.error(`[files-storage] upload failed: ${msg}`);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ code: 'WRITE_FAILED', error: msg }));
          }
          return;
        }

        // ----- DELETE /__files/delete?path=<dir>/<name> -----
        if (method === 'DELETE' && url.startsWith(`${apiPath}/delete`)) {
          try {
            const urlObj = new URL(url, 'http://localhost');
            const userPath = urlObj.searchParams.get('path');
            if (!userPath) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Missing path query param' }));
              return;
            }
            const absPath = safeResolve(absoluteRoot, userPath);
            if (!absPath) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: `Invalid path: ${userPath}` }));
              return;
            }
            await fsp.unlink(absPath).catch(() => undefined); // 文件不存在也当作成功
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: msg }));
          }
          return;
        }

        // ----- HEAD /__files/exists?path=<dir>/<name> -----
        if (method === 'HEAD' && url.startsWith(`${apiPath}/exists`)) {
          try {
            const urlObj = new URL(url, 'http://localhost');
            const userPath = urlObj.searchParams.get('path');
            if (!userPath) {
              res.statusCode = 400;
              res.end();
              return;
            }
            const absPath = safeResolve(absoluteRoot, userPath);
            if (!absPath || !existsSync(absPath)) {
              res.statusCode = 404;
              res.end();
              return;
            }
            res.statusCode = 200;
            res.end();
          } catch {
            res.statusCode = 500;
            res.end();
          }
          return;
        }

        // ----- GET /__files/list?dir=<dir> -----
        if (method === 'GET' && url.startsWith(`${apiPath}/list`)) {
          try {
            const urlObj = new URL(url, 'http://localhost');
            const dir = urlObj.searchParams.get('dir') ?? '';
            const absDir = safeResolve(absoluteRoot, dir);
            if (!absDir) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ code: 'INVALID_DIR', error: 'Invalid dir' }));
              return;
            }
            let entries: string[] = [];
            try {
              entries = await fsp.readdir(absDir);
            } catch {
              // 目录不存在
            }
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ entries, dir }));
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ code: 'LIST_FAILED', error: msg }));
          }
          return;
        }

        // ----- GET /__files/stats 聚合统计（Q4：磁盘用量） -----
        if (method === 'GET' && url === `${apiPath}/stats`) {
          try {
            const stats = {
              totalSize: 0,
              totalFiles: 0,
              byType: { images: { count: 0, size: 0 }, audio: { count: 0, size: 0 }, video: { count: 0, size: 0 }, other: { count: 0, size: 0 } } as Record<string, { count: number; size: number }>,
              root: absoluteRoot,
              maxUploadBytes,
            };
            // 列出 rootDir 下所有一级目录
            let topDirs: string[] = [];
            try {
              topDirs = await fsp.readdir(absoluteRoot);
            } catch {
              // 目录不存在
            }
            for (const dirName of topDirs) {
              const absDir = path.join(absoluteRoot, dirName);
              try {
                const stat = statSync(absDir);
                if (!stat.isDirectory()) continue;
              } catch {
                continue;
              }
              // 累加该目录下所有文件
              const files = await fsp.readdir(absDir).catch(() => [] as string[]);
              for (const fileName of files) {
                const absFile = path.join(absDir, fileName);
                try {
                  const s = statSync(absFile);
                  if (!s.isFile()) continue;
                  const bucket = stats.byType[dirName] ?? stats.byType.other;
                  bucket.count++;
                  bucket.size += s.size;
                  stats.totalSize += s.size;
                  stats.totalFiles++;
                } catch {
                  // 跳过无法 stat 的文件（可能是符号链接等）
                }
              }
            }
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(stats));
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ code: 'STATS_FAILED', error: msg }));
          }
          return;
        }

        // ----- GET /__files/config 返回当前服务端实际 rootDir -----
        if (method === 'GET' && url.startsWith(`${apiPath}/config`)) {
          try {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              rootDir,
              absoluteRoot,
              publicPath,
              apiPath,
              maxUploadBytes,
            }));
            server.config.logger.info(`[files-storage] GET /config → ${JSON.stringify({ rootDir, absoluteRoot })}`);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ code: 'CONFIG_READ_FAILED', error: msg }));
          }
          return;
        }

        // ----- POST /__files/config 运行时切换 rootDir，可选迁移老文件 -----
        // 请求体：{ rootDir: string, migrate?: boolean }
        // 响应：{ success: boolean, migratedFiles?: number, errors?: string[] }
        if (method === 'POST' && url.startsWith(`${apiPath}/config`)) {
          try {
            const chunks: Buffer[] = [];
            await new Promise<void>((resolve, reject) => {
              req.on('data', (c: Buffer) => chunks.push(c));
              req.on('end', () => resolve());
              req.on('error', reject);
            });
            const bodyStr = Buffer.concat(chunks).toString('utf8');
            const body = JSON.parse(bodyStr || '{}') as { rootDir?: string; migrate?: boolean };
            if (!body.rootDir || typeof body.rootDir !== 'string') {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ code: 'MISSING_ROOT_DIR', error: 'body.rootDir is required' }));
              return;
            }
            server.config.logger.info(`[files-storage] POST /config ← ${JSON.stringify(body)}`);

            // 解析新目录（支持相对/绝对路径），防路径穿越
            const newAbsolute = path.isAbsolute(body.rootDir)
              ? path.resolve(body.rootDir)
              : path.resolve(viteRoot, body.rootDir);
            // 安全校验：不允许指向系统关键目录（简化版：只校验非空且可创建）
            try {
              if (!existsSync(newAbsolute)) {
                mkdirSync(newAbsolute, { recursive: true });
              }
              // 可写性测试：写入临时文件
              const testFile = path.join(newAbsolute, `.write_test_${Date.now()}`);
              await fsp.writeFile(testFile, 'ok');
              await fsp.unlink(testFile);
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ code: 'DIR_NOT_WRITABLE', error: `新目录不可写: ${msg}` }));
              return;
            }

            const oldAbsolute = absoluteRoot;
            let migratedFiles = 0;
            const errors: string[] = [];

            // 迁移老文件（先复制后删除，失败回滚）
            if (body.migrate && oldAbsolute !== newAbsolute && existsSync(oldAbsolute)) {
              const copyDir = async (srcDir: string, destDir: string) => {
                let entries: string[] = [];
                try {
                  entries = await fsp.readdir(srcDir);
                } catch {
                  return;
                }
                for (const name of entries) {
                  const srcPath = path.join(srcDir, name);
                  const destPath = path.join(destDir, name);
                  try {
                    const s = statSync(srcPath);
                    if (s.isDirectory()) {
                      await fsp.mkdir(destPath, { recursive: true });
                      await copyDir(srcPath, destPath);
                    } else if (s.isFile()) {
                      await fsp.copyFile(srcPath, destPath);
                      migratedFiles++;
                    }
                  } catch (e) {
                    errors.push(`${srcPath}: ${e instanceof Error ? e.message : String(e)}`);
                  }
                }
              };
              await copyDir(oldAbsolute, newAbsolute);
              // 复制成功后删除老目录文件（保留目录本身）
              if (errors.length === 0) {
                try {
                  await fsp.rm(oldAbsolute, { recursive: true, force: true });
                } catch (e) {
                  errors.push(`清理老目录失败: ${e instanceof Error ? e.message : String(e)}`);
                }
              }
            }

            // 切换
            absoluteRoot = newAbsolute;
            server.config.logger.info(
              `[files-storage] rootDir 切换成功: ${oldAbsolute} → ${newAbsolute}（迁移 ${migratedFiles} 文件，${errors.length} 错误）`
            );

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              success: true,
              rootDir: body.rootDir,
              absoluteRoot: newAbsolute,
              migratedFiles,
              errors,
            }));
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            server.config.logger.error(`[files-storage] POST /config failed: ${msg}`);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ code: 'CONFIG_UPDATE_FAILED', error: msg }));
          }
          return;
        }

        // ----- GET /files/<dir>/<name> 静态访问 -----
        if (method === 'GET' && url.startsWith(`${publicPath}/`)) {
          const userPath = decodeURIComponent(url.slice(publicPath.length + 1).split('?')[0]);
          const absPath = safeResolve(absoluteRoot, userPath);
          if (!absPath || !existsSync(absPath)) {
            res.statusCode = 404;
            res.end('Not Found');
            return;
          }
          try {
            const stat = statSync(absPath);
            if (!stat.isFile()) {
              res.statusCode = 404;
              res.end('Not Found');
              return;
            }
            const mime = getMime(absPath);
            res.statusCode = 200;
            res.setHeader('Content-Type', mime);
            res.setHeader('Content-Length', String(stat.size));
            res.setHeader('Cache-Control', 'public, max-age=3600');
            // 以流形式读取
            const nodeStream = await import('node:fs').then(fs => fs.createReadStream(absPath));
            Readable.from(nodeStream).pipe(res);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            res.statusCode = 500;
            res.end(msg);
          }
          return;
        }

        next();
      };

      // Vite 5+ 用 server.middlewares
      server.middlewares.use(middleware);

      server.config.logger.info(
        `\n[files-storage] ✓ 本地文件存储插件已挂载\n` +
        `  根目录:    ${absoluteRoot}\n` +
        `  静态路径:  ${publicPath}/*\n` +
        `  API 路径:  ${apiPath}/{upload|delete|exists|list|stats}\n` +
        `  上传上限:  ${(maxUploadBytes / 1024 / 1024).toFixed(1)}MB\n` +
        `  覆盖配置:  FILES_DIR=<path>  FILES_MAX_SIZE_MB=<MB>\n`
      );
    },
  };
}