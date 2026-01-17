interface OpenFileOption {
	title?: string
	defaultPath?: string
	buttonLabel?: string
	filters?: { name: string; extensions: string[] }[]
	properties?: Array<
		| 'openFile'
		| 'openDirectory'
		| 'multiSelections'
		| 'showHiddenFiles'
		| 'createDirectory'
		| 'promptToCreate'
		| 'noResolveAliases'
		| 'treatPackageAsDirectory'
		| 'dontAddToRecent'
	>
	message?: string
	securityScopedBookmarks?: boolean
}

interface Window {
	preload: {
		/**
		 * 本地配置存储接口，用于持久化存储本地配置信息
		 * 类似于 localStorage，但数据存储在本地文件系统中
		 */
		localConfig: Storage
		/**
		 * 打开一个文件，并返回File对象
		 * @param options 参数
		 * @return 返回File对象
		 */
		openFile(options: OpenFileOption): Promise<File>
		/**
		 * 打开多个文件，并返回File对象数组
		 * @param options 对话框选项
		 * @returns 返回File对象数组
		 */
		openFiles(options: OpenFileOption): Promise<File[]>
		/**
		 * 从url下载一个文件到指定目录
		 * @param url 链接
		 * @param path 要保存的文件路径，包含文件名
		 */
		downloadFileFromUrl(url: string, path: string): Promise<void>
		/**
		 * 下载一个文件
		 * @param data 文件内容，可以使blob(file)或ArrayBuffer或者链接或者DATA URL
		 * @param name 文件名
		 * @return 文件保存的路径
		 */
		downloadFile(
			data: string | Blob | ArrayBuffer,
			name: string,
		): Promise<string>
	}
}
