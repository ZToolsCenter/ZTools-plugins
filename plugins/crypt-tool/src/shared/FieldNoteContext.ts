import { createContext, useContext } from 'react'

export interface FieldNote {
  label: string
  hint?: string
  help?: string
}

export interface FieldNoteApi {
  setActiveNote: (note: FieldNote | null) => void
  openNotes: () => void
}

export const FieldNoteContext = createContext<FieldNoteApi | null>(null)

export function useFieldNotes(): FieldNoteApi | null {
  return useContext(FieldNoteContext)
}
