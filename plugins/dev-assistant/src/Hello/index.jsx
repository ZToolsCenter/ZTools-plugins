import './index.css'

export default function Hello ({ enterAction }) {
  return (
    <div className='hello'>
      <h1>你好，Hello</h1>
      <h2>插件应用进入参数</h2>
      <pre>
        {JSON.stringify(enterAction, undefined, 2)}
      </pre>
    </div>
  )
}
