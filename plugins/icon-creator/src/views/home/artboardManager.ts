import type { Ref } from 'vue'
import type { Canvas } from 'fabric'
import type { IconCreatorProjectArtboard, IconCreatorProjectCanvas } from './types'
import {
  DEFAULT_KEYLINE_MARGIN,
  DEFAULT_KEYLINE_OPACITY,
  DEFAULT_KEYLINE_TEMPLATE,
  DEFAULT_PIXEL_GRID_SIZE
} from './constants'

export function generateArtboardId(seed: Ref<number>): string {
  return `artboard-${++seed.value}-${Date.now()}`
}

export function generateArtboardThumbnail(
  fabricCanvas: Canvas | null,
  canvasWidth: number,
  canvasHeight: number
): string {
  if (!fabricCanvas) return ''
  try {
    return fabricCanvas.toDataURL({
      format: 'png',
      multiplier: 64 / Math.max(canvasWidth, canvasHeight)
    })
  } catch {
    return ''
  }
}

export function createEmptyArtboard(id: string, name: string): IconCreatorProjectArtboard {
  return {
    id,
    name,
    canvas: {
      width: 512,
      height: 512,
      background: '#ffffff',
      gridSize: DEFAULT_PIXEL_GRID_SIZE,
      showPixelGrid: false,
      snapToPixelGrid: false,
      keylineTemplate: DEFAULT_KEYLINE_TEMPLATE,
      keylineMargin: DEFAULT_KEYLINE_MARGIN,
      keylineOpacity: DEFAULT_KEYLINE_OPACITY
    },
    fabric: { version: '6.0.0', objects: [] },
    layerOrder: []
  }
}

export function createDefaultArtboard(): IconCreatorProjectArtboard {
  return createEmptyArtboard('artboard-1', '画板 1')
}
