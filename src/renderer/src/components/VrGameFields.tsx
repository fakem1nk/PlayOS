import { OC_DEFAULTS, type GameDraft, type GameVr, type OcSettings } from '@shared/types'
import { play } from '../lib/sound'
import { ActionRow, Cycler, Toggle } from './Controls'
import { t } from '@shared/i18n'

// Шаг 10% — удобно листать геймпадом; 100% — родное разрешение игры
const CLARITY = [50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 170, 200].map((v) => ({ id: String(v / 100), label: `${v}%` }))

/** VR в редакторе PC-игры: переключатель «VR-игра» и несколько понятных настроек. Рантайм PlayOS готовит сам при запуске */
export function VrGameFields({ draft, set }: { draft: GameDraft; set: (patch: Partial<GameDraft>) => void }) {
  const vr = draft.vr
  const setVr = (patch: Partial<GameVr>) => set({ vr: { ...vr, ...patch } })
  const oc = { ...OC_DEFAULTS, ...vr?.oc }
  const setOc = (patch: Partial<OcSettings>) => setVr({ oc: { ...oc, ...patch } })
  // OpenXR- и Oculus-игры идут в шлем напрямую: настраивать для них нечего
  const tunable = vr && (!vr.apis || vr.apis.includes('openvr'))

  return (
    <>
      <Toggle
        label={t('VR-игра')}
        hint={t('Запуск в шлеме: PlayOS сам всё подготовит')}
        value={!!vr}
        onChange={(v) => set({ vr: v ? {} : undefined })}
      />
      {tunable && (
        <>
          {vr.crash && !vr.compat && (
            <ActionRow
              label={t('Игра не запустилась в прошлый раз')}
              hint={t('Попробуйте режим совместимости')}
              button={t('Включить')}
              onClick={() => {
                play('select')
                setVr({ compat: true, crash: undefined })
              }}
            />
          )}
          {!vr.compat && (
            <>
              <Cycler
                label={t('Чёткость')}
                hint={t('Выше — чётче картинка, но больше нагрузка на видеокарту')}
                value={String(oc.supersampleRatio)}
                options={CLARITY}
                onChange={(v) => setOc({ supersampleRatio: Number(v) })}
              />
              <Toggle
                label={t('Показывать руки')}
                hint={t('Выключите, если в игре есть свои руки')}
                value={oc.renderCustomHands}
                onChange={(v) => setOc({ renderCustomHands: v })}
              />
              <Toggle label={t('Вибрация контроллеров')} value={oc.haptics} onChange={(v) => setOc({ haptics: v })} />
            </>
          )}
          <Toggle
            label={t('Режим совместимости')}
            hint={t('Для игр, которые не запускаются в обычном режиме. Нужен установленный SteamVR')}
            value={!!vr.compat}
            onChange={(v) => setVr({ compat: v || undefined, crash: undefined })}
          />
        </>
      )}
    </>
  )
}
