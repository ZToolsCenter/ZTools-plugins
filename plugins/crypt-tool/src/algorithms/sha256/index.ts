import { meta } from './meta'
import Sha256UI from './ui'
import type { AlgorithmModule } from '../../registry/types'

export const sha256: AlgorithmModule = { meta, Component: Sha256UI }
