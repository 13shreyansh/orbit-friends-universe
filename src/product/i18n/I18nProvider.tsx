import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { I18nContext, type I18nValue } from './i18nContext'
import { getInitialLocale, LOCALE_STORAGE_KEY, translate, type Locale } from './locale'

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale)

  useEffect(() => {
    document.documentElement.lang = locale
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  }, [locale])

  const value = useMemo<I18nValue>(() => ({
    locale,
    isZh: locale === 'zh-CN',
    setLocale: setLocaleState,
    toggleLocale: () => setLocaleState((current) => current === 'en' ? 'zh-CN' : 'en'),
    t: (key, parameters) => translate(locale, key, parameters),
  }), [locale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
