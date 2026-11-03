import { useEffect, useState } from 'react'

/**
 * Volledig scherm via de Fullscreen API (desktop, Android, iPad). Safari op een iPhone kent
 * geen fullscreen voor webpagina's; daar speel je zonder balken via "Zet op beginscherm"
 * (de manifest opent de game dan als losse app).
 */
type FsDocument = Document & { webkitFullscreenElement?: Element | null; webkitFullscreenEnabled?: boolean; webkitExitFullscreen?: () => Promise<void> }
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }

const doc = (typeof document !== 'undefined' ? document : null) as FsDocument | null

export const canFullscreen = !!doc && (doc.fullscreenEnabled || !!doc.webkitFullscreenEnabled)

export const isFullscreen = () => !!doc && !!(doc.fullscreenElement ?? doc.webkitFullscreenElement)

/** iPhone/iPod (ook als Safari zich als Mac voordoet is een iPhone herkenbaar aan touch + klein scherm) */
export const isIPhone = typeof navigator !== 'undefined' && /iPhone|iPod/.test(navigator.userAgent)

/** gestart vanaf het beginscherm (als app, zonder browserbalken) */
export const isStandalone =
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: fullscreen)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true)

export async function enterFullscreen() {
  if (!doc || isFullscreen()) return
  const el = doc.documentElement as FsElement
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' })
    else await el.webkitRequestFullscreen?.()
  } catch {
    // geweigerd of niet ondersteund
  }
}

export async function exitFullscreen() {
  if (!doc || !isFullscreen()) return
  try {
    if (doc.exitFullscreen) await doc.exitFullscreen()
    else await doc.webkitExitFullscreen?.()
  } catch {
    // al uit fullscreen
  }
}

/** Moet vanuit een klik, tik of toets aangeroepen worden (browsers eisen een gebruikersactie). */
export function toggleFullscreen() {
  return isFullscreen() ? exitFullscreen() : enterFullscreen()
}

export function useFullscreen() {
  const [on, setOn] = useState(isFullscreen)
  useEffect(() => {
    const update = () => setOn(isFullscreen())
    document.addEventListener('fullscreenchange', update)
    document.addEventListener('webkitfullscreenchange', update)
    return () => {
      document.removeEventListener('fullscreenchange', update)
      document.removeEventListener('webkitfullscreenchange', update)
    }
  }, [])
  return on
}
