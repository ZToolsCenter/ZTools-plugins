import React from 'react'
import ReactDOM from 'react-dom/client'
import './prioritizeChineseLanguage'
import './overrideLocalStroage'

import './index.css'

const container = document.getElementById('root')

if (container) {
	const App = React.lazy(() => import('./App'))

	ReactDOM.createRoot(container).render(
		<React.StrictMode>
			<App />
		</React.StrictMode>,
	)
}
