import { vi } from 'vitest'

export interface ServicesStub {
  mavenSearch: ReturnType<typeof vi.fn>
  mavenVersions: ReturnType<typeof vi.fn>
  codeReadVersions: ReturnType<typeof vi.fn>
  setProxy: ReturnType<typeof vi.fn>
  getProxy: ReturnType<typeof vi.fn>
}

export interface ZtoolsStub {
  clipboard: {
    writeContent: ReturnType<typeof vi.fn>
  }
  showNotification: ReturnType<typeof vi.fn>
  isDarkColors: ReturnType<typeof vi.fn>
  hideMainWindow: ReturnType<typeof vi.fn>
  onPluginEnter: ReturnType<typeof vi.fn>
  setSubInput: ReturnType<typeof vi.fn>
  http: {
    setHeaders: ReturnType<typeof vi.fn>
  }
  dbStorage: {
    setItem: ReturnType<typeof vi.fn>
    getItem: ReturnType<typeof vi.fn>
    removeItem: ReturnType<typeof vi.fn>
  }
}

export interface Stubs {
  services: ServicesStub
  ztools: ZtoolsStub
}

export function installZtoolsStub(overrides: Partial<Stubs> = {}): Stubs {
  const services: ServicesStub = overrides.services ?? {
    mavenSearch: vi.fn().mockResolvedValue({ data: [], source: 'solr' }),
    mavenVersions: vi.fn().mockResolvedValue({ data: [], source: 'solr' }),
    codeReadVersions: vi.fn().mockResolvedValue({ data: [], source: 'coderead' }),
    setProxy: vi.fn().mockReturnValue(true),
    getProxy: vi.fn().mockReturnValue('http://127.0.0.1:7890'),
  }
  const ztools: ZtoolsStub = overrides.ztools ?? {
    clipboard: {
      writeContent: vi.fn().mockResolvedValue(true),
    },
    showNotification: vi.fn(),
    isDarkColors: vi.fn().mockReturnValue(false),
    hideMainWindow: vi.fn().mockResolvedValue(true),
    onPluginEnter: vi.fn(),
    setSubInput: vi.fn(),
    http: {
      setHeaders: vi.fn().mockReturnValue(true),
    },
    dbStorage: {
      setItem: vi.fn().mockResolvedValue(true),
      getItem: vi.fn().mockResolvedValue(null),
      removeItem: vi.fn().mockResolvedValue(true),
    },
  }

  ;(globalThis as any).services = services
  ;(globalThis as any).ztools = ztools

  return { services, ztools }
}

// installZtoolsStub is re-entrant — calling it again (e.g., in `beforeEach`)
// replaces the prior stubs cleanly. Pair with `uninstallZtoolsStub` in
// `afterEach` if a test needs to assert the absence of `window.services`.
export function uninstallZtoolsStub() {
  delete (globalThis as any).services
  delete (globalThis as any).ztools
}
