const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const workspace = require('../public/preload/services.js')

async function withTemporaryDirectory(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'znotes-test-'))
  try {
    await run(directory)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}

test('creates a workspace with stable identity and reserved directories', async () => {
  await withTemporaryDirectory(async (directory) => {
    const created = await workspace.createWorkspace(directory, '工作')
    const loaded = await workspace.readWorkspace(directory)
    assert.equal(created.name, '工作')
    assert.equal(loaded.id, created.id)
    assert.equal(loaded.version, 1)
    await fs.access(path.join(directory, '.assets'))
    await fs.access(path.join(directory, '.trash'))
  })
})

test('creates and reopens the default workspace under Documents', async () => {
  await withTemporaryDirectory(async (documents) => {
    const first = await workspace.openDefaultWorkspace(documents)
    const second = await workspace.openDefaultWorkspace(documents)
    assert.equal(first.workspace.path, path.join(documents, 'ZTools Markdown Notes'))
    assert.equal(second.workspace.id, first.workspace.id)
  })
})

test('renames a workspace identity and preserves its stable id', async () => {
  await withTemporaryDirectory(async (root) => {
    const created = await workspace.createWorkspace(root, '原名称')
    const renamed = await workspace.renameWorkspace(root, '新名称')
    assert.equal(renamed.id, created.id)
    assert.equal(renamed.name, '新名称')
    assert.equal((await workspace.readWorkspace(root)).name, '新名称')
  })
})

test('relinks only when the selected directory has the expected workspace id', async () => {
  await withTemporaryDirectory(async (firstRoot) => {
    await withTemporaryDirectory(async (secondRoot) => {
      const first = await workspace.createWorkspace(firstRoot, '一号')
      const second = await workspace.createWorkspace(secondRoot, '二号')
      assert.equal((await workspace.relinkWorkspace(firstRoot, first.id)).id, first.id)
      await assert.rejects(() => workspace.relinkWorkspace(secondRoot, first.id), { code: 'WORKSPACE_ID_MISMATCH' })
      assert.notEqual(first.id, second.id)
    })
  })
})

test('discovers workspaces only within three directory levels', async () => {
  await withTemporaryDirectory(async (root) => {
    const directRoot = path.join(root, '直接工作区')
    const nestedRoot = path.join(root, '一层', '二层', '三层')
    const tooDeepRoot = path.join(root, '另一层', '二层', '三层', '四层')
    await workspace.createWorkspace(directRoot, '直接')
    await workspace.createWorkspace(nestedRoot, '三层')
    await workspace.createWorkspace(tooDeepRoot, '四层')

    const found = await workspace.discoverWorkspaces(root)
    assert.deepEqual(found.map((item) => item.name).sort(), ['三层', '直接'])
  })
})

test('migrates a workspace into an empty directory and retains the original', async () => {
  await withTemporaryDirectory(async (parent) => {
    const source = path.join(parent, 'source')
    const target = path.join(parent, 'target')
    const created = await workspace.createWorkspace(source, '默认工作区')
    await fs.writeFile(path.join(source, '笔记.md'), '# 内容')
    await fs.mkdir(path.join(source, '.assets', '2026', '09'), { recursive: true })
    await fs.writeFile(path.join(source, '.assets', '2026', '09', '附件.bin'), Buffer.from([0, 1, 2, 3, 255]))
    await workspace.createNote(source, '', '待恢复')
    const deleted = await workspace.moveEntryToTrash(source, '待恢复.md')
    await fs.mkdir(target)

    const migrated = await workspace.migrateWorkspace(source, target)
    assert.equal(migrated.id, created.id)
    assert.equal(await fs.readFile(path.join(target, '笔记.md'), 'utf8'), '# 内容')
    assert.deepEqual(await fs.readFile(path.join(target, '.assets', '2026', '09', '附件.bin')), Buffer.from([0, 1, 2, 3, 255]))
    assert.equal(await fs.readFile(path.join(target, '.trash', deleted.id, 'entry'), 'utf8'), '')
    assert.equal(await fs.readFile(path.join(source, '笔记.md'), 'utf8'), '# 内容')
    assert.deepEqual(await fs.readFile(path.join(source, '.assets', '2026', '09', '附件.bin')), Buffer.from([0, 1, 2, 3, 255]))
    assert.equal((await workspace.readWorkspace(source)).id, created.id)
  })
})

test('rejects migration into a non-empty or nested directory', async () => {
  await withTemporaryDirectory(async (parent) => {
    const source = path.join(parent, 'source')
    const nonEmptyTarget = path.join(parent, 'non-empty')
    const nestedTarget = path.join(source, 'nested')
    await workspace.createWorkspace(source, '默认工作区')
    await fs.mkdir(nonEmptyTarget)
    await fs.writeFile(path.join(nonEmptyTarget, 'keep.txt'), 'keep')
    await fs.mkdir(nestedTarget)

    await assert.rejects(() => workspace.migrateWorkspace(source, nonEmptyTarget), { code: 'TARGET_NOT_EMPTY' })
    await assert.rejects(() => workspace.migrateWorkspace(source, nestedTarget), { code: 'NESTED_WORKSPACE_PATH' })
    assert.equal(await fs.readFile(path.join(nonEmptyTarget, 'keep.txt'), 'utf8'), 'keep')
  })
})

test('scans directories and Markdown notes while hiding reserved and unrelated files', async () => {
  await withTemporaryDirectory(async (directory) => {
    await workspace.createWorkspace(directory, '工作')
    await fs.mkdir(path.join(directory, '前端'))
    await fs.writeFile(path.join(directory, '前端', 'Vue.md'), '# Vue')
    await fs.writeFile(path.join(directory, 'ignore.txt'), 'ignored')
    await fs.writeFile(path.join(directory, '.assets', 'hidden.md'), 'hidden')
    const result = await workspace.scanWorkspace(directory)
    assert.deepEqual(result.entries.map((entry) => entry.name), ['前端'])
    assert.deepEqual(result.entries[0].children.map((entry) => entry.name), ['Vue'])
  })
})

test('rejects invalid identity files', async () => {
  await withTemporaryDirectory(async (directory) => {
    await fs.writeFile(path.join(directory, '.znotes-workspace.json'), '{"version":2}')
    await assert.rejects(() => workspace.readWorkspace(directory), { code: 'INVALID_IDENTITY' })
  })
})

test('prevents note paths from escaping the workspace or entering reserved directories', async () => {
  await withTemporaryDirectory(async (directory) => {
    await workspace.createWorkspace(directory, '工作')
    await assert.rejects(() => workspace.readNote(directory, '../outside.md'), { code: 'PATH_OUTSIDE_WORKSPACE' })
    await assert.rejects(() => workspace.readNote(directory, '.trash/deleted.md'), { code: 'RESERVED_PATH' })
    await assert.rejects(() => workspace.saveNote(directory, '.TRASH/deleted.md', 'hidden', null), {
      code: 'RESERVED_PATH',
    })
  })
})

test('searches notes in filename, path, headings, and body using the specified ranking', async () => {
  await withTemporaryDirectory(async (directory) => {
    await workspace.createWorkspace(directory, '工作')
    await fs.mkdir(path.join(directory, 'Vue资料'))
    await fs.writeFile(path.join(directory, 'Vue.md'), '普通正文')
    await fs.writeFile(path.join(directory, 'Vue指南.md'), '普通正文')
    await fs.writeFile(path.join(directory, 'Vue资料', '索引.md'), '普通正文')
    await fs.writeFile(path.join(directory, '标题.md'), '# Vue 响应式原理\n其他内容')
    await fs.writeFile(path.join(directory, '正文.md'), '这里记录 Vue 的使用方式和注意事项')
    await fs.writeFile(path.join(directory, '.assets', 'Vue隐藏.md'), '# Vue')

    const results = await workspace.searchWorkspace(directory, 'Vue')
    assert.deepEqual(results.map((result) => result.relativePath), [
      'Vue.md',
      'Vue指南.md',
      'Vue资料/索引.md',
      '标题.md',
      '正文.md',
    ])
    assert.match(results.at(-1).snippet, /Vue/)
  })
})

test('returns no workspace search results for a blank query and rejects an oversized query', async () => {
  await withTemporaryDirectory(async (directory) => {
    await workspace.createWorkspace(directory, '工作')
    assert.deepEqual(await workspace.searchWorkspace(directory, '   '), [])
    await assert.rejects(() => workspace.searchWorkspace(directory, 'a'.repeat(201)), { code: 'INVALID_SEARCH_QUERY' })
  })
})

test('resolves relative Markdown links inside the workspace and rejects unsafe targets', async () => {
  await withTemporaryDirectory(async (directory) => {
    await workspace.createWorkspace(directory, '工作')
    await fs.mkdir(path.join(directory, '前端'))
    await fs.writeFile(path.join(directory, '前端', '当前.md'), '[目标](../目标.md)')
    await fs.writeFile(path.join(directory, '目标.md'), '# 目标')
    await fs.writeFile(path.join(directory, '.trash', '隐藏.md'), '# 隐藏')

    assert.deepEqual(await workspace.openWorkspaceLink(directory, '前端/当前.md', '../目标.md#标题'), {
      kind: 'note',
      relativePath: '目标.md',
    })
    await assert.rejects(() => workspace.openWorkspaceLink(directory, '前端/当前.md', '../../外部.md'), {
      code: 'PATH_OUTSIDE_WORKSPACE',
    })
    await assert.rejects(() => workspace.openWorkspaceLink(directory, '前端/当前.md', '../.trash/隐藏.md'), {
      code: 'RESERVED_PATH',
    })
    await assert.rejects(() => workspace.openWorkspaceLink(directory, '前端/当前.md', 'file:///C:/绝对.md'), {
      code: 'INVALID_LINK',
    })
  })
})

test('opens a validated workspace attachment with the system handler', async () => {
  await withTemporaryDirectory(async (directory) => {
    await workspace.createWorkspace(directory, '工作')
    await fs.writeFile(path.join(directory, '当前.md'), '[附件](.assets/资料.pdf)')
    await fs.writeFile(path.join(directory, '.assets', '资料.pdf'), 'pdf')
    let openedPath = ''
    global.window = { ztools: { shellOpenPath(targetPath) { openedPath = targetPath; return true } } }
    try {
      assert.deepEqual(await workspace.openWorkspaceLink(directory, '当前.md', '.assets/资料.pdf'), { kind: 'attachment' })
      assert.equal(openedPath, path.join(directory, '.assets', '资料.pdf'))
    } finally {
      delete global.window
    }
  })
})

test('opens the containing workspace folder for an entry', async () => {
  await withTemporaryDirectory(async (directory) => {
    await workspace.createWorkspace(directory, '工作')
    await workspace.createDirectory(directory, '', '目录')
    await workspace.createNote(directory, '目录', '笔记')
    let openedPath = ''
    global.window = { ztools: { shellOpenPath(targetPath) { openedPath = targetPath; return true } } }
    try {
      await workspace.showEntryInFolder(directory, '目录/笔记.md')
      assert.equal(openedPath, path.join(directory, '目录'))
      await assert.rejects(() => workspace.showEntryInFolder(directory, '../外部.md'), { code: 'PATH_OUTSIDE_WORKSPACE' })
    } finally {
      delete global.window
    }
  })
})

test('creates a note-relative Markdown link between workspace notes', async () => {
  await withTemporaryDirectory(async (directory) => {
    await workspace.createWorkspace(directory, '工作')
    await fs.mkdir(path.join(directory, '前端'))
    await fs.mkdir(path.join(directory, '后端'))
    await fs.writeFile(path.join(directory, '前端', 'Vue.md'), '# Vue')
    await fs.writeFile(path.join(directory, '后端', 'Node.md'), '# Node')
    assert.equal(await workspace.createNoteLink(directory, '前端/Vue.md', '后端/Node.md'), '../后端/Node.md')
    await assert.rejects(() => workspace.createNoteLink(directory, '前端/Vue.md', '../外部.md'), {
      code: 'PATH_OUTSIDE_WORKSPACE',
    })
  })
})

test('creates and resolves stable cross-workspace note links', async () => {
  await withTemporaryDirectory(async (parent) => {
    const firstRoot = path.join(parent, 'first')
    const secondRoot = path.join(parent, 'second')
    await workspace.createWorkspace(firstRoot, '一号')
    const second = await workspace.createWorkspace(secondRoot, '二号')
    await fs.mkdir(path.join(secondRoot, '目录'))
    await fs.writeFile(path.join(secondRoot, '目录', '目标 笔记.md'), '# 目标')
    const href = await workspace.createCrossWorkspaceNoteLink(secondRoot, second.id, '目录/目标 笔记.md')
    assert.equal(href, `znotes://${second.id}/%E7%9B%AE%E5%BD%95/%E7%9B%AE%E6%A0%87%20%E7%AC%94%E8%AE%B0.md`)
    assert.deepEqual(await workspace.openCrossWorkspaceNoteLink(secondRoot, href), {
      workspace: second,
      relativePath: '目录/目标 笔记.md',
    })
    await assert.rejects(() => workspace.openCrossWorkspaceNoteLink(firstRoot, href), { code: 'WORKSPACE_ID_MISMATCH' })
  })
})

test('prevents writes through a linked directory that leaves the workspace', async (context) => {
  await withTemporaryDirectory(async (directory) => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'znotes-outside-'))
    try {
      await workspace.createWorkspace(directory, '工作')
      try {
        await fs.symlink(outside, path.join(directory, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
      } catch (error) {
        if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
          context.skip('当前环境不允许创建目录链接')
          return
        }
        throw error
      }
      await assert.rejects(() => workspace.saveNote(directory, 'linked/outside.md', 'blocked', null), {
        code: 'PATH_OUTSIDE_WORKSPACE',
      })
    } finally {
      await fs.rm(outside, { recursive: true, force: true })
    }
  })
})

test('saves atomically and rejects stale writes', async () => {
  await withTemporaryDirectory(async (directory) => {
    await workspace.createWorkspace(directory, '工作')
    const firstSave = await workspace.saveNote(directory, 'Vue.md', '# Vue', null)
    const opened = await workspace.readNote(directory, 'Vue.md')
    assert.equal(opened.content, '# Vue')
    await fs.writeFile(path.join(directory, 'Vue.md'), '# external change')
    await assert.rejects(
      () => workspace.saveNote(directory, 'Vue.md', '# local change', firstSave.modifiedAt),
      { code: 'NOTE_CONFLICT' },
    )
    assert.equal(await fs.readFile(path.join(directory, 'Vue.md'), 'utf8'), '# external change')
    assert.deepEqual((await fs.readdir(directory)).filter((name) => name.endsWith('.tmp')), [])
  })
})

test('refuses to save into a directory without a valid workspace identity', async () => {
  await withTemporaryDirectory(async (directory) => {
    const notePath = path.join(directory, 'keep.md')
    await fs.writeFile(notePath, 'keep')

    await assert.rejects(() => workspace.saveNote(directory, 'keep.md', 'overwritten', null), {
      code: 'NOT_A_WORKSPACE',
    })
    assert.equal(await fs.readFile(notePath, 'utf8'), 'keep')
    assert.deepEqual((await fs.readdir(directory)).filter((name) => name.endsWith('.tmp')), [])

    await fs.writeFile(path.join(directory, '.znotes-workspace.json'), '{broken')
    await assert.rejects(() => workspace.saveNote(directory, 'keep.md', 'overwritten', null), {
      code: 'INVALID_IDENTITY',
    })
    assert.equal(await fs.readFile(notePath, 'utf8'), 'keep')
  })
})

test('creates notes and directories without overwriting existing entries', async () => {
  await withTemporaryDirectory(async (directory) => {
    await workspace.createWorkspace(directory, '工作')
    const folder = await workspace.createDirectory(directory, '', '前端')
    const note = await workspace.createNote(directory, folder, 'Vue')
    assert.equal(folder, '前端')
    assert.equal(note, '前端/Vue.md')
    assert.equal(await fs.readFile(path.join(directory, '前端', 'Vue.md'), 'utf8'), '')
    await assert.rejects(() => workspace.createNote(directory, folder, 'Vue'), { code: 'ENTRY_EXISTS' })
  })
})

test('rejects invalid, reserved, and escaping entry names', async () => {
  await withTemporaryDirectory(async (directory) => {
    await workspace.createWorkspace(directory, '工作')
    await assert.rejects(() => workspace.createNote(directory, '', '../outside'), { code: 'INVALID_ENTRY_NAME' })
    await assert.rejects(() => workspace.createDirectory(directory, '', '.trash'), { code: 'INVALID_ENTRY_NAME' })
    await assert.rejects(() => workspace.createNote(directory, '', 'CON'), { code: 'INVALID_ENTRY_NAME' })
  })
})

test('renames notes and directories without overwriting existing entries', async () => {
  await withTemporaryDirectory(async (directory) => {
    await workspace.createWorkspace(directory, '工作')
    await workspace.createNote(directory, '', '旧名称')
    await workspace.createNote(directory, '', '已存在')
    assert.equal(await workspace.renameEntry(directory, '旧名称.md', '新名称'), '新名称.md')
    assert.equal(await fs.readFile(path.join(directory, '新名称.md'), 'utf8'), '')
    await assert.rejects(() => workspace.renameEntry(directory, '新名称.md', '已存在'), { code: 'ENTRY_EXISTS' })
    await assert.rejects(() => workspace.renameEntry(directory, '新名称.md', '../外部'), { code: 'INVALID_ENTRY_NAME' })
  })
})

test('moves notes into directories and preserves their relative link targets', async () => {
  await withTemporaryDirectory(async (directory) => {
    await workspace.createWorkspace(directory, '移动测试')
    await workspace.createDirectory(directory, '', '目标')
    await workspace.createNote(directory, '', '笔记')
    await fs.writeFile(path.join(directory, '资料.txt'), 'data')
    await fs.writeFile(path.join(directory, '笔记.md'), '[资料](资料.txt)')

    assert.equal(await workspace.moveEntry(directory, '笔记.md', '目标'), '目标/笔记.md')
    assert.equal(await fs.readFile(path.join(directory, '目标', '笔记.md'), 'utf8'), '[资料](../%E8%B5%84%E6%96%99.txt)')
    await assert.rejects(() => workspace.moveEntry(directory, '目标', '目标'), { code: 'INVALID_MOVE_TARGET' })
  })
})

test('moves notes and complete directories to the workspace trash with metadata', async () => {
  await withTemporaryDirectory(async (directory) => {
    await workspace.createWorkspace(directory, '工作')
    await workspace.createDirectory(directory, '', '前端')
    await workspace.createNote(directory, '前端', 'Vue')
    const deleted = await workspace.moveEntryToTrash(directory, '前端')
    assert.equal(deleted.originalPath, '前端')
    assert.equal(deleted.kind, 'directory')
    await assert.rejects(() => fs.access(path.join(directory, '前端')))
    assert.equal(await fs.readFile(path.join(directory, '.trash', deleted.id, 'entry', 'Vue.md'), 'utf8'), '')
    const metadata = JSON.parse(await fs.readFile(path.join(directory, '.trash', deleted.id, 'metadata.json'), 'utf8'))
    assert.equal(metadata.originalPath, '前端')
  })
})

test('lists and restores trash items without overwriting existing entries', async () => {
  await withTemporaryDirectory(async (directory) => {
    await workspace.createWorkspace(directory, '工作')
    await workspace.createNote(directory, '', '待恢复')
    const deleted = await workspace.moveEntryToTrash(directory, '待恢复.md')
    assert.deepEqual(await workspace.listTrash(directory), [deleted])

    await workspace.createNote(directory, '', '待恢复')
    await assert.rejects(() => workspace.restoreTrashItem(directory, deleted.id), { code: 'ENTRY_EXISTS' })
    assert.equal(await workspace.restoreTrashItem(directory, deleted.id, '恢复副本.md'), '恢复副本.md')
    assert.equal(await fs.readFile(path.join(directory, '恢复副本.md'), 'utf8'), '')
    assert.deepEqual(await workspace.listTrash(directory), [])
  })
})

test('permanently deletes individual trash items and empties the trash', async () => {
  await withTemporaryDirectory(async (directory) => {
    await workspace.createWorkspace(directory, '工作')
    await workspace.createNote(directory, '', '一')
    await workspace.createNote(directory, '', '二')
    const first = await workspace.moveEntryToTrash(directory, '一.md')
    await workspace.moveEntryToTrash(directory, '二.md')
    await workspace.permanentlyDeleteTrashItem(directory, first.id)
    assert.equal((await workspace.listTrash(directory)).length, 1)
    await workspace.emptyTrash(directory)
    assert.deepEqual(await workspace.listTrash(directory), [])
    await assert.rejects(() => workspace.permanentlyDeleteTrashItem(directory, '../outside'), { code: 'INVALID_TRASH_ID' })
  })
})

test('imports attachments into dated workspace assets and returns a note-relative path', async () => {
  await withTemporaryDirectory(async (directory) => {
    await workspace.createWorkspace(directory, '工作')
    await workspace.createDirectory(directory, '', '前端')
    await workspace.createNote(directory, '前端', 'Vue')

    const relativePath = await workspace.importAttachment(
      directory,
      '前端/Vue.md',
      '截图.PNG',
      new Uint8Array([1, 2, 3]),
    )

    assert.match(relativePath, /^\.\.\/\.assets\/\d{4}\/\d{2}\/\d+-[a-f0-9]{8}-[a-f0-9]{16}\.png$/)
    assert.deepEqual(await fs.readFile(path.resolve(directory, '前端', relativePath)), Buffer.from([1, 2, 3]))

    const duplicatePath = await workspace.importAttachment(
      directory,
      '前端/Vue.md',
      '另一个名称.png',
      new Uint8Array([1, 2, 3]),
    )
    assert.equal(duplicatePath, relativePath)
  })
})

test('rejects invalid attachment note paths and contents', async () => {
  await withTemporaryDirectory(async (directory) => {
    await workspace.createWorkspace(directory, '工作')
    await workspace.createNote(directory, '', '安全')
    await assert.rejects(
      () => workspace.importAttachment(directory, '../outside.md', 'file.txt', new Uint8Array([1])),
      { code: 'PATH_OUTSIDE_WORKSPACE' },
    )
    await assert.rejects(
      () => workspace.importAttachment(directory, '安全.md', 'file.txt', 'invalid'),
      { code: 'INVALID_ATTACHMENT' },
    )
  })
})

test('scans attachments across active and trashed notes and rechecks references before cleanup', async () => {
  await withTemporaryDirectory(async (directory) => {
    await workspace.createWorkspace(directory, '工作')
    await workspace.saveNote(directory, 'active.md', '', null)
    await workspace.saveNote(directory, 'trashed.md', '', null)
    const activeAsset = await workspace.importAttachment(directory, 'active.md', 'active.txt', new Uint8Array([1]))
    const trashAsset = await workspace.importAttachment(directory, 'trashed.md', 'trash.txt', new Uint8Array([2]))
    const unusedAsset = await workspace.importAttachment(directory, 'active.md', 'unused.txt', new Uint8Array([3]))
    const active = await workspace.readNote(directory, 'active.md')
    const trashed = await workspace.readNote(directory, 'trashed.md')
    await workspace.saveNote(directory, 'active.md', `[active](${activeAsset})`, active.modifiedAt)
    await workspace.saveNote(directory, 'trashed.md', `[trash](${trashAsset})`, trashed.modifiedAt)
    await workspace.moveEntryToTrash(directory, 'trashed.md')

    const unused = await workspace.scanUnusedAttachments(directory)
    assert.deepEqual(unused.map((item) => item.relativePath), [unusedAsset])

    const reopened = await workspace.readNote(directory, 'active.md')
    await workspace.saveNote(directory, 'active.md', `${reopened.content}\n[keep](${unusedAsset})`, reopened.modifiedAt)
    await assert.rejects(() => workspace.deleteUnusedAttachments(directory, [unusedAsset]), { code: 'ATTACHMENT_SCAN_STALE' })

    const latest = await workspace.readNote(directory, 'active.md')
    await workspace.saveNote(directory, 'active.md', `[active](${activeAsset})`, latest.modifiedAt)
    assert.equal(await workspace.deleteUnusedAttachments(directory, [unusedAsset]), 1)
    await assert.rejects(() => fs.access(path.join(directory, ...unusedAsset.split('/'))), { code: 'ENOENT' })
  })
})

test('lists and deletes only trash items that still exceed the retention period', async () => {
  await withTemporaryDirectory(async (directory) => {
    await workspace.createWorkspace(directory, '工作')
    await workspace.saveNote(directory, 'old.md', 'old', null)
    await workspace.saveNote(directory, 'recent.md', 'recent', null)
    const oldItem = await workspace.moveEntryToTrash(directory, 'old.md')
    const recentItem = await workspace.moveEntryToTrash(directory, 'recent.md')
    const oldMetadataPath = path.join(directory, '.trash', oldItem.id, 'metadata.json')
    await fs.writeFile(oldMetadataPath, JSON.stringify({ ...oldItem, deletedAt: '2020-01-01T00:00:00.000Z' }))

    assert.deepEqual((await workspace.listExpiredTrash(directory, 30)).map((item) => item.id), [oldItem.id])
    await assert.rejects(
      () => workspace.deleteExpiredTrashItems(directory, [recentItem.id], 30),
      { code: 'TRASH_EXPIRATION_STALE' },
    )
    assert.equal(await workspace.deleteExpiredTrashItems(directory, [oldItem.id], 30), 1)
    assert.deepEqual((await workspace.listTrash(directory)).map((item) => item.id), [recentItem.id])
    await assert.rejects(() => workspace.listExpiredTrash(directory, 0), { code: 'INVALID_TRASH_RETENTION' })
  })
})
