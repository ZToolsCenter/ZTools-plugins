import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor (props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError (error) {
    return { error }
  }

  componentDidCatch (error, info) {
    // 打印到 devtools console，方便 ztools/uTools 里排查
    console.error('[DevAssistant] render error:', error, info)
  }

  render () {
    if (this.state.error) {
      return (
        <div style={{ padding: '16px', fontFamily: 'monospace', color: '#c00', whiteSpace: 'pre-wrap' }}>
          <div style={{ fontWeight: 'bold', marginBottom: 8 }}>渲染错误：</div>
          <div>{String(this.state.error?.message || this.state.error)}</div>
          {this.state.error?.stack && (
            <details style={{ marginTop: 8, color: '#888', fontSize: 12 }}>
              <summary>stack</summary>
              {this.state.error.stack}
            </details>
          )}
        </div>
      )
    }
    return this.props.children
  }
}
