export interface LocalFolderSliceState {
    localFolderFileManager: string
    localFolderExternalEditor: string
    localFolderTerminal: string
    localFolderHiddenFolders: string[]
}

export interface LocalFolderSliceActions {
    setLocalFolderFileManager: (fileManager: string) => void
    setLocalFolderExternalEditor: (editor: string) => void
    setLocalFolderTerminal: (terminal: string) => void
    setLocalFolderHiddenFolders: (folders: string[]) => void
}

export type LocalFolderSlice = LocalFolderSliceState & LocalFolderSliceActions

export const LOCAL_FOLDER_INITIAL_STATE: LocalFolderSliceState = {
    localFolderFileManager: '',
    localFolderExternalEditor: '',
    localFolderTerminal: '',
    localFolderHiddenFolders: ['assets'],
}

type SetFn = (updater: Partial<LocalFolderSlice> | ((state: LocalFolderSlice) => Partial<LocalFolderSlice>)) => void

export function createLocalFolderSlice(set: SetFn): LocalFolderSlice {
    return {
        ...LOCAL_FOLDER_INITIAL_STATE,
        setLocalFolderFileManager: (fileManager) => set({ localFolderFileManager: fileManager }),
        setLocalFolderExternalEditor: (editor) => set({ localFolderExternalEditor: editor }),
        setLocalFolderTerminal: (terminal) => set({ localFolderTerminal: terminal }),
        setLocalFolderHiddenFolders: (folders) => set({ localFolderHiddenFolders: folders }),
    }
}
