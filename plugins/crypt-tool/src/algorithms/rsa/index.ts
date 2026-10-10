import { meta } from './meta'
import RsaUI from './ui'
import type { AlgorithmModule } from '../../registry/types'

export const rsa: AlgorithmModule = { meta, Component: RsaUI }
