import { getStorageItem, setStorageItem, STORAGE_KEYS } from '@/utils/storage'

export interface BaiduTranslateCredentials {
  appid: string
  key: string
}

export interface CozeCredentials {
  token: string
  botId: string
}

const trim = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const asBaidu = (value: unknown): BaiduTranslateCredentials => {
  const raw = (value ?? {}) as Partial<Record<keyof BaiduTranslateCredentials, unknown>>
  return { appid: trim(raw.appid), key: trim(raw.key) }
}

const asCoze = (value: unknown): CozeCredentials => {
  const raw = (value ?? {}) as Partial<Record<keyof CozeCredentials, unknown>>
  return { token: trim(raw.token), botId: trim(raw.botId) }
}

export const getBaiduTranslateCredentials = async (): Promise<BaiduTranslateCredentials> => {
  return asBaidu(await getStorageItem<unknown>(STORAGE_KEYS.BAIDU_TRANSLATE, null))
}

export const saveBaiduTranslateCredentials = async (credentials: BaiduTranslateCredentials) => {
  await setStorageItem(STORAGE_KEYS.BAIDU_TRANSLATE, asBaidu(credentials))
}

export const getCozeCredentials = async (): Promise<CozeCredentials> => {
  return asCoze(await getStorageItem<unknown>(STORAGE_KEYS.COZE_AI, null))
}

export const saveCozeCredentials = async (credentials: CozeCredentials) => {
  await setStorageItem(STORAGE_KEYS.COZE_AI, asCoze(credentials))
}

export const hasBaiduTranslateCredentials = (credentials: BaiduTranslateCredentials) =>
  Boolean(credentials.appid && credentials.key)

export const hasCozeCredentials = (credentials: CozeCredentials) =>
  Boolean(credentials.token && credentials.botId)
