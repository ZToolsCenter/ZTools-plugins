;(function installWereadClickBridge() {
  'use strict'

  try {
    const { contextBridge } = require('electron')
    if (typeof contextBridge?.executeInMainWorld !== 'function') return

    contextBridge.executeInMainWorld({
      func: function installClickBridgeInPage() {
        if (window.__ztoolsSingleLineInvokeClick) return

        const clickListeners = new WeakMap()
        const originalAddEventListener = EventTarget.prototype.addEventListener
        const originalRemoveEventListener = EventTarget.prototype.removeEventListener

        EventTarget.prototype.addEventListener = function addEventListener(type, listener, options) {
          if (type === 'click' && listener) {
            const listeners = clickListeners.get(this) || []
            listeners.push(listener)
            clickListeners.set(this, listeners)
          }
          return originalAddEventListener.call(this, type, listener, options)
        }

        EventTarget.prototype.removeEventListener = function removeEventListener(type, listener, options) {
          if (type === 'click' && listener) {
            const listeners = clickListeners.get(this)
            if (listeners) {
              const index = listeners.indexOf(listener)
              if (index >= 0) listeners.splice(index, 1)
              if (!listeners.length) clickListeners.delete(this)
            }
          }
          return originalRemoveEventListener.call(this, type, listener, options)
        }

        Object.defineProperty(window, '__ztoolsSingleLineInvokeClick', {
          configurable: false,
          enumerable: false,
          writable: false,
          value: function invokeClick(element) {
            let listener = clickListeners.get(element)?.at(-1)
            if (!listener) return false
            while (listener.__sentry_original__) listener = listener.__sentry_original__

            const event = new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              composed: true,
              view: window,
            })
            Object.defineProperty(event, 'currentTarget', { value: element })

            if (typeof listener === 'function') listener.call(element, event)
            else if (typeof listener.handleEvent === 'function') listener.handleEvent(event)
            else return false
            return true
          },
        })
      },
    })
  } catch (error) {}
})()
