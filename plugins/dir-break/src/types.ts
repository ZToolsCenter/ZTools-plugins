export interface FileInfo {
  name: string
  path: string
  relativePath: string
  size: number
}

export interface FileTypeCount {
  ext: string
  count: number
  size: number
}

export interface ScanResult {
  files: FileInfo[]
  dirs: FileInfo[]
  totalFiles: number
  totalDirs: number
  totalSize: number
  fileTypes: FileTypeCount[]
}

export interface MoveOperation {
  from: string
  to: string
  originalDir: string
  name: string
  relativeInTarget: string
  isDir: boolean
}

export interface BreakRecord {
  id: string
  timestamp: number
  targetDir: string
  parentDir: string
  targetName: string
  recursive: boolean
  conflictStrategy: string
  movedFiles: MoveOperation[]
  deletedDirs: string[]
  summary: {
    totalMoved: number
    totalDirsMoved: number
    totalDeleted: number
  }
}

export type ConflictStrategy = 'rename' | 'overwrite' | 'skip'

export interface BreakOptions {
  recursive: boolean
  conflictStrategy: ConflictStrategy
}
