import { meta } from './meta'
import AesUI from './ui'
import type { AlgorithmModule } from '../../registry/types'

export const aes: AlgorithmModule = { meta, Component: AesUI }
