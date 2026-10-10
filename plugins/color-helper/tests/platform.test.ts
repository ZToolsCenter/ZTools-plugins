import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { db, dbStorage, copyText } from '../utils/platform';

/**
 * utils/platform.ts 的浏览器降级路径
 *
 * 注意: 本文件在 happy-dom 下运行 —— 模块顶层就读了 window.platform,
 * node 环境会直接抛 "window is not defined"(见 vitest.config.ts 的 environment)。
 * 测试只需保证 window.platform 不存在, 即走降级分支。
 */

const PREFIX = 'color_helper_';

beforeEach(() => {
  localStorage.clear();
  delete (window as any).platform;
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('dbStorage 降级(localStorage)', () => {
  it('setItem / getItem 往返, 存的是 JSON', () => {
    dbStorage.setItem('setting', true);
    expect(localStorage.getItem(`${PREFIX}setting`)).toBe('true');
    expect(dbStorage.getItem('setting')).toBe(true);
  });

  it('未设置的 key 返回 null', () => {
    expect(dbStorage.getItem('nope')).toBeNull();
  });

  it('removeItem 移除键', () => {
    dbStorage.setItem('k', 1);
    dbStorage.removeItem('k');
    expect(dbStorage.getItem('k')).toBeNull();
  });

  it('**损坏的 JSON 返回 null 而不是抛错**', () => {
    localStorage.setItem(`${PREFIX}broken`, '{ not json');
    expect(() => dbStorage.getItem('broken')).not.toThrow();
    expect(dbStorage.getItem('broken')).toBeNull();
  });
});

describe('db 降级(localStorage)', () => {
  it('put 写入并按 _rev 递增', () => {
    const r1 = db.put({ _id: 'c1', color: '#fff' });
    expect(r1).toMatchObject({ ok: true, id: 'c1', rev: '1' });

    const r2 = db.put({ _id: 'c1', color: '#000' });
    expect(r2.rev).toBe('2');
    expect(db.get('c1')).toMatchObject({ _id: 'c1', color: '#000', _rev: '2' });
  });

  it('get 对损坏 JSON 返回 null 而不是抛错', () => {
    localStorage.setItem(`${PREFIX}db_c2`, '}}}');
    expect(() => db.get('c2')).not.toThrow();
    expect(db.get('c2')).toBeNull();
  });

  it('remove 删除文档', () => {
    db.put({ _id: 'c3' });
    expect(db.remove({ _id: 'c3' })).toEqual({ ok: true });
    expect(db.get('c3')).toBeNull();
  });

  it('allDocs 返回全部文档', () => {
    db.put({ _id: 'collect_1', color: '#111' });
    db.put({ _id: 'collect_2', color: '#222' });
    db.put({ _id: 'other_1', color: '#333' });
    const all = db.allDocs();
    expect(all.map((d) => d._id).sort()).toEqual(['collect_1', 'collect_2', 'other_1']);
  });

  it('allDocs(key) 按 _id 前缀过滤', () => {
    db.put({ _id: 'collect_1' });
    db.put({ _id: 'collect_2' });
    db.put({ _id: 'other_1' });
    expect(db.allDocs('collect').map((d) => d._id).sort()).toEqual(['collect_1', 'collect_2']);
  });

  it('**单个文档损坏只跳过该条, 其余照常返回**', () => {
    db.put({ _id: 'collect_1', color: '#111' });
    db.put({ _id: 'collect_2', color: '#222' });
    // 插一条坏数据, 模拟一个文档写坏
    localStorage.setItem(`${PREFIX}db_collect_bad`, '{ oops');

    const docs = db.allDocs('collect');
    expect(docs.map((d) => d._id).sort()).toEqual(['collect_1', 'collect_2']);
    // 关键: 不是返回 []
    expect(docs.length).toBe(2);
  });

  it('全部文档都损坏时返回空数组(不是抛错)', () => {
    localStorage.setItem(`${PREFIX}db_a`, '{');
    localStorage.setItem(`${PREFIX}db_b`, '}');
    expect(() => db.allDocs()).not.toThrow();
    expect(db.allDocs()).toEqual([]);
  });

  it('忽略前缀不匹配的 localStorage 键', () => {
    localStorage.setItem('unrelated_key', JSON.stringify({ _id: 'x' }));
    localStorage.setItem(`${PREFIX}other`, 'plain string');
    expect(db.allDocs()).toEqual([]);
  });
});

describe('db 走平台分支时的返回形状', () => {
  /**
   * 官方 db.put 返回 DbReturn { id, rev?, ok?, error?, name?, message? }
   * (ztools.api.d.ts), 注意 ok 是**可选**、error 是**布尔**。
   * 而降级分支返回的是 { ok: boolean, id, rev?, error?: string } ——
   * 两个分支必须归一化成同一形状, 否则调用方的 `result.ok` / `result.error` 判据会分裂。
   */
  async function withPlatformDb(pdb: any) {
    (window as any).platform = { db: pdb };
    vi.resetModules();
    return (await import('../utils/platform')).db;
  }

  afterEach(() => {
    vi.resetModules();
  });

  it('put 归一化 DbReturn: ok/rev 透传, 无 error 时 error 为 undefined', async () => {
    const put = vi.fn(() => ({ id: 'c1', rev: '3-abc', ok: true }));
    const db = await withPlatformDb({ put });

    const r = db.put({ _id: 'c1', color: '#fff' });

    expect(put).toHaveBeenCalledWith({ _id: 'c1', color: '#fff' });
    expect(r).toEqual({ ok: true, id: 'c1', rev: '3-abc', error: undefined });
    // 调用方 CollectColorsPage 靠 result.rev 回写 _rev, 这个字段必须留着
    expect(r.rev).toBe('3-abc');
  });

  it('put 遇到 error:true 时补出可读的 error 文案(优先 message)', async () => {
    const db = await withPlatformDb({
      put: () => ({ id: 'c1', error: true, name: 'conflict', message: 'Document update conflict' }),
    });
    const r = db.put({ _id: 'c1' });

    expect(r.ok).toBe(false);
    expect(r.error).toBe('Document update conflict');
    expect(r.rev).toBeUndefined();
  });

  it('put 的 error 没有 message/name 时也要给出非空文案', async () => {
    const db = await withPlatformDb({ put: () => ({ id: 'c1', error: true }) });
    const r = db.put({ _id: 'c1' });

    expect(r.ok).toBe(false);
    expect(typeof r.error).toBe('string');
    expect(r.error).toBeTruthy();
  });

  it('remove 走平台分支并归一化', async () => {
    const remove = vi.fn(() => ({ id: 'c1', ok: true }));
    const db = await withPlatformDb({ remove });

    expect(db.remove({ _id: 'c1' })).toEqual({ ok: true, error: undefined });
    expect(remove).toHaveBeenCalledWith({ _id: 'c1' });
  });

  it('**两个分支的返回形状一致** —— 调用方不需要区分自己跑在哪边', async () => {
    // 平台分支
    const dbPlatform = await withPlatformDb({ put: () => ({ id: 'x', rev: '1', ok: true }) });
    const fromPlatform = dbPlatform.put({ _id: 'x' });

    // 降级分支
    delete (window as any).platform;
    vi.resetModules();
    const dbLocal = (await import('../utils/platform')).db;
    const fromLocal = dbLocal.put({ _id: 'x' });

    expect(Object.keys(fromPlatform).sort()).toEqual(Object.keys(fromLocal).sort());
    expect(typeof fromPlatform.ok).toBe(typeof fromLocal.ok);
    expect(typeof fromPlatform.id).toBe(typeof fromLocal.id);
  });
});

describe('aiChat 不能凭空塞模型 ID', () => {
  /**
   * 宿主的 resolveModel 只在 model 留空时才走兜底「首个已开启供应商的首个模型」;
   * 传一个它解析不出的 ID 会直接返回 null, 调用点报「未找到 AI 模型配置」,
   * 用户自己配好的模型也用不了 —— 所以这里不能有任何硬编码的默认模型。
   */
  async function withPlatformAi(ai: any) {
    (window as any).platform = { ai };
    vi.resetModules();
    return await import('../utils/platform');
  }

  /** 取自录一次 ai() 收到的 option */
  const lastOption = (ai: any) => ai.mock.calls[0][0] as { model?: string; messages: unknown[] };

  afterEach(() => {
    vi.resetModules();
  });

  it('**不传 model 时 option.model 必须是 undefined**, 不能有硬编码默认值', async () => {
    const ai = vi.fn(async () => ({ role: 'assistant', content: 'ok' }));
    const p = await withPlatformAi(ai);

    await p.aiChat([{ role: 'user', content: 'hi' }]);

    expect(ai).toHaveBeenCalledTimes(1);
    const option = lastOption(ai);
    expect(option.model).toBeUndefined();
    expect(Object.keys(option).sort()).toEqual(['messages', 'model']);
  });

  it('不传 model 时 option 里没有硬编码的供应商模型 ID', async () => {
    const ai = vi.fn(async () => ({ role: 'assistant', content: 'ok' }));
    const p = await withPlatformAi(ai);

    await p.aiChat([{ role: 'user', content: 'hi' }]);

    expect(JSON.stringify(lastOption(ai))).not.toMatch(/doubao|gpt-|qwen/i);
  });

  it('显式传入 model 时原样透传', async () => {
    const ai = vi.fn(async () => ({ role: 'assistant', content: 'ok' }));
    const p = await withPlatformAi(ai);

    await p.aiChat([{ role: 'user', content: 'hi' }], 'some-provider:model-x');

    expect(lastOption(ai).model).toBe('some-provider:model-x');
  });

  it('isAIAvailable 直接看 platform.ai, 不依赖其他字段', async () => {
    expect((await withPlatformAi(undefined)).isAIAvailable()).toBe(false);
    expect((await withPlatformAi(vi.fn())).isAIAvailable()).toBe(true);
  });
});

describe('copyText 的降级与回退', () => {
  it('平台存在时直接走平台 API, 不碰 navigator.clipboard', async () => {
    // platform 是模块顶层读的(const platform = window.platform),
    // 所以必须重置模块注册表后重新 import 才能让桩生效
    const platformCopy = vi.fn();
    (window as any).platform = { copyText: platformCopy };
    const clipboardSpy = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText: clipboardSpy } });

    vi.resetModules();
    const fresh = await import('../utils/platform');
    fresh.copyText('#abcdef');

    expect(platformCopy).toHaveBeenCalledWith('#abcdef');
    expect(clipboardSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('clipboard.writeText 成功时不走 execCommand', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const execSpy = vi.fn(() => true);
    document.execCommand = execSpy;

    copyText('#123456');
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith('#123456');
    expect(execSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('clipboard 被拒(Promise reject)时回退到 execCommand', async () => {
    // try/catch 必须能接住 Promise 的异步 reject:
    // 同步 try/catch 接不住的话, 权限被拒时会静默丢弃, 走不到回退分支。
    const writeText = vi.fn(() => Promise.reject(new Error('NotAllowedError')));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const execSpy = vi.fn(() => true);
    document.execCommand = execSpy;

    copyText('#aabbcc');
    // 等 writeText 的 reject 被 catch 处理
    await new Promise((r) => setTimeout(r, 0));

    expect(writeText).toHaveBeenCalledWith('#aabbcc');
    expect(execSpy).toHaveBeenCalledWith('copy');
    vi.unstubAllGlobals();
  });

  it('navigator.clipboard 不存在(非安全上下文)时直接走 execCommand', () => {
    vi.stubGlobal('navigator', {});
    const execSpy = vi.fn(() => true);
    document.execCommand = execSpy;

    copyText('#000000');

    expect(execSpy).toHaveBeenCalledWith('copy');
    vi.unstubAllGlobals();
  });

  it('回退实现不留残留 textarea 在 DOM 里', () => {
    vi.stubGlobal('navigator', {});
    document.execCommand = vi.fn(() => true);

    copyText('#eeeeee');

    expect(document.querySelectorAll('textarea')).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it('回退实现把文本写进了 textarea', () => {
    vi.stubGlobal('navigator', {});
    let captured = '';
    document.execCommand = vi.fn(() => {
      captured = (document.querySelector('textarea') as HTMLTextAreaElement)?.value ?? '';
      return true;
    });

    copyText('#fedcba');

    expect(captured).toBe('#fedcba');
    vi.unstubAllGlobals();
  });
});
