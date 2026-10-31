/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

interface TaxResult {
  direction: string
  gross: number
  incomeBase: number
  taxableBase: number
  tax: number
  net: number
  rate: number
  deduction: number
}

interface Services {
  parseAmount: (input: unknown) => { value: number; raw: string } | null
  calculateForward: (input: unknown) => TaxResult
  calculateReverse: (input: unknown) => TaxResult
  calculate: (input: unknown, mode: 'forward' | 'reverse') => {
    mode: 'forward' | 'reverse'
    input: string
    value: number
    result: TaxResult
  }
}

declare global {
  interface Window {
    services: Services
  }
}

export {}
