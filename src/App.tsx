import { ErrorBoundary } from './components/ErrorBoundary'
import { ProductApp } from './product/ProductApp'
import { I18nProvider } from './product/i18n'
import { useState } from 'react'
import { FriendsDemo } from './FriendsDemo'

function App() {
  const [entered, setEntered] = useState(false)
  return (
    <I18nProvider>
      <ErrorBoundary>
        {entered ? <ProductApp /> : <FriendsDemo onEnter={() => setEntered(true)} />}
      </ErrorBoundary>
    </I18nProvider>
  )
}

export default App
