import { meta } from './meta'
import PasswordStrengthUI from './ui'
import type { AlgorithmModule } from '../../registry/types'

export const passwordStrength: AlgorithmModule = { meta, Component: PasswordStrengthUI }
