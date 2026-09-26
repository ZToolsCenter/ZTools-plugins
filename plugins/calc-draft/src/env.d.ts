/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare global {
  interface Window {
    services: Record<string, never>
  }
}

export {}
