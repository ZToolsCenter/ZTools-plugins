import { meta } from './meta'
import HexUI from './ui'
import type { AlgorithmModule } from '../../registry/types'

export const hex: AlgorithmModule = { meta, Component: HexUI }
