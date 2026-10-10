import { meta } from './meta'
import Base32UI from './ui'
import type { AlgorithmModule } from '../../registry/types'

export const base32: AlgorithmModule = { meta, Component: Base32UI }
