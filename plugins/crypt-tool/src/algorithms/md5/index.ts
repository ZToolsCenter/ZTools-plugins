import { meta } from './meta'
import Md5UI from './ui'
import type { AlgorithmModule } from '../../registry/types'

export const md5: AlgorithmModule = { meta, Component: Md5UI }
