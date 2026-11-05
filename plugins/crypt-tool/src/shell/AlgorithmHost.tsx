import { memo, useCallback, useMemo, useState } from 'react'
import type { AlgorithmModule, CategoryId, DirectionMode } from '../registry/types'
import { categoryLabel } from '../registry'
import { FieldNoteContext, Icon } from '../shared'
import type { FieldNote, FieldNoteApi } from '../shared'
import NotesPanel from './NotesPanel'

interface Props {
  module: AlgorithmModule
}

function initialDirection(category: CategoryId): DirectionMode {
  return category === 'encoding' ? 'encode' : 'encrypt'
}

function getToggleLabels(category: CategoryId): [string, string] {
  return category === 'encoding' ? ['编码', '解码'] : ['加密', '解密']
}

function AlgorithmHost({ module }: Props) {
  const { Component, meta } = module
  const [dir, setDir] = useState<DirectionMode>(() => initialDirection(meta.category))
  const [activeNote, setActiveNote] = useState<FieldNote | null>(null)
  const [notesOpen, setNotesOpen] = useState<boolean>(() => {
    return window.matchMedia?.('(min-width: 1001px)').matches ?? true
  })

  const [labelA, labelB] = useMemo(() => getToggleLabels(meta.category), [meta.category])
  const dirA = meta.category === 'encoding' ? 'encode' : 'encrypt'
  const dirB = meta.category === 'encoding' ? 'decode' : 'decrypt'

  const openNotes = useCallback(() => setNotesOpen(true), [])
  const notesApi = useMemo<FieldNoteApi>(
    () => ({ setActiveNote, openNotes }),
    [openNotes]
  )

  const changeDirection = (next: DirectionMode) => {
    setDir(next)
    setActiveNote(null)
  }

  return (
    <div className="ct-main">
      <header className="ct-head">
        <div className="ct-head-row">
          <div className="ct-crumb">
            <span>{categoryLabel(meta.category)}</span>
            <span className="ct-crumb-sep">/</span>
            <span className="ct-crumb-id">alg:{meta.id}</span>
          </div>
          <div className="ct-head-tools">
            {meta.reversible ? (
              <div className="ct-dir" role="group" aria-label="操作方向">
                <button
                  type="button"
                  className={dir === dirA ? 'on' : ''}
                  aria-pressed={dir === dirA}
                  onClick={() => changeDirection(dirA)}
                >
                  {labelA}
                </button>
                <button
                  type="button"
                  className={dir === dirB ? 'on' : ''}
                  aria-pressed={dir === dirB}
                  onClick={() => changeDirection(dirB)}
                >
                  {labelB}
                </button>
              </div>
            ) : null}
            <button
              type="button"
              className={`ct-note-toggle ${notesOpen ? 'is-open' : ''}`}
              onClick={() => setNotesOpen((open) => !open)}
              aria-pressed={notesOpen}
              title={notesOpen ? '收起边注' : '打开边注'}
            >
              <Icon name="note" />
              <span className="ct-note-label">边注</span>
            </button>
          </div>
        </div>
        <div className="ct-title-row">
          <h1 className="ct-title">{meta.title}</h1>
          <div className="ct-badges">
            <span className={`ct-badge ${meta.reversible ? 'is-reversible' : ''}`}>
              {meta.reversible ? '可逆' : '单向'}
            </span>
            <span className="ct-badge is-live">
              <span className="ct-live-dot" />
              本地运算
            </span>
          </div>
        </div>
      </header>

      <div className={`ct-work ${notesOpen ? '' : 'ct-work--full'}`}>
        <div className="ct-signal">
          <FieldNoteContext.Provider value={notesApi}>
            <Component
              direction={meta.reversible ? dir : undefined}
              onDirectionChange={meta.reversible ? changeDirection : undefined}
            />
          </FieldNoteContext.Provider>
        </div>
        {notesOpen ? (
          <NotesPanel meta={meta} activeNote={activeNote} onClose={() => setNotesOpen(false)} />
        ) : null}
      </div>
    </div>
  )
}

export default memo(AlgorithmHost)
