const languages = window.navigator.languages

const sortedLanguages = languages.some((language) => language.startsWith('zh'))
	? [...languages].sort((a) => (a.startsWith('zh') ? -1 : 1))
	: ['zh-CN', ...languages]

Object.defineProperty(window.navigator, 'languages', {
	get() {
		return sortedLanguages
	},
})
