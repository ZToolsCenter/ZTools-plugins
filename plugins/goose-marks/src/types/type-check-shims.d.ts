declare module 'json-schema' {
  export type JSONSchema7 = Record<string, unknown>
}
declare module 'vue-component-type-helpers'
declare module '@tanstack/vue-table' {
  export type Updater<T> = T | ((old: T) => T)
}

type BluetoothLEScanFilter = Record<string, unknown>
type BluetoothServiceUUID = string | number
type BluetoothDevice = Record<string, unknown>
type BluetoothRemoteGATTServer = Record<string, unknown>
