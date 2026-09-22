import { meta } from './meta'
import BcryptUI from './ui'
import type { AlgorithmModule } from '../../registry/types'

export const bcrypt: AlgorithmModule = { meta, Component: BcryptUI }
