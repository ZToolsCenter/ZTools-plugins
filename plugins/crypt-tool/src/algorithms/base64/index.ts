import { meta } from './meta'
import Base64UI from './ui'
import type { AlgorithmModule } from '../../registry/types'

export const base64: AlgorithmModule = { meta, Component: Base64UI }
