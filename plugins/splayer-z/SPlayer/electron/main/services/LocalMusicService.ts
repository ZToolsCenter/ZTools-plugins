import { nativeImage } from "electron";
import { join, basename } from "path";
import { mkdir } from "fs/promises";
import { CacheService } from "./CacheService";
import { existsSync } from "fs";
import { createHash } from "crypto";
import { useStore } from "../store";
import { type IAudioMetadata, parseFile } from "music-metadata";
import { LocalMusicDB, type MusicTrack } from "../database/LocalMusicDB";
import FastGlob, { type Entry } from "fast-glob";
import pLimit from "p-limit";

/** 本地音乐服务 */
export class LocalMusicService {
  /** 数据库实例 */
  private db: LocalMusicDB | null = null;
  /** 限制并发解析数为 10，防止内存溢出 */
  private limit = pLimit(10);
  /** 运行锁：防止并发扫描 */
  private isRefreshing = false;
  /** 初始化 Promise：确保只初始化一次 */
  private initPromise: Promise<void> | null = null;
  /** 记录最后一次使用的 DB 路径 */
  private lastDbPath: string = "";

  constructor() {}

  /** 获取动态路径 */
  private get paths() {
    const store = useStore();
    const localCachePath = join(store.get("cachePath"), "local-data");
    return {
      dbPath: join(localCachePath, "library.db"),
      jsonPath: join(localCachePath, "library.json"),
      coverDir: join(localCachePath, "covers"),
      cacheDir: localCachePath,
    };
  }

  /** 初始化 */
  private async ensureInitialized(): Promise<void> {
    const { dbPath, jsonPath, coverDir } = this.paths;

    // 如果路径变了，强制重新初始化
    if (this.lastDbPath && this.lastDbPath !== dbPath) {
      this.initPromise = null;
      if (this.db) {
        this.db.close();
        this.db = null;
      }
    }
    this.lastDbPath = dbPath;

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      if (!existsSync(coverDir)) {
        await mkdir(coverDir, { recursive: true });
      }

      if (!this.db) {
        this.db = new LocalMusicDB(dbPath);
        this.db.init();
      }

      await this.db.migrateFromJsonIfNeeded(jsonPath);
    })();

    return this.initPromise;
  }

  /** 获取文件id */
  private getFileId(filePath: string): string {
    return createHash("md5").update(filePath).digest("hex");
  }

  /** 提取封面 */
  private async extractCover(
    metadata: IAudioMetadata,
    fileId: string,
  ): Promise<string | undefined> {
    const { coverDir } = this.paths;
    const picture = metadata.common.picture?.[0];
    if (!picture) return undefined;

    // 使用 jpg 格式，兼容性更好且无需外部依赖
    const fileName = `${fileId}.jpg`;
    const savePath = join(coverDir, fileName);

    // 已存在
    if (existsSync(savePath)) return fileName;

    try {
      const img = nativeImage.createFromBuffer(Buffer.from(picture.data));
      if (img.isEmpty()) return undefined;

      // 调整大小并压缩
      const buffer = img
        .resize({
          width: 256,
          height: 256,
          quality: "better",
        })
        .toJPEG(80);

      const cacheService = CacheService.getInstance();
      await cacheService.put("local-data", `covers/${fileName}`, buffer);
      return fileName;
    } catch (e) {
      console.error("Failed to extract cover using nativeImage:", e);
      return undefined;
    }
  }

  /**
   * 刷新所有库文件夹
   * @param dirPaths 文件夹路径数组
   * @param onProgress 进度回调
   * @param onTracksBatch 批量track回调（用于流式传输，每批发送多个tracks）
   */
  async refreshLibrary(
    dirPaths: string[],
    onProgress?: (current: number, total: number) => void,
    onTracksBatch?: (tracks: MusicTrack[]) => void,
  ) {
    const { coverDir, cacheDir } = this.paths;

    // 运行锁：如果正在刷新，抛出特定错误
    if (this.isRefreshing) {
      console.warn("LocalMusicService: refreshLibrary is already running, skipping...");
      throw new Error("SCAN_IN_PROGRESS");
    }

    // 确保初始化完成
    await this.ensureInitialized();
    if (!this.db) throw new Error("DB not initialized");

    if (!dirPaths || dirPaths.length === 0) {
      // 如果没有目录，清空数据库
      this.db.clearTracks();
      return [];
    }

    // 检查封面目录是否被人为删除，如果是，则重建
    if (!existsSync(coverDir)) {
      await mkdir(coverDir, { recursive: true });
    }
    this.isRefreshing = true;

    // 音乐文件扩展名
    const musicExtensions = ["mp3", "wav", "flac", "aac", "webm", "m4a", "ogg", "aiff", "aif"];
    // 构造 Glob 模式数组
    const patterns = dirPaths.map((dir) =>
      join(dir, `**/*.{${musicExtensions.join(",")}}`).replace(/\\/g, "/"),
    );
    // 扫描磁盘
    const entries: Entry[] = await FastGlob(patterns, {
      stats: true,
      absolute: true,
      onlyFiles: true,
      ignore: [`${cacheDir.replace(/\\/g, "/")}/**`],
    });
    /** 总文件数 */
    const totalFiles = entries.length;
    /** 已处理文件数 */
    let processedCount = 0;
    // 用于记录本次扫描到的文件路径，用于后续清理"不存在的文件"
    const scannedPaths = new Set<string>();
    // 批量发送缓冲区
    const BATCH_SIZE = 50; // 每批发送50首
    const tracksBuffer: MusicTrack[] = [];

    // 批量发送函数
    const flushBatch = () => {
      if (tracksBuffer.length > 0) {
        onTracksBatch?.([...tracksBuffer]);
        tracksBuffer.length = 0;
      }
    };

    // 分批处理扫描任务，避免内存溢出
    const PROCESS_BATCH_SIZE = 200; // 每批处理200个文件
    for (let i = 0; i < entries.length; i += PROCESS_BATCH_SIZE) {
      const chunk = entries.slice(i, i + PROCESS_BATCH_SIZE);
      const tasks = chunk.map((entry) => {
        return this.limit(async () => {
          const filePath = entry.path;
          const stats = entry.stats;
          if (!stats) return;
          /** 修改时间 */
          const mtime = stats.mtimeMs;
          /** 文件大小 */
          const size = stats.size;
          // 小于 1MB 的文件不处理
          if (size < 1024 * 1024) return;
          scannedPaths.add(filePath);

          /** 缓存 */
          const cached = this.db!.getTrack(filePath);

          // 判断是否可以使用缓存
          let useCache = false;
          if (cached && cached.mtime === mtime && cached.size === size) {
            useCache = true;
            // 额外检查：如果记录中有封面，验证封面文件是否真实存在
            if (cached.cover && !existsSync(join(coverDir, cached.cover))) {
              useCache = false;
            }
          }
          // 只有当缓存存在 && 修改时间没变 && 文件大小没变 && 封面存在 -> 才跳过
          if (useCache) {
            processedCount++;
            // 添加到批量缓冲区
            tracksBuffer.push(cached!);
            // 达到批量大小，发送一批
            if (tracksBuffer.length >= BATCH_SIZE) {
              flushBatch();
            }
            // 节流发送进度
            if (processedCount % 10 === 0 || processedCount === totalFiles) {
              onProgress?.(processedCount, totalFiles);
            }
            return;
          }
          // 解析元数据
          try {
            const id = this.getFileId(filePath);
            const metadata = await parseFile(filePath);
            // 过滤规则
            // 时长 < 30s
            if (metadata.format.duration && metadata.format.duration < 30) return;
            // 时长 > 2h (7200s)
            if (metadata.format.duration && metadata.format.duration > 7200) return;
            // 提取封面
            const coverPath = await this.extractCover(metadata, id);
            // 构建音乐数据
            const track: MusicTrack = {
              id,
              path: filePath,
              title: metadata.common.title || basename(filePath),
              artist: metadata.common.artist || "Unknown Artist",
              album: metadata.common.album || "Unknown Album",
              duration: (metadata.format.duration || 0) * 1000,
              mtime,
              size,
              cover: coverPath,
              bitrate: metadata.format.bitrate ?? 0,
            };

            // 返回 track，在 limit 外面处理写入
            return track;
          } catch (err) {
            console.warn(`Parse error [${filePath}]:`, err);
            return undefined;
          } finally {
            processedCount++;
            // 节流发送进度
            if (processedCount % 10 === 0 || processedCount === totalFiles) {
              onProgress?.(processedCount, totalFiles);
            }
          }
        });
      });

      // 等待当前批次完成
      const results = await Promise.all(tasks);

      // 过滤出新的/更新的 tracks
      const newTracks = results.filter((t): t is MusicTrack => t !== undefined);

      // 批量写入 DB
      if (newTracks.length > 0) {
        this.db.addTracks(newTracks);
        tracksBuffer.push(...newTracks);
      }

      if (tracksBuffer.length >= BATCH_SIZE) {
        flushBatch();
      }
    }

    // 发送最后一批数据
    flushBatch();

    // 清理脏数据 (处理文件删除 或 移除文件夹的情况)
    const allPaths = this.db.getAllPaths();
    const pathsToDelete: string[] = [];
    for (const path of allPaths) {
      if (!scannedPaths.has(path)) {
        pathsToDelete.push(path);
      }
    }

    if (pathsToDelete.length > 0) {
      this.db.deleteTracks(pathsToDelete);
    }

    // 释放运行锁
    this.isRefreshing = false;

    // 返回所有数据
    return this.db.getAllTracks();
  }

  /** 获取所有音乐 */
  async getAllTracks(): Promise<MusicTrack[]> {
    await this.ensureInitialized();
    if (!this.db) return [];
    return this.db.getAllTracks();
  }
}
