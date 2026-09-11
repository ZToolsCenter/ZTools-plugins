/**
 * 本机文件桥公开 API（PR2）。
 * PR8 工作区 / 文件 tools 请从本模块导入，勿直接散落 window.gooseFs。
 */

export type { DirEntry, ReadStatResult } from "./types";
export {
  isFsAvailable,
  pickDirectory,
  listDir,
  exists,
  readFile,
  readFileBase64,
  readFileStat,
  writeFile,
  mkdir,
  removeFile,
  removeDir,
  rename,
  realpath,
  getHomedir,
  openInFileManager,
} from "./api";
export { readGitBranch } from "./gitBranch";
export { installWebGooseFs } from "./web-mock";
