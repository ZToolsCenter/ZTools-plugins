import crypto from 'crypto-browserify'
import { Buffer } from 'buffer'
import './contracts'
const invoke = (method: string, args: unknown[]) => window.lxHost.invoke<any>('files:call', { method, args })
export { joinPath, extname, basename, dirname } from './paths'
export const toMD5 = (text: string) => crypto.createHash('md5').update(text).digest('hex')
export const b64DecodeUnicode = (text: string) => Buffer.from(text, 'base64').toString('utf8')
export const checkPath = (...args: any[]) => invoke('checkPath', args)
export const checkAndCreateDir = (...args: any[]) => invoke('checkAndCreateDir', args)
export const getFileStats = async (...args: any[]) => {
  const stats = await invoke('getFileStats', args)
  return stats && { ...stats, isFile: () => stats.isFile, isDirectory: () => stats.isDirectory }
}
export const createDir = (...args: any[]) => invoke('createDir', args)
export const removeFile = (...args: any[]) => invoke('removeFile', args)
export const readFile = async (...args: any[]) => Buffer.from(await invoke('readFile', args))
export const gzipData = async (...args: any[]) => Buffer.from(await invoke('gzipData', args))
export const gunzipData = (...args: any[]) => invoke('gunzipData', args)
export const saveLxConfigFile = (...args: any[]) => invoke('saveLxConfigFile', args)
export const readLxConfigFile = (...args: any[]) => invoke('readLxConfigFile', args)
export const saveStrToFile = (...args: any[]) => invoke('saveStrToFile', args)
export const copyFile = (...args: any[]) => invoke('copyFile', args)
export const moveFile = (...args: any[]) => invoke('moveFile', args)
export const getAddress = () => window.lxHost.readSnapshot<string[]>('host:addresses')
