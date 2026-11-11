// Test every API used by the original controls; enumeration alone cannot select output.
function getAudioCapabilities(mediaDevices, AudioClass, AudioContextClass) {
  const enumerate = typeof mediaDevices?.enumerateDevices === 'function'
  // A DSP/visualizer may be enabled later or arrive in the same backup as the device ID.
  // Require both routes up front so an AudioContext can never silently use another output.
  const contextOutput = typeof AudioContextClass?.prototype?.setSinkId === 'function'
  const select = enumerate && typeof AudioClass?.prototype?.setSinkId === 'function' && contextOutput
  const watch = select && typeof mediaDevices?.addEventListener === 'function' && typeof mediaDevices?.removeEventListener === 'function'
  return { enumerate, select, watch, contextOutput }
}
module.exports = { getAudioCapabilities }
