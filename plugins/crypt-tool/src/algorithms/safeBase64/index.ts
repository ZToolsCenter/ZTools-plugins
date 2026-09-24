import { meta } from './meta'
import SafeBase64UI from './ui'
import type { AlgorithmModule } from '../../registry/types'

export const safeBase64: AlgorithmModule = { meta, Component: SafeBase64UI }
