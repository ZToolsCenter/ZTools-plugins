import './contracts'
export const parseFile = (...args: any[]) => window.lxHost.invoke('metadata:parseFile', args)
