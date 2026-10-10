import { meta } from './meta'
import EcdhUI from './ui'
import type { AlgorithmModule } from '../../registry/types'

export const ecdh: AlgorithmModule = { meta, Component: EcdhUI }
