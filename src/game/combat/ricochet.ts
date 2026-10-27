/**
 * Bepaalt bij welke missers (kogel in muur, vloer of plafond) een ricochet te horen is.
 * Gemiddeld bij één op de drie, maar niet in een vast ritme: na elke ricochet wordt het
 * aantal missers tot de volgende opnieuw geloot (1 t/m 6, gemiddeld ~3). Zo komen er af en
 * toe twee vlak na elkaar en soms een tijdje geen, maar nooit heel lang niets.
 */
const GAP_WEIGHTS = [0.12, 0.24, 0.28, 0.2, 0.1, 0.06] // kans op een afstand van 1, 2, ... 6 missers

export function createRicochetPicker(random: () => number = Math.random) {
  const drawGap = () => {
    let r = random()
    for (let i = 0; i < GAP_WEIGHTS.length; i++) {
      r -= GAP_WEIGHTS[i]
      if (r < 0) return i + 1
    }
    return GAP_WEIGHTS.length
  }
  let left = drawGap()
  /** aanroepen bij elke misser; true = deze misser ketst hoorbaar af */
  return () => {
    left--
    if (left > 0) return false
    left = drawGap()
    return true
  }
}

/** gedeeld door het pistool en het aanvalsgeweer */
export const ricochetOnMiss = createRicochetPicker()
