if (window.utools) {
	Object.defineProperty(window, 'localStorage', {
		value: window.utools.dbStorage,
	})
}
