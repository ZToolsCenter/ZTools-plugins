import { meta } from './meta'
import Adler32UI from './ui'
import type { AlgorithmModule } from '../../registry/types'

export const adler32: AlgorithmModule = { meta, Component: Adler32UI }
