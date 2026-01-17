import { getAssetUrlsByImport } from '@tldraw/assets/imports.vite'
import mime from 'mime/lite'
import { useLayoutEffect, useState } from 'react'
import throttle from 'throttleit'
import {
	type TldrawProps,
	type TLAssetStore,
	DEFAULT_SUPPORTED_MEDIA_TYPE_LIST,
	createTLStore,
	FileHelpers,
	LoadingScreen,
	ErrorScreen,
	DefaultSpinner,
	getSnapshot,
	loadSnapshot,
	Tldraw,
} from 'tldraw'
import 'tldraw/tldraw.css'

const assetStore: TLAssetStore = {
	upload: async (asset, file) => {
		const isAssetUploaded = await window.utools.db.promises.getAttachment(
			asset.id,
		)

		if (!isAssetUploaded) {
			const attachment = new Uint8Array(await file.arrayBuffer())

			await window.utools.db.promises.postAttachment(
				asset.id,
				attachment,
				file.type,
			)
		}

		return {
			src: await FileHelpers.blobToDataUrl(file),
		}
	},
	resolve: async (asset) => {
		const attachment = await window.utools.db.promises.getAttachment(asset.id)

		if (attachment) {
			console.log(attachment)

			// @ts-expect-error
			const blob = new Blob([attachment], { type: asset.type })

			return URL.createObjectURL(blob)
		}

		return null
	},
}

const assetUrls = getAssetUrlsByImport((assetUrl) => assetUrl)

const PERSISTENCE_KEY = 'whiteboard-app'

type LoadingState =
	| { status: 'loading' }
	| { status: 'ready' }
	| { status: 'error'; error: string }

// Migrate data from utools.dbStorage to localConfig
if (window.utools) {
	try {
		const data = window.utools.dbStorage.getItem(PERSISTENCE_KEY)

		// 确保数据有效且目标位置为空
		if (data && !window.preload.localConfig.getItem(PERSISTENCE_KEY)) {
			// 先确保新数据能够写入成功
			window.preload.localConfig.setItem(PERSISTENCE_KEY, data)

			// 写入成功后再删除旧数据
			window.utools.dbStorage.removeItem(PERSISTENCE_KEY)
		}
	} catch (error) {
		alert(`数据迁移失败：${error}`)
		window.utools.showMainWindow()
	}
}

const App = () => {
	const [store] = useState(() =>
		createTLStore({ assets: window.utools ? assetStore : undefined }),
	)

	const [loadingState, setLoadingState] = useState<LoadingState>({
		status: 'loading',
	})

	const tldrawProps: TldrawProps = {
		store,
		assetUrls,
		inferDarkMode: true,
		overrides: {
			actions: (editor, actions, helper) => {
				helper.insertMedia = async () => {
					const _files = await window.preload.openFiles({
						filters: [
							{
								name: '媒体',
								extensions: DEFAULT_SUPPORTED_MEDIA_TYPE_LIST.split(
									',',
								).flatMap((type) => {
									const extensions = mime.getAllExtensions(type)

									return extensions ? Array.from(extensions) : []
								}),
							},
						],
					})

					if (_files.some((file) => file.size >= 10 * 1024 * 1024)) {
						helper.addToast({
							severity: 'warning',
							title: '文件过大',
							description: '单个文件大小不能超过 10MB。',
						})
					}

					const files = _files
						.filter((file) => file.size < 10 * 1024 * 1024)
						.map(
							(file) =>
								new File([file], file.name, {
									type: mime.getType(file.name) || file.type,
								}),
						)

					if (files.length === 0) {
						return
					}

					editor.markHistoryStoppingPoint('insert media')
					await editor.putExternalContent({
						type: 'files',
						files,
						point: editor.getViewportPageBounds().center,
						ignoreParent: false,
					})
				}

				return actions
			},
		},
	}

	useLayoutEffect(() => {
		setLoadingState({ status: 'loading' })

		// Get persisted data from local storage
		const persistedSnapshot = window.utools
			? window.preload.localConfig.getItem(PERSISTENCE_KEY)
			: localStorage.getItem(PERSISTENCE_KEY)

		if (persistedSnapshot) {
			try {
				const snapshot = JSON.parse(persistedSnapshot)
				loadSnapshot(store, snapshot)
				setLoadingState({ status: 'ready' })
			} catch (error: any) {
				setLoadingState({ status: 'error', error: error.message }) // Something went wrong
			}
		} else {
			setLoadingState({ status: 'ready' }) // Nothing persisted, continue with the empty store
		}

		// Each time the store changes, run the (debounced) persist function
		const cleanupFn = store.listen(
			throttle(() => {
				const snapshot = getSnapshot(store)

				window.utools
					? window.preload.localConfig.setItem(
							PERSISTENCE_KEY,
							JSON.stringify(snapshot),
						)
					: localStorage.setItem(PERSISTENCE_KEY, JSON.stringify(snapshot))
			}, 500),
		)

		return () => {
			cleanupFn()
		}
	}, [store])

	if (loadingState.status === 'loading') {
		return (
			<LoadingScreen>
				<DefaultSpinner />
			</LoadingScreen>
		)
	}

	if (loadingState.status === 'error') {
		return <ErrorScreen>{loadingState.error}</ErrorScreen>
	}

	return <Tldraw {...tldrawProps} />
}

export default App
