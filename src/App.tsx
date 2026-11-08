import { PointerLockControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { Disks } from './game/combat/Disks'
import { Effects } from './game/combat/Effects'
import { Drops } from './game/enemies/Drops'
import { Enemies } from './game/enemies/Enemies'
import { Projectiles } from './game/enemies/Projectiles'
import { Doors } from './game/level/Doors'
import { LEVELS } from './game/level/levels'
import { LevelMesh } from './game/level/LevelMesh'
import { Props } from './game/level/Props'
import { SlideDoors } from './game/level/SlideDoors'
import { Things } from './game/level/Things'
import { Player } from './game/player/Player'
import { pointerLock } from './game/player/pointerLock'
import { ViewmodelCanvas } from './game/player/ViewmodelCanvas'
import { Weapon } from './game/player/Weapon'
import { createLighting } from './game/render/lighting'
import { useGame } from './game/store'
import { Hud } from './ui/Hud'
import { Minimap } from './ui/Minimap'
import { TouchControls } from './ui/TouchControls'
import { isTouchDevice } from './game/player/input'
import { toggleFullscreen } from './game/fullscreen'
import { Patients } from './game/npcs/Patients'
import { AsylumLights } from './game/render/AsylumLights'
import { PostFX } from './game/render/PostFX'
import { fxSettings } from './game/combat/Effects'
import { setAsylumAmbience } from './game/audio'

/** Interne renderhoogte in pixels; het beeld wordt pixelig opgeschaald. */
const RENDER_HEIGHT = 300

function useRetroDpr() {
  const calc = () => Math.min(1, RENDER_HEIGHT / window.innerHeight)
  const [dpr, setDpr] = useState(calc)
  useEffect(() => {
    const onResize = () => setDpr(calc())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return dpr
}

export default function App() {
  const seed = useGame((s) => s.seed)
  const levelKind = useGame((s) => s.levelKind)
  const run = useGame((s) => s.run)
  const level = useMemo(() => LEVELS[levelKind].generate(seed), [levelKind, seed])
  const lighting = useMemo(() => createLighting(level), [level])
  const dpr = useRetroDpr()
  // het gesticht is niet retro: volle resolutie (op telefoons iets lager, voor de snelheid)
  const realistic = levelKind === 'asylum'
  const hdDpr = Math.min(window.devicePixelRatio || 1, isTouchDevice ? 1 : 1.5)
  fxSettings.particleScale = realistic ? 0.4 : 1

  // sfeergeluid in het gesticht, alleen tijdens het spelen
  useEffect(() => {
    const update = (s: ReturnType<typeof useGame.getState>) => setAsylumAmbience(s.levelKind === 'asylum' && s.locked && s.status === 'playing')
    update(useGame.getState())
    const unsub = useGame.subscribe(update)
    return () => {
      unsub()
      setAsylumAmbience(false)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const game = useGame.getState()
      if (e.code === 'KeyM') game.toggleMap()
      if (e.code === 'KeyF' && !e.repeat) void toggleFullscreen()
      if (e.code === 'KeyN') game.toggleNoclip()
      if (e.code === 'KeyG') game.newLevel()
      if (e.code === 'KeyR' && game.status !== 'playing') game.restart()
      if (e.code === 'Enter' && game.status === 'won') game.newLevel()
      if (e.code === 'Enter' && game.status === 'dead') game.restart()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <Canvas
        key={`${levelKind}-${seed}-${run}`}
        className={realistic ? 'game hd' : 'game'}
        dpr={realistic ? hdDpr : dpr}
        shadows={realistic}
        gl={{ antialias: false, powerPreference: 'high-performance' }}
        camera={{ fov: realistic ? 75 : 80, near: 0.05, far: 150 }}
      >
        <color attach="background" args={['#000000']} />
        {realistic ? (
          <>
            {/* gesticht: realistisch belicht, met een zaklamp, nevel en nabewerking */}
            <fogExp2 attach="fog" args={['#05080a', 0.05]} />
            <AsylumLights level={level} />
            <PostFX />
          </>
        ) : (
          <>
            <fog attach="fog" args={['#000000', 18, 75]} />
            {/* alleen voor de geanimeerde wezens (standard materials); de wereld is vooraf belicht */}
            <hemisphereLight args={['#c8c0b8', '#201810', 1.1]} />
            <directionalLight position={[0.4, 1, 0.3]} intensity={1.5} />
          </>
        )}
        <Suspense fallback={null}>
          <Physics gravity={[0, 0, 0]}>
            <LevelMesh level={level} lighting={lighting} />
            <Doors level={level} lighting={lighting} />
            <SlideDoors level={level} lighting={lighting} />
            <Props level={level} lighting={lighting} />
            <Player level={level} />
            <Enemies level={level} lighting={lighting} />
            <Patients level={level} lighting={lighting} />
            <Projectiles />
            <Weapon lighting={lighting} />
          </Physics>
          <Things level={level} lighting={lighting} />
          <Drops lighting={lighting} />
          <Disks lighting={lighting} />
          <Effects />
        </Suspense>
        {/* op touchscreens geen pointer lock: daar kijk je door te slepen */}
        {!isTouchDevice && (
          <PointerLockControls
            // niet bij elke klik vergrendelen: dat doet de SPELEN-knop (zie pointerLock.ts)
            selector="#no-auto-pointer-lock"
            ref={(c) => {
              if (c) pointerLock.lock = () => c.lock()
            }}
            onLock={() => useGame.getState().setLocked(true)}
            onUnlock={() => useGame.getState().setLocked(false)}
          />
        )}
      </Canvas>
      <ViewmodelCanvas />
      <Minimap level={level} />
      <Hud level={level} />
      {isTouchDevice && <TouchControls />}
    </>
  )
}
