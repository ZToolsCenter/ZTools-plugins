import type { SearchProvider, PrivacySettings, CustomAction } from '../types'
import {
    AUTO_CLOSE_INACTIVE_TABS_HOURS_DEFAULT,
    normalizeAutoCloseInactiveTabsHours,
    DEFAULT_SEARCH_PROVIDERS,
    getSearchProviderTemplateError,
} from '../types'

export interface SearchProvidersSliceState {
    searchProviders: SearchProvider[]
    searchAllNotebooks: boolean
    showRecentInSearch: boolean
    /** 鼠标悬停时自动展开笔记本切换下拉菜单。默认关闭，需点击触发。 */
    notebookDropdownHoverExpand: boolean
    privacy: PrivacySettings
    customActions: CustomAction[]
    // 已关闭的通知 ID 集合，持久化存储
    dismissedNotices: Record<string, boolean>
}
export interface SearchProvidersSliceActions {
    toggleSearchProvider: (id: string) => void
    reorderSearchProviders: (nextIds: string[]) => void
    addCustomSearchProvider: (provider: Pick<SearchProvider, 'name' | 'urlTemplate'>) => void
    updateCustomSearchProvider: (id: string, provider: Pick<SearchProvider, 'name' | 'urlTemplate'>) => void
    removeCustomSearchProvider: (id: string) => void
    setSearchAllNotebooks: (searchAll: boolean) => void
    setShowRecentInSearch: (enabled: boolean) => void
    setNotebookDropdownHoverExpand: (enabled: boolean) => void
    setAutoOpenLastNote: (enabled: boolean) => void
    setAutoCloseInactiveTabs: (enabled: boolean) => void
    setAutoCloseInactiveTabsHours: (hours: number) => void
    addCustomAction: (action: Omit<CustomAction, 'id'>) => void
    updateCustomAction: (id: string, updates: Partial<Omit<CustomAction, 'id'>>) => void
    removeCustomAction: (id: string) => void
    dismissNotice: (noticeId: string) => void
}

export type SearchProvidersSlice = SearchProvidersSliceState & SearchProvidersSliceActions

export const SEARCH_PROVIDERS_INITIAL_STATE: SearchProvidersSliceState = {
    searchProviders: DEFAULT_SEARCH_PROVIDERS,
    searchAllNotebooks: false,
    showRecentInSearch: true,
    notebookDropdownHoverExpand: false,
    privacy: {
        autoOpenLastNote: true,
        autoCloseInactiveTabs: false,
        autoCloseInactiveTabsHours: AUTO_CLOSE_INACTIVE_TABS_HOURS_DEFAULT,
    },
    customActions: [],
    dismissedNotices: {},
}

type SetFn = (updater: Partial<SearchProvidersSlice> | ((state: SearchProvidersSlice) => Partial<SearchProvidersSlice>)) => void

export function createSearchProvidersSlice(set: SetFn): SearchProvidersSlice {
    return {
        ...SEARCH_PROVIDERS_INITIAL_STATE,
        toggleSearchProvider: (id) =>
            set((state) => ({
                searchProviders: state.searchProviders.map((provider) =>
                    provider.id === id ? { ...provider, isEnabled: !provider.isEnabled } : provider
                ),
            })),
        reorderSearchProviders: (nextIds) =>
            set((state) => {
                const providerMap = new Map(state.searchProviders.map((provider) => [provider.id, provider]))
                const nextProviders: SearchProvider[] = []
                const seen = new Set<string>()

                nextIds.forEach((id) => {
                    const provider = providerMap.get(id)
                    if (!provider || seen.has(id)) return
                    nextProviders.push(provider)
                    seen.add(id)
                })

                state.searchProviders.forEach((provider) => {
                    if (seen.has(provider.id)) return
                    nextProviders.push(provider)
                })

                return { searchProviders: nextProviders }
            }),
        addCustomSearchProvider: ({ name, urlTemplate }) => {
            const normalizedName = name.trim().slice(0, 30)
            const normalizedTemplate = urlTemplate.trim()
            if (!normalizedName || getSearchProviderTemplateError(normalizedTemplate)) return

            set((state) => ({
                searchProviders: [
                    ...state.searchProviders,
                    {
                        id: `custom-search-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                        name: normalizedName,
                        urlTemplate: normalizedTemplate,
                        isEnabled: true,
                        isCustom: true,
                    },
                ],
            }))
        },
        updateCustomSearchProvider: (id, { name, urlTemplate }) => {
            const normalizedName = name.trim().slice(0, 30)
            const normalizedTemplate = urlTemplate.trim()
            if (!normalizedName || getSearchProviderTemplateError(normalizedTemplate)) return

            set((state) => ({
                searchProviders: state.searchProviders.map((provider) =>
                    provider.id === id && provider.isCustom
                        ? {
                            ...provider,
                            name: normalizedName,
                            urlTemplate: normalizedTemplate,
                        }
                        : provider
                ),
            }))
        },
        removeCustomSearchProvider: (id) =>
            set((state) => ({
                searchProviders: state.searchProviders.filter(
                    (provider) => provider.id !== id || !provider.isCustom
                ),
            })),
        setSearchAllNotebooks: (searchAll) => set({ searchAllNotebooks: searchAll }),
        setShowRecentInSearch: (enabled) => set({ showRecentInSearch: enabled }),
        setNotebookDropdownHoverExpand: (enabled) => set({ notebookDropdownHoverExpand: enabled }),
        setAutoOpenLastNote: (enabled) =>
            set((state) => ({
                privacy: { ...state.privacy, autoOpenLastNote: enabled },
            })),
        setAutoCloseInactiveTabs: (enabled) =>
            set((state) => ({
                privacy: { ...state.privacy, autoCloseInactiveTabs: enabled },
            })),
        setAutoCloseInactiveTabsHours: (hours) =>
            set((state) => ({
                privacy: {
                    ...state.privacy,
                    autoCloseInactiveTabsHours: normalizeAutoCloseInactiveTabsHours(hours),
                },
            })),
        addCustomAction: (action) =>
            set((state) => ({
                customActions: [...state.customActions, {
                    ...action,
                    id: Date.now().toString(),
                }],
            })),
        updateCustomAction: (id, updates) =>
            set((state) => ({
                customActions: state.customActions.map((a) => {
                    if (a.id !== id) return a
                    const newAction = { ...a, ...updates }
                    // 名称为空时自动关闭
                    if (!newAction.name.trim()) newAction.isEnabled = false
                    return newAction
                }),
            })),
        removeCustomAction: (id) =>
            set((state) => ({
                customActions: state.customActions.filter((a) => a.id !== id),
            })),
        dismissNotice: (noticeId) =>
            set((state) => ({
                dismissedNotices: { ...state.dismissedNotices, [noticeId]: true },
            })),
    }
}
