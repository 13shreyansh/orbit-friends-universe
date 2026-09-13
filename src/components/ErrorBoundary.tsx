import { Component, type ReactNode } from 'react'
import styles from './ErrorBoundary.module.css'
import { getStoredLocale, translate } from '../product/i18n'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

/** Catches render-time errors anywhere below it (including inside the R3F
 * scene graph) and swaps in a calm, on-brand fallback instead of letting
 * React unmount the whole tree to a blank black page. There is no
 * automatic recovery — a bad render can leave Three.js/WebGL state
 * inconsistent — so the fallback's only action is a full reload. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.error('Social Cosmos crashed:', error)
  }

  render() {
    if (this.state.hasError) {
      const locale = getStoredLocale()
      return (
        <div className={styles.wrapper}>
          <div className={styles.glow} />
          <p className={styles.title}>{translate(locale, 'error.title')}</p>
          <p className={styles.subtitle}>{translate(locale, 'error.subtitle')}</p>
          <button type="button" className={styles.button} onClick={() => window.location.reload()}>
            {translate(locale, 'error.reconnect')}
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
