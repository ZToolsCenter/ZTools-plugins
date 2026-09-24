import { meta } from './meta'
import EcdsaUI from './ui'
import type { AlgorithmModule } from '../../registry/types'

export const ecdsa: AlgorithmModule = { meta, Component: EcdsaUI }
