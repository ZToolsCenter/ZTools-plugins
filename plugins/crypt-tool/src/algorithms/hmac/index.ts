import { meta } from './meta'
import HmacUI from './ui'
import type { AlgorithmModule } from '../../registry/types'

export const hmac: AlgorithmModule = { meta, Component: HmacUI }
