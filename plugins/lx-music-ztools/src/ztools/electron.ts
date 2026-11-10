import './contracts'
export const openDirInExplorer = (path: string) => window.lxHost.send('host:openDirectory', path)
export const openUrl = (url: string) => window.lxHost.invoke('host:openUrl', url)
export const clipboardWriteText = (text: string) => window.lxHost.send('host:clipboardWrite', text)
export const clipboardReadText = (): string => window.services.clipboardReadText()
export const encodePath = (path: string) => path.replaceAll('%', '%25').replaceAll('#', '%23')
