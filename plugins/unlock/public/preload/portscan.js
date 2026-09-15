function buildPortQueryScript(port) {
  return [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$OutputEncoding = [System.Text.Encoding]::UTF8',
    '$port = ' + port,
    '$results = @()',
    'function Get-ProcessPath($p) {',
    '  try { return $p.Path } catch {}',
    '  try {',
    '    $cim = Get-CimInstance Win32_Process -Filter "ProcessId = $($p.Id)" -ErrorAction SilentlyContinue',
    '    if ($cim) { return $cim.ExecutablePath }',
    '  } catch {}',
    '  return ""',
    '}',
    '$tcp = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue',
    'if ($tcp) {',
    '  foreach ($c in $tcp) {',
    '    $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue',
    '    $results += @{',
    '      pid = [int]$c.OwningProcess',
    '      processName = if ($proc) { $proc.ProcessName } else { "" }',
    '      exePath = if ($proc) { Get-ProcessPath $proc } else { "" }',
    '      protocol = "TCP"',
    '      state = $c.State.ToString()',
    '      localAddress = $c.LocalAddress',
    '      localPort = [int]$c.LocalPort',
    '    }',
    '  }',
    '}',
    '$udp = Get-NetUDPEndpoint -LocalPort $port -ErrorAction SilentlyContinue',
    'if ($udp) {',
    '  foreach ($c in $udp) {',
    '    $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue',
    '    $results += @{',
    '      pid = [int]$c.OwningProcess',
    '      processName = if ($proc) { $proc.ProcessName } else { "" }',
    '      exePath = if ($proc) { Get-ProcessPath $proc } else { "" }',
    '      protocol = "UDP"',
    '      state = "Listening"',
    '      localAddress = $c.LocalAddress',
    '      localPort = [int]$c.LocalPort',
    '    }',
    '  }',
    '}',
    'if ($results.Count -gt 0) { $results | ConvertTo-Json -Compress } else { Write-Output "[]" }'
  ].join('\n')
}

function parsePortOutput(raw) {
  const trimmed = raw.trim().replace(/^\uFEFF/, '')
  if (!trimmed || trimmed === '[]') return []
  try {
    const parsed = JSON.parse(trimmed)
    if (!Array.isArray(parsed)) {
      return [{
        pid: parsed.pid || 0,
        processName: parsed.processName || '',
        exePath: parsed.exePath || '',
        protocol: parsed.protocol || 'TCP',
        state: parsed.state || '',
        localAddress: parsed.localAddress || '',
        localPort: parsed.localPort || 0
      }]
    }
    return parsed.map(function (p) { return {
      pid: p.pid || 0,
      processName: p.processName || '',
      exePath: p.exePath || '',
      protocol: p.protocol || 'TCP',
      state: p.state || '',
      localAddress: p.localAddress || '',
      localPort: p.localPort || 0
    }})
  } catch (e) {
    return []
  }
}

module.exports = { buildPortQueryScript, parsePortOutput }
