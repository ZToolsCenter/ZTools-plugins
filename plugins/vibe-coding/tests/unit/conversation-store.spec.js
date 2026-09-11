import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  CHECKPOINT_COMMIT_INTERVAL,
  TAIL_WINDOW_FILE_NAME,
  TAIL_WINDOW_MESSAGE_LIMIT,
  createConversationStore,
} = require('../../public/conversation-store.js')

/**
 * 创建满足 ZTools 同步数据库返回契约的内存数据库。
 * @returns {{documents: Map<string, Record<string, unknown>>, get: Function, put: Function, allDocs: Function, remove: Function}} 内存数据库。
 */
function createMemoryDb() {
  const documents = new Map()
  return {
    documents,
    get(id) { return documents.get(id) || null },
    put(document) {
      const revision = `${Number(document._rev?.split('-')[0] || 0) + 1}-test`
      documents.set(document._id, { ...structuredClone(document), _rev: revision })
      return { ok: true, id: document._id, rev: revision }
    },
    allDocs(prefix) { return [...documents.values()].filter((document) => document._id.startsWith(prefix)) },
    remove(document) {
      documents.delete(document._id)
      return { ok: true, id: document._id }
    },
  }
}

/**
 * 将测试会话规范化为存储层需要的稳定结构。
 * @param {Record<string, unknown>} value 原始会话。
 * @returns {Record<string, unknown>} 规范化会话。
 */
function normalizeConversation(value = {}) {
  return {
    storageVersion: 4,
    id: String(value.id || ''),
    title: String(value.title || '新的对话'),
    modelKey: String(value.modelKey || ''),
    reasoningEffort: String(value.reasoningEffort || ''),
    messages: Array.isArray(value.messages) ? value.messages : [],
    projectId: String(value.projectId || ''),
    workspaceLocked: value.workspaceLocked === true,
    enabledTools: Array.isArray(value.enabledTools) ? value.enabledTools : [],
    enabledSkills: Array.isArray(value.enabledSkills) ? value.enabledSkills : [],
    autoApproveTools: value.autoApproveTools !== false,
    tasks: Array.isArray(value.tasks) ? value.tasks : [],
    pendingMessages: Array.isArray(value.pendingMessages) ? value.pendingMessages : [],
    contextState: value.contextState && typeof value.contextState === 'object' ? value.contextState : {},
    contextMeter: value.contextMeter && typeof value.contextMeter === 'object' ? value.contextMeter : { usedTokens: 0, contextWindow: 0, breakdown: {} },
    hasImages: value.hasImages === true,
    messageCount: Array.isArray(value.messages) ? value.messages.length : Math.max(0, Number(value.messageCount) || 0),
    createdAt: Number(value.createdAt) || 1,
    updatedAt: Number(value.updatedAt) || 1,
  }
}

/**
 * 创建指向临时目录的会话存储实例。
 * @param {string} rootDirectory 临时日志根目录。
 * @param {ReturnType<typeof createMemoryDb>} db 内存数据库。
 * @returns {ReturnType<typeof createConversationStore>} 会话存储实例。
 */
function createStore(rootDirectory, db) {
  return createConversationStore({
    getDb: () => db,
    getRootDirectory: () => rootDirectory,
    normalizeConversation,
    documentPrefix: 'zvc/conversations/',
  })
}

test('超过 1MB 的会话正文写入 JSONL，数据库只保留轻量索引', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zvc-jsonl-unit-'))
  try {
    const db = createMemoryDb()
    const store = createStore(temporaryRoot, db)
    const largeContent = '长内容'.repeat(400_000)
    const conversation = normalizeConversation({
      id: 'large-session',
      title: '大型会话',
      modelKey: 'provider-a::model-a',
      reasoningEffort: 'xhigh',
      projectId: 'workspace-a',
      workspaceLocked: true,
      messages: [{ id: 'message-1', role: 'user', content: largeContent }],
      contextState: { summary: '摘要' },
      createdAt: 10,
      updatedAt: 10,
    })

    store.create(conversation)

    const document = db.get('zvc/conversations/large-session')
    assert.ok(Buffer.byteLength(JSON.stringify(document)) < 10_000)
    assert.equal(document.metadata.messages, undefined)
    assert.equal(document.metadata.modelKey, 'provider-a::model-a')
    assert.equal(document.metadata.reasoningEffort, 'xhigh')
    assert.equal(document.metadata.projectId, 'workspace-a')
    assert.equal(document.metadata.workspaceLocked, true)
    assert.ok(fs.statSync(store.getLogPath(conversation.id)).size > 1024 * 1024)
    assert.equal(store.list()[0].messages.length, 0)

    // 使用全新实例模拟切换会话或插件重载后的日志重放。
    const restored = createStore(temporaryRoot, db).get(conversation.id)
    assert.equal(restored.messages[0].content.length, largeContent.length)
    assert.equal(restored.contextState.summary, '摘要')
    assert.equal(restored.modelKey, 'provider-a::model-a')
    assert.equal(restored.reasoningEffort, 'xhigh')
    assert.equal(restored.workspaceLocked, true)
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

test('读取轻量元数据时不依赖会话日志内容', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zvc-jsonl-unit-'))
  try {
    const db = createMemoryDb()
    const store = createStore(temporaryRoot, db)
    const conversation = normalizeConversation({
      id: 'metadata-session',
      title: '轻量索引',
      messages: [{ id: 'message-1', role: 'user', content: '不应读取' }],
      createdAt: 15,
      updatedAt: 16,
    })
    store.create(conversation)
    fs.writeFileSync(store.getLogPath(conversation.id), '损坏的日志')

    const metadata = createStore(temporaryRoot, db).getMetadata(conversation.id)
    assert.equal(metadata.title, '轻量索引')
    assert.deepEqual(metadata.messages, [])
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

test('冷启动状态和尾页从窗口快照读取且不解析完整 JSONL', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zvc-jsonl-unit-'))
  try {
    const db = createMemoryDb()
    const store = createStore(temporaryRoot, db)
    const messages = Array.from({ length: 120 }, (_, index) => ({
      id: `message-${index}`,
      turnId: `turn-${Math.floor(index / 3)}`,
      role: index % 3 ? 'assistant' : 'user',
      content: `消息 ${index}`,
    }))
    const conversation = normalizeConversation({
      id: 'window-cold-session',
      title: '尾部窗口',
      messages,
      tasks: [{ content: '保留状态', status: 'pending' }],
      createdAt: 17,
      updatedAt: 18,
    })
    store.create(conversation)

    const logPath = store.getLogPath(conversation.id)
    const originalLog = fs.readFileSync(logPath)
    // 保持日志字节边界不变但破坏正文，证明冷启动页面不会读取 JSONL 内容。
    fs.writeFileSync(logPath, Buffer.alloc(originalLog.length, 32))
    const coldStore = createStore(temporaryRoot, db)
    assert.deepEqual(coldStore.getState(conversation.id).tasks, conversation.tasks)
    assert.deepEqual(
      coldStore.getPage(conversation.id, { limit: 6 }).messages.map((message) => message.content),
      messages.slice(-6).map((message) => message.content),
    )
    assert.throws(() => coldStore.get(conversation.id), /会话日志/)
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

test('尾部窗口限制目标数量但会向前扩展到完整 Turn', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zvc-jsonl-unit-'))
  try {
    const db = createMemoryDb()
    const store = createStore(temporaryRoot, db)
    const messages = [
      ...Array.from({ length: 35 }, (_, index) => ({ id: `head-${index}`, turnId: `head-${index}`, role: 'user', content: `H${index}` })),
      ...Array.from({ length: 10 }, (_, index) => ({ id: `wide-${index}`, turnId: 'wide-turn', role: 'assistant', content: `W${index}` })),
      ...Array.from({ length: 95 }, (_, index) => ({ id: `tail-${index}`, turnId: `tail-${index}`, role: 'assistant', content: `T${index}` })),
    ]
    const conversation = normalizeConversation({ id: 'turn-window-session', messages, createdAt: 18, updatedAt: 18 })
    store.create(conversation)

    const windowPath = path.join(path.dirname(store.getLogPath(conversation.id)), TAIL_WINDOW_FILE_NAME)
    const snapshot = JSON.parse(fs.readFileSync(windowPath, 'utf8'))
    assert.equal(snapshot.start, 35)
    assert.equal(snapshot.messages.length, TAIL_WINDOW_MESSAGE_LIMIT + 5)
    const page = createStore(temporaryRoot, db).getPage(conversation.id, { limit: TAIL_WINDOW_MESSAGE_LIMIT })
    assert.equal(page.start, 35)
    assert.equal(page.messages[0].turnId, 'wide-turn')
    assert.equal(page.messages.filter((message) => message.turnId === 'wide-turn').length, 10)
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

test('日志字节边界变化后拒绝旧窗口并通过完整重放修复快照', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zvc-jsonl-unit-'))
  try {
    const db = createMemoryDb()
    const store = createStore(temporaryRoot, db)
    const conversation = normalizeConversation({
      id: 'stale-window-session',
      messages: [{ id: 'message-1', role: 'user', content: '有效内容' }],
      createdAt: 19,
      updatedAt: 19,
    })
    store.create(conversation)
    const logPath = store.getLogPath(conversation.id)
    const windowPath = path.join(path.dirname(logPath), TAIL_WINDOW_FILE_NAME)
    const originalWindow = JSON.parse(fs.readFileSync(windowPath, 'utf8'))
    fs.appendFileSync(logPath, '{"type":"conversation/commit"')

    const state = createStore(temporaryRoot, db).getState(conversation.id)
    const repairedWindow = JSON.parse(fs.readFileSync(windowPath, 'utf8'))
    assert.equal(state.id, conversation.id)
    assert.equal(fs.statSync(logPath).size, originalWindow.logBytes)
    assert.equal(repairedWindow.logBytes, originalWindow.logBytes)
    assert.deepEqual(createStore(temporaryRoot, db).getPage(conversation.id).messages, conversation.messages)
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

test('保存时只追加变化消息并保留完整时间线顺序', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zvc-jsonl-unit-'))
  try {
    const db = createMemoryDb()
    const store = createStore(temporaryRoot, db)
    const original = normalizeConversation({
      id: 'append-session',
      messages: [{ id: 'message-1', role: 'user', content: '问题' }],
      createdAt: 20,
      updatedAt: 20,
    })
    store.create(original)
    const replayState = {
      version: 1,
      apiFormat: 'anthropic-messages',
      providerId: 'provider-anthropic',
      model: 'claude-test',
      blocks: [
        {
          type: 'thinking',
          item: { type: 'thinking', thinking: '分析', signature: 'signed-thinking' },
        },
      ],
    }
    store.save(normalizeConversation({
      ...original,
      messages: [
        ...original.messages,
        { id: 'message-2', role: 'assistant', content: '回答', replay_state: replayState },
      ],
      updatedAt: 21,
    }))

    const lines = fs.readFileSync(store.getLogPath(original.id), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    assert.equal(lines.length, 3)
    assert.equal(lines[1].type, 'conversation/checkpoint')
    assert.equal(lines[2].type, 'conversation/commit')
    assert.equal(lines[2].seq, 1)
    assert.deepEqual(lines[2].messages.upserts.map((item) => item.key), ['id:message-2'])
    assert.deepEqual(lines[2].messages.appended, ['id:message-2'])
    assert.equal(lines[2].messages.order, undefined)
    const restoredMessages = createStore(temporaryRoot, db).get(original.id).messages
    assert.deepEqual(restoredMessages.map((message) => message.content), ['问题', '回答'])
    assert.deepEqual(restoredMessages[1].replay_state, replayState)
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

test('原子提交只写入调用方声明的消息变化并更新轻量状态', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zvc-jsonl-unit-'))
  try {
    const db = createMemoryDb()
    const store = createStore(temporaryRoot, db)
    const messages = Array.from({ length: 200 }, (_, index) => ({ id: `message-${index}`, role: 'user', content: `原文 ${index}` }))
    store.create(normalizeConversation({ id: 'atomic-session', messages, createdAt: 21, updatedAt: 21 }))

    const changed = { ...messages[199], content: '已更新' }
    const appended = { id: 'message-200', role: 'assistant', content: '新增回答' }
    const metadata = store.commit('atomic-session', {
      state: { title: '原子写入', updatedAt: 22 },
      upserts: [changed, appended],
    })

    const lines = fs.readFileSync(store.getLogPath('atomic-session'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    const event = lines.at(-1)
    assert.equal(event.type, 'conversation/commit')
    assert.deepEqual(event.messages.upserts.map((item) => item.message.id), ['message-199', 'message-200'])
    assert.deepEqual(event.messages.appended, ['id:message-200'])
    assert.equal(metadata.messageCount, 201)
    assert.equal(store.getState('atomic-session').messages, undefined)
    assert.deepEqual(store.getPage('atomic-session', { limit: 2 }).messages.map((message) => message.content), ['已更新', '新增回答'])
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

test('历史分页按完整 Turn 返回并支持继续向前读取', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zvc-jsonl-unit-'))
  try {
    const db = createMemoryDb()
    const store = createStore(temporaryRoot, db)
    const messages = [
      ...Array.from({ length: 4 }, (_, index) => ({ id: `a-${index}`, turnId: 'turn-a', role: 'assistant', content: `A${index}` })),
      ...Array.from({ length: 4 }, (_, index) => ({ id: `b-${index}`, turnId: 'turn-b', role: 'assistant', content: `B${index}` })),
      ...Array.from({ length: 4 }, (_, index) => ({ id: `c-${index}`, turnId: 'turn-c', role: 'assistant', content: `C${index}` })),
    ]
    store.create(normalizeConversation({ id: 'paged-session', messages, createdAt: 22, updatedAt: 22 }))

    const tail = store.getPage('paged-session', { limit: 5 })
    assert.equal(tail.start, 4)
    assert.equal(tail.hasMore, true)
    assert.deepEqual([...new Set(tail.messages.map((message) => message.turnId))], ['turn-b', 'turn-c'])
    const older = store.getPage('paged-session', { before: tail.start, limit: 5 })
    assert.equal(older.start, 0)
    assert.equal(older.hasMore, false)
    assert.deepEqual([...new Set(older.messages.map((message) => message.turnId))], ['turn-a'])
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

test('达到提交阈值后日志压实为单个检查点且完整状态可恢复', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zvc-jsonl-unit-'))
  try {
    const db = createMemoryDb()
    const store = createStore(temporaryRoot, db)
    let conversation = normalizeConversation({ id: 'checkpoint-session', createdAt: 23, updatedAt: 23 })
    store.create(conversation)
    for (let index = 0; index < CHECKPOINT_COMMIT_INTERVAL; index += 1) {
      conversation = normalizeConversation({
        ...conversation,
        messages: [...conversation.messages, { id: `message-${index}`, role: 'user', content: String(index) }],
        updatedAt: 24 + index,
      })
      store.save(conversation)
    }

    const lines = fs.readFileSync(store.getLogPath(conversation.id), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    assert.equal(lines.length, 2)
    assert.equal(lines[1].type, 'conversation/checkpoint')
    assert.equal(lines[1].seq, CHECKPOINT_COMMIT_INTERVAL)
    store.release(conversation.id)
    assert.equal(store.get(conversation.id).messages.length, CHECKPOINT_COMMIT_INTERVAL)
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

test('任务快照跟随各自会话写入和重放', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zvc-jsonl-unit-'))
  try {
    const db = createMemoryDb()
    const store = createStore(temporaryRoot, db)
    const first = normalizeConversation({
      id: 'tasks-first',
      tasks: [{ content: '处理第一个会话', status: 'in_progress' }],
      createdAt: 25,
      updatedAt: 25,
    })
    const second = normalizeConversation({
      id: 'tasks-second',
      tasks: [{ content: '处理第二个会话', status: 'pending' }],
      createdAt: 26,
      updatedAt: 26,
    })
    store.create(first)
    store.create(second)

    // 使用新的存储实例验证任务来自各自 JSONL，而不是进程内共享状态。
    const restored = createStore(temporaryRoot, db)
    assert.deepEqual(restored.get(first.id).tasks, first.tasks)
    assert.deepEqual(restored.get(second.id).tasks, second.tasks)
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

test('待处理消息只写入会话 JSONL 并可在新进程中恢复', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zvc-jsonl-unit-'))
  try {
    const db = createMemoryDb()
    const store = createStore(temporaryRoot, db)
    const conversation = normalizeConversation({
      id: 'inbox-session',
      pendingMessages: [
        { id: 'queued', text: '排队消息', placement: 'queued', attachments: [], createdAt: 27 },
        { id: 'steering', text: '插话消息', placement: 'steering', attachments: [], createdAt: 28 },
      ],
      createdAt: 27,
      updatedAt: 28,
    })
    store.create(conversation)

    const document = db.get('zvc/conversations/inbox-session')
    assert.equal(document.metadata.pendingMessages, undefined)
    const restored = createStore(temporaryRoot, db).get(conversation.id)
    assert.deepEqual(restored.pendingMessages, conversation.pendingMessages)
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

test('加载时截断不完整日志尾部并从最后有效事件恢复', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zvc-jsonl-unit-'))
  try {
    const db = createMemoryDb()
    const store = createStore(temporaryRoot, db)
    const conversation = normalizeConversation({
      id: 'repair-session',
      messages: [{ id: 'message-1', role: 'user', content: '保留内容' }],
      createdAt: 30,
      updatedAt: 30,
    })
    store.create(conversation)
    const logPath = store.getLogPath(conversation.id)
    fs.appendFileSync(logPath, '{"type":"conversation/state"')

    const restored = createStore(temporaryRoot, db).get(conversation.id)
    assert.equal(restored.messages[0].content, '保留内容')
    assert.equal(fs.readFileSync(logPath, 'utf8').endsWith('\n'), true)
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

test('删除会话时同时清理数据库索引和本地日志', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zvc-jsonl-unit-'))
  try {
    const db = createMemoryDb()
    const store = createStore(temporaryRoot, db)
    const conversation = normalizeConversation({ id: 'remove-session', createdAt: 40, updatedAt: 40 })
    store.create(conversation)
    const logPath = store.getLogPath(conversation.id)

    assert.equal(store.remove(conversation.id), true)
    assert.equal(db.get('zvc/conversations/remove-session'), null)
    assert.equal(fs.existsSync(logPath), false)
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }
})
