const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { buildPortQueryScript, parsePortOutput } = require('./portscan')

describe('portscan', () => {
  describe('buildPortQueryScript', () => {
    it('includes the port number', () => {
      const script = buildPortQueryScript(8080)
      assert(script.includes('8080'))
    })

    it('includes Get-NetTCPConnection', () => {
      const script = buildPortQueryScript(443)
      assert(script.includes('Get-NetTCPConnection'))
    })

    it('includes Get-NetUDPEndpoint', () => {
      const script = buildPortQueryScript(53)
      assert(script.includes('Get-NetUDPEndpoint'))
    })
  })

  describe('parsePortOutput', () => {
    it('parses TCP listening port JSON', () => {
      const json = JSON.stringify([{
        pid: 1234, processName: 'nginx', exePath: 'C:\\nginx.exe',
        protocol: 'TCP', state: 'Listen',
        localAddress: '0.0.0.0', localPort: 8080
      }])
      const result = parsePortOutput(json)
      assert.equal(result.length, 1)
      assert.equal(result[0].pid, 1234)
      assert.equal(result[0].protocol, 'TCP')
      assert.equal(result[0].state, 'Listen')
    })

    it('parses UDP endpoint JSON', () => {
      const json = JSON.stringify([{
        pid: 5678, processName: 'dns.exe', exePath: '',
        protocol: 'UDP', state: 'Listening',
        localAddress: '0.0.0.0', localPort: 53
      }])
      const result = parsePortOutput(json)
      assert.equal(result.length, 1)
      assert.equal(result[0].protocol, 'UDP')
    })

    it('handles empty array', () => {
      const result = parsePortOutput('[]')
      assert.equal(result.length, 0)
    })

    it('handles missing owning process info', () => {
      const json = JSON.stringify([{
        pid: 9999, processName: '', exePath: '',
        protocol: 'TCP', state: 'Listen',
        localAddress: '::', localPort: 80
      }])
      const result = parsePortOutput(json)
      assert.equal(result.length, 1)
      assert.equal(result[0].processName, '')
    })

    it('handles multiple connections on same port', () => {
      const json = JSON.stringify([
        { pid: 1, processName: 'a', exePath: '', protocol: 'TCP', state: 'Listen', localAddress: '0.0.0.0', localPort: 80 },
        { pid: 2, processName: 'b', exePath: '', protocol: 'TCP', state: 'Listen', localAddress: '0.0.0.0', localPort: 80 }
      ])
      const result = parsePortOutput(json)
      assert.equal(result.length, 2)
    })
  })
})
