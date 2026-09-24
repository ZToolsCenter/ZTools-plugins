import { meta } from './meta'
import RandomBytesUI from './ui'
import type { AlgorithmModule } from '../../registry/types'

export const randomBytes: AlgorithmModule = { meta, Component: RandomBytesUI }
