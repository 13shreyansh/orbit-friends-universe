import { en, type TranslationKey, zhCN } from './messages'

export type Locale = 'en' | 'zh-CN'
export type TranslationParameters = Record<string, string | number>

export const LOCALE_STORAGE_KEY = 'social-cosmos-locale'

export function getInitialLocale(): Locale {
  return 'en'
}

export function getStoredLocale(): Locale {
  return 'en'
}

export function translate(locale: Locale, key: TranslationKey, parameters?: TranslationParameters) {
  const message = (locale === 'zh-CN' ? zhCN[key] : en[key]) ?? en[key]
  if (!parameters) return message
  return message.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(parameters[name] ?? ''))
}
