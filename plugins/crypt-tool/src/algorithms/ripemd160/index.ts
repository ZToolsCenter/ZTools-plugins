import { meta } from './meta'
import Ripemd160UI from './ui'
import type { AlgorithmModule } from '../../registry/types'

export const ripemd160: AlgorithmModule = { meta, Component: Ripemd160UI }
