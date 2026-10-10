import { meta } from './meta'
import MorseUI from './ui'
import type { AlgorithmModule } from '../../registry/types'

export const morse: AlgorithmModule = { meta, Component: MorseUI }
