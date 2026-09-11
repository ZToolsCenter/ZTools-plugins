import '@testing-library/jest-dom'
import { vi } from 'vitest'

const mockServices = {
  writeImageFile: vi.fn(),
  createPdfFromImages: vi.fn(),
  compressPdf: vi.fn(),
  mergePdfs: vi.fn(),
  splitPdf: vi.fn(),
  addWatermark: vi.fn(),
  convertPdf: vi.fn(),
  convertPdfImages: vi.fn(),
  cancelCurrent: vi.fn(),
  resolveTaskPath: vi.fn((c: { feature: string; taskId: string; filename?: string }) => {
    const base = '/mock/downloads/pdf-' + c.feature + '/' + c.taskId
    return c.filename ? base + '/' + c.filename : base
  }),
  statFile: vi.fn(() => ({ size: 4096 })),
  readFileBase64: vi.fn(() => ''),
  writeFileBase64: vi.fn((_base64: string, outputPath: string) => outputPath),
  getPdfPageCount: vi.fn(async () => 3),
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  deleteFile: vi.fn(),
}

const mockZtools = {
  onPluginEnter: vi.fn(),
  onPluginOut: vi.fn(),
  showNotification: vi.fn(),
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  getPath: vi.fn(() => '/mock/downloads'),
  shellShowItemInFolder: vi.fn(),
  shellOpenExternal: vi.fn(),
  outPlugin: vi.fn(),
  dbStorage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
  setSubInput: vi.fn(),
  showMainWindow: vi.fn(),
  hideMainWindow: vi.fn(),
  copyText: vi.fn(),
  getPathForFile: vi.fn(() => '/mock/test.pdf'),
}

Object.defineProperty(window, 'services', { value: mockServices, writable: true })
Object.defineProperty(window, 'ztools', { value: mockZtools, writable: true })
