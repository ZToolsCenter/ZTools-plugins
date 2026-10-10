import { meta } from './meta'
import UrlUI from './ui'
import type { AlgorithmModule } from '../../registry/types'

export const url: AlgorithmModule = { meta, Component: UrlUI }
