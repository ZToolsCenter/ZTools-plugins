import { openDB } from 'idb';
import type { Emoticon } from '@/types';
import { fileSystemService } from '@/utils/fileSystem';

class StorageService {
  private db: any = null;
  private readonly DB_NAME = 'emoticon-store';
  private readonly DB_VERSION = 2;

  async init() {
    if (this.db) return;

    try {
      this.db = await openDB(this.DB_NAME, this.DB_VERSION, {
        upgrade(db, oldVersion, newVersion) {
          // 版本 1：创建初始存储
          if (oldVersion < 1) {
            // 创建表情包存储
            if (!db.objectStoreNames.contains('emoticons')) {
              db.createObjectStore('emoticons', { keyPath: 'id' });
            }
            // 创建文件存储
            if (!db.objectStoreNames.contains('files')) {
              db.createObjectStore('files');
            }
          }
          
          // 版本 2：添加新的功能或修复（如果需要）
          if (oldVersion < 2) {
            // 这里可以添加版本 2 需要的数据库结构变更
            // 比如新增字段、索引等
            console.log('Upgrading database to version 2');
          }
        },
      });

      // 从文件系统恢复数据
      await this.restoreFromFileSystem();
    } catch (error) {
      console.error('Failed to initialize database:', error);
      throw error;
    }
  }

  async saveEmoticon(emoticon: Emoticon, file: Blob): Promise<Emoticon> {
    if (!this.db) await this.init();

    const tx = this.db.transaction(['emoticons', 'files'], 'readwrite');
    
    try {
      // 保存到 IndexedDB
      const sanitizedEmoticon = this.sanitizeEmoticon(emoticon);
      await tx.objectStore('emoticons').put(sanitizedEmoticon);
      await tx.objectStore('files').put(file, emoticon.id);
      await tx.done;

      // 同步保存到文件系统
      await fileSystemService.saveEmoticonFile(emoticon.id, file);
      await fileSystemService.upsertMetadata(sanitizedEmoticon);

      return this.withObjectUrl(sanitizedEmoticon, file);
    } catch (error) {
      this.abortTransaction(tx);
      throw error;
    }
  }

  async saveEmoticons(items: { emoticon: Emoticon; file: Blob }[]): Promise<Emoticon[]> {
    if (!this.db) await this.init();
    if (items.length === 0) return [];

    const tx = this.db.transaction(['emoticons', 'files'], 'readwrite');

    try {
      const savedEmoticons = items.map(item => this.sanitizeEmoticon(item.emoticon));
      const emoticonsStore = tx.objectStore('emoticons');
      const filesStore = tx.objectStore('files');

      await Promise.all(items.flatMap((item, index) => [
        emoticonsStore.put(savedEmoticons[index]),
        filesStore.put(item.file, item.emoticon.id)
      ]));
      await tx.done;

      await fileSystemService.saveEmoticonFiles(
        items.map(item => ({ id: item.emoticon.id, file: item.file }))
      );
      await fileSystemService.saveMetadata(await this.getAllEmoticonMetadata());

      return savedEmoticons.map((emoticon, index) => this.withObjectUrl(emoticon, items[index].file));
    } catch (error) {
      this.abortTransaction(tx);
      throw error;
    }
  }

  async getEmoticon(id: string): Promise<Emoticon | null> {
    if (!this.db) await this.init();

    try {
      const emoticon = await this.db.get('emoticons', id);
      if (!emoticon) return null;

      const file = await this.db.get('files', id);
      if (file) {
        // 如果已经有 URL，先释放它
        if (emoticon.url?.startsWith('blob:')) {
          URL.revokeObjectURL(emoticon.url);
        }
        emoticon.url = URL.createObjectURL(file);
      }

      return emoticon;
    } catch (error) {
      console.error('Failed to get emoticon:', error);
      return null;
    }
  }

  async getAllEmoticons(): Promise<Emoticon[]> {
    if (!this.db) await this.init();

    try {
      const emoticons = await this.db.getAll('emoticons');
      
      // 为每个表情包获取文件并创建新的 URL
      const results = await Promise.all(
        emoticons.map(async (emoticon: Emoticon) => {
          const file = await this.db.get('files', emoticon.id);
          if (file) {
            // 如果已经有 URL，先释放它
            if (emoticon.url?.startsWith('blob:')) {
              URL.revokeObjectURL(emoticon.url);
            }
            // 创建新的 URL
            emoticon.url = URL.createObjectURL(file);
          }
          return emoticon;
        })
      );

      return results;
    } catch (error) {
      console.error('Failed to get all emoticons:', error);
      return [];
    }
  }

  async deleteEmoticon(id: string): Promise<void> {
    if (!this.db) await this.init();

    const tx = this.db.transaction(['emoticons', 'files'], 'readwrite');
    
    try {
      await tx.objectStore('emoticons').delete(id);
      await tx.objectStore('files').delete(id);
      await tx.done;

      // 同时从文件系统删除
      await fileSystemService.deleteEmoticonFile(id);
      await fileSystemService.removeMetadataByIds([id]);
    } catch (error) {
      console.error('Failed to delete emoticon:', error);
      this.abortTransaction(tx);
      throw error;
    }
  }

  async deleteEmoticons(ids: string[]): Promise<void> {
    if (!this.db) await this.init();
    if (ids.length === 0) return;

    const tx = this.db.transaction(['emoticons', 'files'], 'readwrite');

    try {
      const emoticonsStore = tx.objectStore('emoticons');
      const filesStore = tx.objectStore('files');

      await Promise.all(ids.flatMap(id => [
        emoticonsStore.delete(id),
        filesStore.delete(id)
      ]));
      await tx.done;

      await fileSystemService.deleteEmoticonFiles(ids);
      await fileSystemService.removeMetadataByIds(ids);
    } catch (error) {
      console.error('Failed to delete emoticons:', error);
      this.abortTransaction(tx);
      throw error;
    }
  }

  // 清空全部表情包
  async clearAllEmoticons(): Promise<void> {
    if (!this.db) await this.init();

    const tx = this.db.transaction(['emoticons', 'files'], 'readwrite');
    
    try {
      // 获取所有表情包ID用于清理文件系统
      const emoticons = await this.db.getAll('emoticons');
      
      // 清空数据库
      await tx.objectStore('emoticons').clear();
      await tx.objectStore('files').clear();
      await tx.done;

      // 从文件系统删除所有表情包文件
      for (const emoticon of emoticons) {
        try {
          await fileSystemService.deleteEmoticonFile(emoticon.id);
        } catch (err) {
          console.warn(`Failed to delete file for emoticon ${emoticon.id}:`, err);
        }
      }
      
      // 清空文件系统的元数据
      await fileSystemService.saveMetadata([]);
    } catch (error) {
      console.error('Failed to clear all emoticons:', error);
      this.abortTransaction(tx);
      throw error;
    }
  }

  private sanitizeEmoticon(emoticon: Emoticon): Emoticon {
    return {
      id: emoticon.id,
      name: emoticon.name,
      url: emoticon.url?.startsWith('blob:') ? '' : emoticon.url,
      type: emoticon.type,
      favorite: emoticon.favorite,
      source: emoticon.source || 'local',
      createdAt: emoticon.createdAt,
      createTime: emoticon.createTime,
      updateTime: emoticon.updateTime,
      tags: Array.from(emoticon.tags || [])
    };
  }

  async updateEmoticon(emoticon: Emoticon): Promise<void> {
    if (!this.db) await this.init();
    
    const tx = this.db.transaction('emoticons', 'readwrite');
    
    try {
      const sanitizedEmoticon = this.sanitizeEmoticon(emoticon);
      await tx.objectStore('emoticons').put(sanitizedEmoticon);
      await tx.done;

      // 同步更新文件系统的元数据
      await fileSystemService.upsertMetadata(sanitizedEmoticon);
    } catch (error) {
      this.abortTransaction(tx);
      throw error;
    }
  }

  async updateEmoticons(emoticons: Emoticon[]): Promise<void> {
    if (!this.db) await this.init();
    if (emoticons.length === 0) return;

    const tx = this.db.transaction('emoticons', 'readwrite');

    try {
      const store = tx.objectStore('emoticons');
      const sanitizedEmoticons = emoticons.map(emoticon => this.sanitizeEmoticon(emoticon));

      await Promise.all(sanitizedEmoticons.map(emoticon => store.put(emoticon)));
      await tx.done;

      await fileSystemService.saveMetadata(await this.getAllEmoticonMetadata());
    } catch (error) {
      this.abortTransaction(tx);
      throw error;
    }
  }

  private abortTransaction(tx: { abort: () => void }) {
    try {
      tx.abort();
    } catch {
      // The transaction may already be committed when the filesystem sync fails.
    }
  }

  private async getAllEmoticonMetadata(): Promise<Emoticon[]> {
    if (!this.db) await this.init();
    return this.db.getAll('emoticons');
  }

  private withObjectUrl(emoticon: Emoticon, file: Blob): Emoticon {
    return {
      ...emoticon,
      url: URL.createObjectURL(file)
    };
  }

  // 改进从文件系统恢复数据的方法
  private async restoreFromFileSystem() {
    try {
      const emoticons = await fileSystemService.readMetadata();
      if (!emoticons.length) return;

      // 逐个处理表情包，确保事务不会过早结束
      for (const emoticon of emoticons) {
        try {
          const file = await fileSystemService.readEmoticonFile(emoticon.id);
          if (!file) continue;

          // 为每个表情包创建新的事务
          const tx = this.db.transaction(['emoticons', 'files'], 'readwrite');
          const emoticonsStore = tx.objectStore('emoticons');
          const filesStore = tx.objectStore('files');

          // 保存文件和元数据
          await Promise.all([
            filesStore.put(file, emoticon.id),
            emoticonsStore.put(emoticon)
          ]);

          // 等待当前事务完成
          await tx.done;
        } catch (err) {
          console.error(`Failed to restore emoticon ${emoticon.id}:`, err);
        }
      }
    } catch (error) {
      console.error('Failed to restore from file system:', error);
    }
  }
}

export const storageService = new StorageService(); 
