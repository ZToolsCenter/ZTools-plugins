import { meta } from './meta'
import XorStreamUI from './ui'
import type { AlgorithmModule } from '../../registry/types'

export const xorStream: AlgorithmModule = { meta, Component: XorStreamUI }
