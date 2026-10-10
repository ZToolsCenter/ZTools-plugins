import { meta } from './meta'
import PunycodeUI from './ui'
import type { AlgorithmModule } from '../../registry/types'

export const punycode: AlgorithmModule = { meta, Component: PunycodeUI }
