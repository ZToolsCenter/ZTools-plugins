import { meta } from './meta'
import JwtUI from './ui'
import type { AlgorithmModule } from '../../registry/types'

export const jwt: AlgorithmModule = { meta, Component: JwtUI }
