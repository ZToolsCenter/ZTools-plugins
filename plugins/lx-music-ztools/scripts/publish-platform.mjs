/** Quote the CLI's generated Git refs/paths for cmd.exe, rejecting shell expansion. */
function quoteWindowsGitArgument(value) {
  if (typeof value !== 'string' || /["%!\r\n\0]/.test(value)) throw new Error('Unsupported character in Windows Git argument')
  // Windows argv parsing requires doubling backslashes immediately before the closing quote.
  return '"' + value.replace(/\\+$/, tail => tail + tail) + '"'
}

/** Fix CLI 1.3.2's POSIX-only shell quoting without changing its sync/protection logic. */
export function adaptCliUpstream(source, platform = process.platform) {
  if (platform !== 'win32') return source
  const marker = 'function shellQuote(value) {'
  if (!source.includes(marker)) throw new Error('CLI upstream quoting changed; inspect before publishing')
  return source.replace(marker, `${marker}\n    return (${quoteWindowsGitArgument.toString()})(value);`)
}
