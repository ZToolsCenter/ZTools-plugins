import { meta } from './meta'
import Pbkdf2UI from './ui'
import type { AlgorithmModule } from '../../registry/types'

export const pbkdf2: AlgorithmModule = { meta, Component: Pbkdf2UI }
