'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { calculateSha256, createManagedScriptPath, normalizeManagedFolderPath, normalizeManagedScriptPath } = require('./file-repositories')
const { RepositoryError } = require('./metadata-repository')
const { invoke } = require('./task-service')

const EXTENSION_LANGUAGES = Object.freeze({
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.ps1': 'powershell',
  '.sh': 'shell'
})

/** Builds the API for managing scripts and directories inside Scripty's data root. */
function createScriptsApi(metadataRepository, managedScriptRepository, now = () => Date.now()) {

  /** Normalizes a user-visible path and rejects metadata or filesystem collisions. */
  function normalizeAvailablePath(relativePath, language, scripts, excludedId = null) {
    const normalized = normalizeManagedScriptPath(relativePath, language)
    if (managedScriptRepository.hasPathConflict(normalized, scripts, excludedId)) {
      throw new RepositoryError('NAME_CONFLICT', '脚本路径已存在或与现有目录冲突')
    }
    const current = scripts.find(script => script.id === excludedId)
    if ((!current || current.relativePath !== normalized) && managedScriptRepository.exists(normalized, language)) {
      throw new RepositoryError('NAME_CONFLICT', '脚本路径已有未托管文件')
    }
    return normalized
  }

  /** Reads source from the visible path and refreshes metadata after legitimate external edits. */
  function readCurrentScript(script) {
    const content = managedScriptRepository.read(script, script.language)
    const contentHash = calculateSha256(content)
    const synchronized = contentHash === script.contentHash
      ? script
      : { ...script, contentHash, updatedAt: new Date(now()).toISOString() }
    if (synchronized !== script) {
      metadataRepository.write('scripts', metadataRepository.read('scripts').map(item => item.id === script.id ? synchronized : item))
    }
    return { ...synchronized, content }
  }

  /** Returns every explicit folder plus script ancestors so tree rendering remains deterministic. */
  function listFolders() {
    const explicit = metadataRepository.read('scriptFolders')
    const folders = new Map(explicit.map(folder => [folder.relativePath, folder]))
    const timestamp = new Date(now()).toISOString()
    const sourcePaths = [
      ...explicit.map(folder => `${folder.relativePath}/placeholder`),
      ...metadataRepository.read('scripts').map(script => script.relativePath)
    ]
    let changed = false
    for (const sourcePath of sourcePaths) {
      const segments = sourcePath.split('/').slice(0, -1)
      for (let index = 1; index <= segments.length; index += 1) {
        const relativePath = segments.slice(0, index).join('/')
        if (!folders.has(relativePath)) {
          folders.set(relativePath, { id: randomUUID(), relativePath, createdAt: timestamp, updatedAt: timestamp })
          changed = true
        }
      }
    }
    const result = [...folders.values()].sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'zh-CN'))
    if (changed) metadataRepository.write('scriptFolders', result)
    return result
  }

  /** Rejects folder paths that overlap scripts or another folder under platform case rules. */
  function normalizeAvailableFolderPath(relativePath, folders, excludedId = null) {
    const normalized = normalizeManagedFolderPath(relativePath)
    const key = process.platform === 'win32' ? normalized.toLocaleLowerCase() : normalized
    const conflictingFolder = folders.some(folder => {
      if (folder.id === excludedId) return false
      const candidate = process.platform === 'win32' ? folder.relativePath.toLocaleLowerCase() : folder.relativePath
      return candidate === key
    })
    if (conflictingFolder || managedScriptRepository.hasPathConflict(normalized, metadataRepository.read('scripts'))) {
      throw new RepositoryError('NAME_CONFLICT', '目录路径与现有托管路径冲突')
    }
    return normalized
  }

  /** Rejects destructive script or folder operations while any affected script remains referenced by a task. */
  function assertScriptsUnreferenced(scriptIds) {
    const referenced = metadataRepository.read('tasks').find(task => scriptIds.has(task.scriptId))
    if (referenced) throw new RepositoryError('REFERENCE_CONFLICT', `任务“${referenced.name}”仍在使用该脚本`)
  }

  return {
    /** Returns script metadata summaries, optionally filtered by normalized search text and language. */
    list(query = {}) {
      return invoke(() => {
        const search = typeof query.search === 'string' ? query.search.trim().toLocaleLowerCase() : ''
        return metadataRepository.read('scripts')
          .filter(script => !query.language || script.language === query.language)
          .filter(script => !search || `${script.name} ${script.note} ${script.relativePath}`.toLocaleLowerCase().includes(search))
          .map(({ contentHash, ...summary }) => summary)
      })
    },

    /** Returns one managed script together with its current UTF-8 source text. */
    get(id) {
      return invoke(() => {
        const script = metadataRepository.read('scripts').find(item => item.id === id)
        if (!script) throw new RepositoryError('NOT_FOUND', '脚本不存在')
        return readCurrentScript(script)
      })
    },

    /** Creates a new managed source file and rolls it back if metadata persistence fails. */
    create(input) {
      return invoke(() => {
        const name = typeof input?.name === 'string' ? input.name.trim() : ''
        const language = input?.language
        const content = typeof input?.content === 'string' ? input.content : null
        if (!name || name.length > 100 || !Object.values(EXTENSION_LANGUAGES).includes(language) || content === null) {
          throw new RepositoryError('VALIDATION_ERROR', '脚本名称、语言或源码无效')
        }
        const scripts = metadataRepository.read('scripts')
        const id = randomUUID()
        const relativePath = normalizeAvailablePath(input?.relativePath ?? createManagedScriptPath(name, language, id), language, scripts)
        const stored = managedScriptRepository.create(relativePath, language, content)
        const timestamp = new Date(now()).toISOString()
        const script = { id, name, relativePath: stored.relativePath, language, contentHash: stored.contentHash, note: typeof input.note === 'string' ? input.note.trim().slice(0, 500) : '', createdAt: timestamp, updatedAt: timestamp }
        try {
          metadataRepository.write('scripts', [...scripts, script])
        } catch (error) {
          managedScriptRepository.remove(relativePath, language)
          throw error
        }
        return { ...script, content }
      })
    },

    /** Atomically updates source and metadata, restoring the previous source if metadata persistence fails. */
    update(id, input) {
      return invoke(() => {
        const scripts = metadataRepository.read('scripts')
        const index = scripts.findIndex(script => script.id === id)
        if (index < 0) throw new RepositoryError('NOT_FOUND', '脚本不存在')
        const previous = scripts[index]
        const name = typeof input?.name === 'string' ? input.name.trim() : ''
        const language = input?.language
        const content = typeof input?.content === 'string' ? input.content : null
        if (!name || name.length > 100 || language !== previous.language || content === null) {
          throw new RepositoryError('VALIDATION_ERROR', '脚本名称、语言或源码无效；已有脚本不能更改语言')
        }
        const previousContent = managedScriptRepository.read(previous, previous.language)
        const relativePath = normalizeAvailablePath(input?.relativePath ?? previous.relativePath, language, scripts, id)
        const pathChanged = relativePath !== previous.relativePath
        const stored = pathChanged
          ? managedScriptRepository.create(relativePath, language, content)
          : managedScriptRepository.write(relativePath, language, content)
        const updated = { ...previous, name, relativePath, note: typeof input.note === 'string' ? input.note.trim().slice(0, 500) : '', contentHash: stored.contentHash, updatedAt: new Date(now()).toISOString() }
        const nextScripts = scripts.slice()
        nextScripts[index] = updated
        try {
          metadataRepository.write('scripts', nextScripts)
          if (pathChanged) managedScriptRepository.remove(previous, previous.language)
        } catch (error) {
          if (pathChanged) managedScriptRepository.remove(relativePath, language)
          else managedScriptRepository.write(previous.relativePath, previous.language, previousContent)
          throw error
        }
        return { ...updated, content }
      })
    },

    /** Returns explicit and derived folders without exposing the absolute scripts root. */
    listFolders() {
      return invoke(() => listFolders())
    },

    /** Creates one empty managed folder and persists it so it survives without child scripts. */
    createFolder(input) {
      return invoke(() => {
        const folders = metadataRepository.read('scriptFolders')
        const relativePath = normalizeAvailableFolderPath(input?.relativePath, folders)
        managedScriptRepository.createFolder(relativePath)
        const timestamp = new Date(now()).toISOString()
        const folder = { id: randomUUID(), relativePath, createdAt: timestamp, updatedAt: timestamp }
        try {
          metadataRepository.write('scriptFolders', [...folders, folder])
        } catch (error) {
          managedScriptRepository.removeFolder(relativePath)
          throw error
        }
        return folder
      })
    },

    /** Moves one folder and updates every descendant path, reversing the rename if metadata persistence fails. */
    moveFolder(id, input) {
      return invoke(() => {
        const folders = metadataRepository.read('scriptFolders')
        const folder = folders.find(item => item.id === id)
        if (!folder) throw new RepositoryError('NOT_FOUND', '目录不存在')
        const targetPath = normalizeAvailableFolderPath(input?.relativePath, folders, id)
        const sourcePath = folder.relativePath
        if (targetPath === sourcePath) return folder
        managedScriptRepository.movePath(sourcePath, targetPath, 'folder')
        const timestamp = new Date(now()).toISOString()
        const rewrite = relativePath => relativePath === sourcePath || relativePath.startsWith(`${sourcePath}/`)
          ? `${targetPath}${relativePath.slice(sourcePath.length)}`
          : relativePath
        const nextFolders = folders.map(item => ({ ...item, relativePath: rewrite(item.relativePath), updatedAt: rewrite(item.relativePath) === item.relativePath ? item.updatedAt : timestamp }))
        const scripts = metadataRepository.read('scripts')
        const nextScripts = scripts.map(script => ({ ...script, relativePath: rewrite(script.relativePath), updatedAt: rewrite(script.relativePath) === script.relativePath ? script.updatedAt : timestamp }))
        try {
          metadataRepository.write('scriptFolders', nextFolders)
          metadataRepository.write('scripts', nextScripts)
        } catch (error) {
          try { managedScriptRepository.movePath(targetPath, sourcePath, 'folder') } catch {}
          try { metadataRepository.write('scriptFolders', folders); metadataRepository.write('scripts', scripts) } catch {}
          throw error
        }
        return nextFolders.find(item => item.id === id)
      })
    },

    /** Recursively removes one folder only when none of its scripts is referenced by a task. */
    removeFolder(id) {
      return invoke(() => {
        const folders = metadataRepository.read('scriptFolders')
        const folder = folders.find(item => item.id === id)
        if (!folder) throw new RepositoryError('NOT_FOUND', '目录不存在')
        const scripts = metadataRepository.read('scripts')
        const affected = scripts.filter(script => script.relativePath.startsWith(`${folder.relativePath}/`))
        assertScriptsUnreferenced(new Set(affected.map(script => script.id)))
        const trashPath = `.transactions-delete-${randomUUID()}`
        const sourcePath = folder.relativePath
        managedScriptRepository.movePath(sourcePath, trashPath, 'folder')
        const nextFolders = folders.filter(item => item.relativePath !== sourcePath && !item.relativePath.startsWith(`${sourcePath}/`))
        const nextScripts = scripts.filter(script => !affected.some(item => item.id === script.id))
        try {
          metadataRepository.write('scripts', nextScripts)
          metadataRepository.write('scriptFolders', nextFolders)
          fs.rmSync(path.join(managedScriptRepository.scriptsDirectory, trashPath), { recursive: true, force: true })
        } catch (error) {
          try { managedScriptRepository.movePath(trashPath, sourcePath, 'folder') } catch {}
          try { metadataRepository.write('scripts', scripts); metadataRepository.write('scriptFolders', folders) } catch {}
          throw error
        }
      })
    },

    /** Moves one script without changing its stable ID, language, or source bytes. */
    move(id, input) {
      return invoke(() => {
        const scripts = metadataRepository.read('scripts')
        const index = scripts.findIndex(script => script.id === id)
        if (index < 0) throw new RepositoryError('NOT_FOUND', '脚本不存在')
        const previous = scripts[index]
        const relativePath = normalizeAvailablePath(input?.relativePath, previous.language, scripts, id)
        if (relativePath === previous.relativePath) return previous
        managedScriptRepository.movePath(previous.relativePath, relativePath, 'script', previous.language)
        const updated = { ...previous, relativePath, updatedAt: new Date(now()).toISOString() }
        const next = scripts.slice(); next[index] = updated
        try { metadataRepository.write('scripts', next) } catch (error) {
          try { managedScriptRepository.movePath(relativePath, previous.relativePath, 'script', previous.language) } catch {}
          throw error
        }
        return updated
      })
    },

    /**
     * Copies one managed script to a new relative path, preserving the source's
     * language, note, and content hash. The copy gets a fresh id, a " 副本" name,
     * and is rolled back (file removed) if metadata persistence fails.
     */
    copy(id, input) {
      return invoke(() => {
        const scripts = metadataRepository.read('scripts')
        const source = scripts.find(script => script.id === id)
        if (!source) throw new RepositoryError('NOT_FOUND', '脚本不存在')
        const relativePath = normalizeAvailablePath(input?.relativePath, source.language, scripts)
        const stored = managedScriptRepository.copyScriptFile(source.relativePath, relativePath, source.language)
        const timestamp = new Date(now()).toISOString()
        const duplicate = {
          id: randomUUID(),
          name: `${source.name} 副本`.slice(0, 100),
          relativePath: stored.relativePath,
          language: source.language,
          contentHash: stored.contentHash,
          note: source.note,
          createdAt: timestamp,
          updatedAt: timestamp
        }
        try {
          metadataRepository.write('scripts', [...scripts, duplicate])
        } catch (error) {
          try { managedScriptRepository.remove(stored.relativePath, source.language) } catch {}
          throw error
        }
        return duplicate
      })
    },

    /**
     * Recursively copies a folder subtree to a new relative path. Every script
     * and child folder under the source is cloned with fresh ids and rewritten
     * paths; partial copies are removed if metadata persistence fails.
     */
    copyFolder(id, input) {
      return invoke(() => {
        const folders = metadataRepository.read('scriptFolders')
        const folder = folders.find(item => item.id === id)
        if (!folder) throw new RepositoryError('NOT_FOUND', '目录不存在')
        const sourcePath = folder.relativePath
        const targetPath = normalizeAvailableFolderPath(input?.relativePath, folders)
        const stored = managedScriptRepository.copyFolderTree(sourcePath, targetPath)
        const timestamp = new Date(now()).toISOString()
        const rewrite = relativePath => `${targetPath}${relativePath.slice(sourcePath.length)}`
        const childFolders = folders
          .filter(item => item.relativePath === sourcePath || item.relativePath.startsWith(`${sourcePath}/`))
          .map(item => ({ id: randomUUID(), relativePath: rewrite(item.relativePath), createdAt: timestamp, updatedAt: timestamp }))
        const scripts = metadataRepository.read('scripts')
        const childScripts = scripts
          .filter(script => script.relativePath === sourcePath || script.relativePath.startsWith(`${sourcePath}/`))
          .map(script => ({
            id: randomUUID(),
            name: script.name,
            relativePath: rewrite(script.relativePath),
            language: script.language,
            contentHash: script.contentHash,
            note: script.note,
            createdAt: timestamp,
            updatedAt: timestamp
          }))
        try {
          metadataRepository.write('scriptFolders', [...folders, ...childFolders])
          metadataRepository.write('scripts', [...scripts, ...childScripts])
        } catch (error) {
          try { fs.rmSync(path.join(managedScriptRepository.scriptsDirectory, stored.relativePath), { recursive: true, force: true }) } catch {}
          throw error
        }
        return childFolders.find(item => item.relativePath === stored.relativePath)
      })
    },

    /** Deletes one unreferenced script and its metadata after preserving its source for rollback. */
    remove(id) {
      return invoke(() => {
        const scripts = metadataRepository.read('scripts')
        const script = scripts.find(item => item.id === id)
        if (!script) throw new RepositoryError('NOT_FOUND', '脚本不存在')
        assertScriptsUnreferenced(new Set([id]))
        const content = managedScriptRepository.read(script, script.language)
        managedScriptRepository.remove(script, script.language)
        try { metadataRepository.write('scripts', scripts.filter(item => item.id !== id)) } catch (error) {
          managedScriptRepository.write(script.relativePath, script.language, content)
          throw error
        }
      })
    }
  }
}

module.exports = {
  EXTENSION_LANGUAGES,
  createScriptsApi
}
