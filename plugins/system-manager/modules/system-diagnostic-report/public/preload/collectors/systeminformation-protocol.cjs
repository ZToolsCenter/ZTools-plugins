'use strict'

// Keep this list deliberately small. Every method here may execute synchronous
// platform commands, so production calls must go through the helper-process boundary.
const SYSTEM_INFORMATION_METHODS = Object.freeze([
  'cpu',
  'mem',
  'graphics',
  'battery',
  'currentLoad'
])
const SYSTEM_INFORMATION_METHOD_SET = new Set(SYSTEM_INFORMATION_METHODS)

function isAllowedSystemInformationMethod(methodName) {
  return typeof methodName === 'string' && SYSTEM_INFORMATION_METHOD_SET.has(methodName)
}

function pick(source, keys) {
  const input = source && typeof source === 'object' ? source : {}
  const output = {}
  for (const key of keys) output[key] = input[key]
  return output
}

function projectCpu(value) {
  return pick(value, [
    'manufacturer', 'brand', 'model', 'physicalCores', 'cores', 'processors', 'speed', 'socket'
  ])
}

function projectMemory(value) {
  return pick(value, [
    'total', 'free', 'used', 'active', 'available', 'swaptotal', 'swapused'
  ])
}

function projectGraphics(value) {
  const input = value && typeof value === 'object' ? value : {}
  const controllers = Array.isArray(input.controllers) ? input.controllers : []
  const displays = Array.isArray(input.displays) ? input.displays : []

  return {
    controllers: controllers.map((controller) => pick(controller, [
      'vendor', 'model', 'bus', 'vram', 'vramDynamic'
    ])),
    displays: displays.map((display) => pick(display, [
      'currentResX', 'currentResY', 'resolutionX', 'resolutionY', 'scaleFactor',
      'rotation', 'colorDepth', 'pixelDepth', 'pixeldepth', 'currentRefreshRate',
      'primary', 'main', 'internal', 'builtin'
    ]))
  }
}

function projectBattery(value) {
  return pick(value, [
    'hasBattery', 'isCharging', 'percent', 'cycleCount', 'timeRemaining',
    'voltage', 'designedCapacity', 'maxCapacity', 'currentCapacity'
  ])
}

function projectCurrentLoad(value) {
  return pick(value, ['currentLoad', 'currentLoadUser', 'currentLoadSystem'])
}

function projectSystemInformationResult(methodName, value) {
  switch (methodName) {
    case 'cpu': return projectCpu(value)
    case 'mem': return projectMemory(value)
    case 'graphics': return projectGraphics(value)
    case 'battery': return projectBattery(value)
    case 'currentLoad': return projectCurrentLoad(value)
    default: {
      const error = new Error('System information method is not allowed')
      error.code = 'METHOD_NOT_ALLOWED'
      throw error
    }
  }
}

module.exports = {
  SYSTEM_INFORMATION_METHODS,
  isAllowedSystemInformationMethod,
  projectSystemInformationResult
}
