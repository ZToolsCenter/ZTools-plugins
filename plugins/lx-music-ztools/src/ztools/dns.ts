import './contracts'
export function lookup(hostname, options, callback?) {
  if (typeof options === 'function') { callback = options; options = {} }
  window.lxHost.invoke<any>('dns:lookup', { hostname, options }).then(result => callback(null, result.address, result.family), error => callback(error))
}
export default { lookup }
