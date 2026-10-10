import { meta } from './meta'
import HtmlEntityUI from './ui'
import type { AlgorithmModule } from '../../registry/types'

export const htmlEntity: AlgorithmModule = { meta, Component: HtmlEntityUI }
