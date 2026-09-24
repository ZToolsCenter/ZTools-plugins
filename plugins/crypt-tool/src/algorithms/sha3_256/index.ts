import { meta } from './meta'
import Sha3_256UI from './ui'
import type { AlgorithmModule } from '../../registry/types'

export const sha3_256: AlgorithmModule = { meta, Component: Sha3_256UI }
