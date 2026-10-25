/** Ключи OAuth-приложений облаков: из .env при разработке, из секретов GitHub в сборке релиза */
interface ImportMetaEnv {
  readonly MAIN_VITE_YANDEX_CLIENT_ID?: string
  readonly MAIN_VITE_YANDEX_CLIENT_SECRET?: string
  readonly MAIN_VITE_GOOGLE_CLIENT_ID?: string
  readonly MAIN_VITE_GOOGLE_CLIENT_SECRET?: string
}
