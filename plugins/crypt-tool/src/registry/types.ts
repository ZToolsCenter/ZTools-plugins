import type { FC } from 'react'

export type CategoryId =
  | 'encoding'
  | 'hash'
  | 'symmetric'
  | 'asymmetric'
  | 'hmac'
  | 'kdf'
  | 'tools'

export type DirectionMode = 'encode' | 'decode' | 'encrypt' | 'decrypt'

export interface AlgorithmMeta {
  id: string
  category: CategoryId
  label: string
  title: string
  reversible: boolean
  cmds: string[]
  defaultEnabled: boolean
  teach: { summary: string }
}

export interface AlgorithmProps {
  direction?: DirectionMode
  onDirectionChange?: (dir: DirectionMode) => void
}

export interface AlgorithmModule {
  meta: AlgorithmMeta
  Component: FC<AlgorithmProps>
}
