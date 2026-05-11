export interface ColorPreset {
  name: string
  foreground: string
  background: string
  /** 色块预览用的不透明背景色 */
  chipBackground: string
}

export const COLOR_PRESETS: ColorPreset[] = [
  { name: 'White', foreground: '#333333', background: 'rgba(255, 255, 255, 0.5)', chipBackground: '#ffffff' },
  { name: 'Light Gray', foreground: '#444444', background: 'rgba(224, 224, 224, 0.5)', chipBackground: '#e0e0e0' },
  { name: 'Warm', foreground: '#6b5a3e', background: 'rgba(212, 197, 169, 0.5)', chipBackground: '#d4c5a9' },
  { name: 'Blue', foreground: '#ffffff', background: 'rgba(41, 121, 255, 0.5)', chipBackground: '#2979ff' },
  { name: 'Navy', foreground: '#c0c8e0', background: 'rgba(26, 35, 126, 0.5)', chipBackground: '#1a237e' },
  { name: 'Purple', foreground: '#d0c0e8', background: 'rgba(74, 20, 140, 0.5)', chipBackground: '#4a148c' },
  { name: 'Dark', foreground: '#c8c8c8', background: 'rgba(45, 45, 45, 0.5)', chipBackground: '#2d2d2d' },
  { name: 'Black', foreground: '#e0e0e0', background: 'rgba(10, 10, 10, 0.5)', chipBackground: '#0a0a0a' },
]
