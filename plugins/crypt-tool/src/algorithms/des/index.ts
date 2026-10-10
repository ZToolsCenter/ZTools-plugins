import { meta } from './meta'
import DesUI from './ui'
import type { AlgorithmModule } from '../../registry/types'

export const des: AlgorithmModule = { meta, Component: DesUI }
