import type { RequestState } from '../store/request'
import { resolveVariables } from './variableResolver'

export interface SocketController {
  send: (data: string) => void
  close: () => void
}

const activeSockets = new Map<string, SocketController>()

export function getSocketController(tabId: string): SocketController | undefined {
  return activeSockets.get(tabId)
}

function parseUrl(urlStr: string, variables: Record<string, string>, method: string) {
  const url = resolveVariables(urlStr, variables).trim()
  if (method === 'TCP' || method === 'UDP') {
    let host = 'localhost'
    let port = 80

    try {
      if (url.includes('://')) {
        const parsed = new URL(url)
        host = parsed.hostname || host
        port = parsed.port ? parseInt(parsed.port, 10) : port
        return { host, port, url }
      }
    } catch {
      // fallback to host:port parser below
    }

    if (url.startsWith('[')) {
      const end = url.indexOf(']')
      if (end > 0) {
        host = url.slice(1, end)
        const rawPort = url.slice(end + 1)
        if (rawPort.startsWith(':')) {
          const p = parseInt(rawPort.slice(1), 10)
          if (!Number.isNaN(p)) port = p
        }
        return { host, port, url }
      }
    }

    const lastColon = url.lastIndexOf(':')
    if (lastColon > 0) {
      host = url.slice(0, lastColon) || host
      const p = parseInt(url.slice(lastColon + 1), 10)
      if (!Number.isNaN(p)) port = p
    } else if (url) {
      host = url
    }

    return { host, port, url }
  }
  return { url }
}

export function connectSocket(
  tabId: string,
  req: RequestState,
  variables: Record<string, string>,
  onMessage: (type: 'system' | 'sent' | 'received', data: string) => void,
  onStatusChange: (status: 'disconnected' | 'connecting' | 'connected') => void,
  t?: (key: string, params?: Record<string, unknown>) => string
): SocketController {
  const { method } = req

  const tr = (key: string, params?: Record<string, unknown>, fallback?: string) => {
    const value = t ? t(key, params) : ''
    if (!value || value === key) {
      return fallback || key
    }
    return value
  }

  if (activeSockets.has(tabId)) {
    activeSockets.get(tabId)?.close()
  }

  onStatusChange('connecting')

  let controller: SocketController = {
    send: () => {},
    close: () => {}
  }

  try {
    if (method === 'WS') {
      let resolvedUrl = resolveVariables(req.url, variables)
      
      const enabledParams = req.params.filter((p) => p.enabled && p.key)
      if (enabledParams.length > 0) {
        const query = enabledParams
          .map((p) => `${encodeURIComponent(resolveVariables(p.key, variables))}=${encodeURIComponent(resolveVariables(p.value, variables))}`)
          .join('&')
        resolvedUrl += `${resolvedUrl.includes('?') ? '&' : '?'}${query}`
      }
      
      const ws = new WebSocket(resolvedUrl)
      
      ws.onopen = () => {
        onStatusChange('connected')
        onMessage('system', tr('socket.system.connectedWs', { url: resolvedUrl }, `Connected to ${resolvedUrl}`))
      }
      
      ws.onmessage = (event) => {
        onMessage('received', event.data)
      }
      
      ws.onerror = (err) => {
        onMessage('system', tr('socket.system.wsError', undefined, 'WebSocket Error'))
      }
      
      ws.onclose = () => {
        onStatusChange('disconnected')
        activeSockets.delete(tabId)
        onMessage('system', tr('socket.system.disconnected', undefined, 'Disconnected'))
      }
      
      controller = {
        send: (data: string) => {
          ws.send(data)
          onMessage('sent', data)
        },
        close: () => ws.close()
      }
    } else if (method === 'TCP') {
      const { host, port } = parseUrl(req.url, variables, method)
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        onMessage('system', tr('socket.system.invalidTcpAddress', undefined, 'Invalid TCP address. Use host:port, e.g. 127.0.0.1:9001'))
        onStatusChange('disconnected')
        return controller
      }
      // @ts-ignore
      if (!window.services?.createTcpClient) {
        onMessage('system', tr('socket.system.tcpNotSupported', undefined, 'TCP is not supported in browser environment'))
        onStatusChange('disconnected')
        return controller
      }
      
      // @ts-ignore
      const client = window.services.createTcpClient(
        host,
        port,
        (type: string, data: string) => {
          if (type === 'System') {
            onStatusChange('connected')
            onMessage('system', tr('socket.system.connectedTcp', { host, port }, `Connected to TCP ${host}:${port}`))
            return
          }
          onMessage('received', data)
        },
        (err: string) => {
          onMessage('system', tr('socket.system.error', { error: err }, `Error: ${err}`))
        },
        () => {
          onStatusChange('disconnected')
          activeSockets.delete(tabId)
          onMessage('system', tr('socket.system.disconnected', undefined, 'Disconnected'))
        }
      )
      
      controller = {
        send: (data: string) => {
          client.send(data)
          onMessage('sent', data)
        },
        close: () => client.close()
      }
    } else if (method === 'UDP') {
      const { host, port } = parseUrl(req.url, variables, method)
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        onMessage('system', tr('socket.system.invalidUdpAddress', undefined, 'Invalid UDP address. Use host:port, e.g. 127.0.0.1:9001'))
        onStatusChange('disconnected')
        return controller
      }
      // @ts-ignore
      if (!window.services?.createUdpClient) {
        onMessage('system', tr('socket.system.udpNotSupported', undefined, 'UDP is not supported in browser environment'))
        onStatusChange('disconnected')
        return controller
      }

      onStatusChange('connected')
      onMessage('system', tr('socket.system.udpReady', { host, port }, `UDP Ready: ${host}:${port}`))

      // @ts-ignore
      const client = window.services.createUdpClient(
        host,
        port,
        (type: string, data: string) => {
          onMessage('received', data)
        },
        (err: string) => {
          onMessage('system', tr('socket.system.error', { error: err }, `Error: ${err}`))
        }
      )
      
      controller = {
        send: (data: string) => {
          client.send(data)
          onMessage('sent', data)
        },
        close: () => {
          client.close()
          onStatusChange('disconnected')
          activeSockets.delete(tabId)
        }
      }
    }
  } catch (error) {
    onMessage('system', tr('socket.system.connectionFailure', { error: String(error) }, `Connection failure: ${String(error)}`))
    onStatusChange('disconnected')
  }

  activeSockets.set(tabId, controller)
  return controller
}
