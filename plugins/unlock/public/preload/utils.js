function getKillCommand(pid) {
  // /f = force, /t = kill process tree (child processes too)
  return { cmd: 'taskkill', args: ['/pid', String(pid), '/f', '/t'] }
}

module.exports = { getKillCommand }
