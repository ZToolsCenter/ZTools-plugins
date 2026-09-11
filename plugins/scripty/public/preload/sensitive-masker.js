'use strict'

const MASK = '••••••••'

/** Replaces every non-empty sensitive value, longest first to avoid partial-value leakage. */
function maskSensitiveValues(content, sensitiveValues) {
  return sensitiveValues
    .filter(value => typeof value === 'string' && value.length > 0)
    .sort((a, b) => b.length - a.length)
    .reduce((masked, value) => masked.split(value).join(MASK), content)
}

class SensitiveStreamMasker {
  /** Holds enough trailing characters to detect values split across adjacent stream chunks. */
  constructor(sensitiveValues) {
    this.values = [...new Set(sensitiveValues.filter(value => typeof value === 'string' && value.length > 0))]
    this.maxLength = Math.max(0, ...this.values.map(value => value.length))
    this.pending = ''
  }

  /** Accepts one chunk and emits complete lines only, preventing split secrets from leaking prefixes. */
  push(chunk) {
    const combined = this.pending + chunk
    const lastLineBreak = combined.lastIndexOf('\n')
    if (lastLineBreak < 0) {
      this.pending = combined
      return ''
    }
    const output = combined.slice(0, lastLineBreak + 1)
    this.pending = combined.slice(lastLineBreak + 1)
    return maskSensitiveValues(output, this.values)
  }

  /** Flushes the final buffered suffix after the stream closes. */
  flush() {
    const output = maskSensitiveValues(this.pending, this.values)
    this.pending = ''
    return output
  }
}

module.exports = { MASK, SensitiveStreamMasker, maskSensitiveValues }
