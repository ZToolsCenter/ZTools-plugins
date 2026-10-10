import { useState, memo, useMemo } from 'react'
import type { AlgorithmModule } from '../registry/types'
import type { DirectionMode } from '../registry/types'
import { TeachCard } from '../shared'

interface Props {
  module: AlgorithmModule
}

function getToggleLabels(category: string): [string, string] {
  if (category === 'encoding') return ['编码', '解码']
  return ['加密', '解密']
}

function AlgorithmHost({ module }: Props) {
  const { Component, meta } = module
  const [dir, setDir] = useState<DirectionMode>(
    meta.category === 'encoding' ? 'encode' : 'encrypt'
  )

  const [labelA, labelB] = useMemo(() => getToggleLabels(meta.category), [meta.category])

  return (
    <div className="ct-main">
      <div className="ct-main-head">
        <h4>{meta.title}</h4>
        {meta.reversible ? (
          <div className="ct-tabs ct-tabs-inline">
            <button
              type="button"
              className={`ct-tab ${dir === 'encode' || dir === 'encrypt' ? 'on' : ''}`}
              onClick={() => setDir(meta.category === 'encoding' ? 'encode' : 'encrypt')}
            >
              {labelA}
            </button>
            <button
              type="button"
              className={`ct-tab ${dir === 'decode' || dir === 'decrypt' ? 'on' : ''}`}
              onClick={() => setDir(meta.category === 'encoding' ? 'decode' : 'decrypt')}
            >
              {labelB}
            </button>
          </div>
        ) : (
          <span className="ct-cat">{meta.title}</span>
        )}
      </div>
      <Component
        direction={meta.reversible ? dir : undefined}
        onDirectionChange={meta.reversible ? setDir : undefined}
      />
      <TeachCard summary={meta.teach.summary} />
    </div>
  )
}

export default memo(AlgorithmHost)
