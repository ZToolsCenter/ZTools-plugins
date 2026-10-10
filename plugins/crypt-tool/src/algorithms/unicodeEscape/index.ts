import { meta } from './meta'
import UnicodeEscapeUI from './ui'
import type { AlgorithmModule } from '../../registry/types'

export const unicodeEscape: AlgorithmModule = { meta, Component: UnicodeEscapeUI }
