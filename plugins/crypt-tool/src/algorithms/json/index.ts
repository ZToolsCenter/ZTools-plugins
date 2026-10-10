import { meta } from './meta'
import JsonUI from './ui'
import type { AlgorithmModule } from '../../registry/types'

export const json: AlgorithmModule = { meta, Component: JsonUI }
