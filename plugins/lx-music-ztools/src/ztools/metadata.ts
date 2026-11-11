import './contracts'
export const parseFile = (...args: any[]) => window.lxHost.invoke('metadata:parseFile', args)
export const selectCover = (pictures?: { type?: string }[]) => pictures?.find(picture => picture.type?.toLowerCase() === 'cover (front)') || pictures?.[0] || null
