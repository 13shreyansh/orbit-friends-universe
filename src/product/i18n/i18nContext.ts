import { createContext } from 'react'
import type { TranslationKey } from './messages'
import type { Locale, TranslationParameters } from './locale'

export interface I18nValue {
  locale: Locale
  isZh: boolean
  setLocale: (locale: Locale) => void
  toggleLocale: () => void
  t: (key: TranslationKey, parameters?: TranslationParameters) => string
}

export const I18nContext = createContext<I18nValue | null>(null)
