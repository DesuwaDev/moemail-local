import {getRequestConfig} from 'next-intl/server'
import {i18n, type Locale} from '@/i18n/config'
import {emptyMessages, loadMessages} from '@/i18n/messages'

export default getRequestConfig(async ({locale}) => {
  const safeLocale = (i18n.locales.includes(locale as Locale) ? locale : i18n.defaultLocale) as Locale
  try {
    return {locale: safeLocale, timeZone: "UTC", messages: await loadMessages(safeLocale)}
  } catch {
    return {locale: safeLocale, timeZone: "UTC", messages: emptyMessages()}
  }
})

