import { meta } from './meta'
import Sha384UI from './ui'
import type { AlgorithmModule } from '../../registry/types'

export const sha384: AlgorithmModule = { meta, Component: Sha384UI }
