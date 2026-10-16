# Retro Shooter

Een Doom/Quake-achtige retro shooter in **echte 3D**, gebouwd met Vite + React + TypeScript,
three.js (via React Three Fiber) en Rapier physics. Levels worden procedureel gegenereerd uit een seed.

| Tech-basis | Brick-zaal met dais | Hell-exitkamer met nukage |
|---|---|---|
| ![tech](docs/tech.png) | ![brick](docs/brick.png) | ![hell](docs/hell.png) |

## Starten

```bash
npm install
npm run dev      # http://localhost:5173  (?seed=phobos-1234 voor een vast level)
npm test         # generator-tests (determinisme + speelbaarheid over 150 seeds)
npm run build
```

**Besturing:** WASD/pijltjes lopen · muis kijken · klik schieten · spatie springen (ingedrukt houden = bunnyhop) ·
M kaart · N noclip · G nieuw level · Esc pauze.

**Doel:** vind de rode sleutel, open de rode deur en bereik de EXIT.

## Wat er nu is

- **Procedurele levelgenerator** (`src/game/level/generate.ts`)
  - kamers + minimum spanning tree + extra lussen (Doom-achtige rondjes)
  - hoogteverschillen: elke kamer een eigen vloerniveau, gangen worden automatisch trappen
  - features: pilaren, verhoogde platforms (dais), nukage-putten, hoge zaalplafonds
  - thema's op basis van diepte: tech-basis → brick → hell
  - start, sleutel en exit op bladeren van de boom; de exitkamer zit achter rode deuren
  - elk level wordt gevalideerd (bereikbaarheid met/zonder sleutel); anders opnieuw proberen
- **Gebakken vertex-belichting** met line-of-sight per lamp (geen licht door muren) en Doom-achtige lichtniveaus
- **Procedurele pixel-art textures** (64×64, posterized, `NearestFilter`), allemaal op een canvas getekend
- **Quake-achtige movement**: grondwrijving, acceleratie, air strafing en bunnyhop, met een vaste tijdstap van 120 Hz
  en Rapier character controller (autostep voor trappen)
- Low-res rendering (300px hoog, pixelig opgeschaald) + fog
- Low-poly placeholder-vijanden (grunt, imp, demon), pickups, sleutel, deuren, exit, HUD, automap
- Gesynthetiseerde geluidseffecten (WebAudio), dus geen audiobestanden nodig

## Architectuur

```
src/
  game/
    level/    generator, validatie, level-mesh, deuren, things
    player/   input, movement (Quake-fysica), Player-controller, wapen-viewmodel
    render/   textures, belichting, geometrie-builder, low-poly modellen
    store.ts  zustand: HUD/game-state (+ mutable `player` voor per-frame data)
    audio.ts  gesynthetiseerde SFX
  ui/         HUD en minimap (DOM over de canvas)
```

Belangrijkste regel: **geen React-state in de game loop.** Per-frame logica draait in `useFrame` en muteert
refs/objecten; React-state alleen voor HUD/menu's.

In dev-modus zijn `window.__level`, `window.__player` en `window.__teleport(x, y, z, yaw, pitch)` beschikbaar
om gegenereerde levels te inspecteren.

## Volgende stappen

1. Schieten met hitscan-raycasts + vijanden die schade krijgen en doodgaan
2. Vijand-AI (idle → chase → attack → pain → dead) met line-of-sight en grid-pathfinding
3. Projectielen (imp-fireballs) en meer wapens (chaingun, rocket launcher)
4. Echte low-poly modellen (glTF) en samples in plaats van de placeholders
5. Meer generator-variatie: liften, secrets, ramen tussen kamers, buitenruimtes met lucht
