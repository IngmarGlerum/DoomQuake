import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { Level } from '../level/types'
import { flashlight } from '../player/flashlight'
import { player } from '../store'

/** Aantal echte lampen tegelijk; vast, zodat de shaders niet steeds opnieuw gecompileerd worden. */
const POOL = 8

/**
 * Echte (dynamische) verlichting voor de realistische weergave:
 * - een zaklamp aan de camera, met zachte schaduwen
 * - een vaste set puntlampen die steeds naar de dichtstbijzijnde lichtbronnen van het level springen,
 *   voor glans en reliëf; sommige tl-buizen flikkeren
 * - een zwakke omgeving voor reflecties op tegels en metaal
 */
export function AsylumLights({ level }: { level: Level }) {
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)
  const gl = useThree((s) => s.gl)
  const spot = useRef<THREE.SpotLight>(null)
  const pool = useRef<(THREE.PointLight | null)[]>([])
  const timer = useRef(0)
  const assigned = useRef<number[]>([])
  const lights = level.lights

  // flikkerende lampen: vast per lamp (hash van de positie)
  const flicker = useMemo(() => lights.map((l) => (Math.abs(Math.sin(l.x * 12.9 + l.z * 78.2)) * 43758.5) % 1 < 0.18), [lights])

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = env
    scene.environmentIntensity = 0.35
    return () => {
      scene.environment = null
      env.dispose()
      pmrem.dispose()
    }
  }, [gl, scene])

  // de zaklamp hangt aan de camera; zijn doelpunt ook
  useEffect(() => {
    const s = spot.current
    if (!s) return
    camera.add(s)
    camera.add(s.target)
    s.position.set(0.18, -0.15, 0.05)
    s.target.position.set(0, -0.05, -6)
    scene.add(camera)
    return () => {
      camera.remove(s)
      camera.remove(s.target)
    }
  }, [camera, scene])

  useFrame(({ clock }, delta) => {
    const s = spot.current
    if (s) {
      // licht nadeinend: de bundel trilt een heel klein beetje mee met lopen
      s.intensity = flashlight.on ? 8 + Math.sin(clock.elapsedTime * 31) * 0.1 : 0
      s.castShadow = flashlight.on
    }
    timer.current -= delta
    if (timer.current <= 0) {
      timer.current = 0.3
      // dichtstbijzijnde lampen kiezen
      const order = lights
        .map((l, i) => ({ i, d: (l.x - player.position.x) ** 2 + (l.y - player.position.y - 1.5) ** 2 + (l.z - player.position.z) ** 2 }))
        .sort((a, b) => a.d - b.d)
        .slice(0, POOL)
      assigned.current = order.map((o) => o.i)
    }
    const t = clock.elapsedTime
    pool.current.forEach((p, k) => {
      if (!p) return
      const i = assigned.current[k]
      const l = i === undefined ? null : lights[i]
      if (!l) {
        p.intensity = 0
        return
      }
      // iets onder de armatuur, zodat het plafond er niet wit van uitslaat
      p.position.set(l.x, l.y - 0.7, l.z)
      p.color.setRGB(l.color[0], l.color[1], l.color[2])
      p.distance = l.radius * 1.3
      let k2 = 1
      if (flicker[i]) {
        // tl-buis die hapert: meestal aan, af en toe snel uit en aan
        const n = Math.sin(t * 13 + i) * Math.sin(t * 7.3 + i * 3) * Math.sin(t * 2.1 + i)
        k2 = n > 0.55 ? 0.05 : n > 0.4 ? 0.5 : 1
      }
      p.intensity = 4 * k2
    })
  })

  return (
    <>
      <spotLight
        ref={spot}
        color={0xfff2dc}
        intensity={8}
        distance={28}
        angle={0.42}
        penumbra={0.55}
        decay={2}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-camera-near={0.2}
        shadow-camera-far={28}
      />
      {Array.from({ length: POOL }, (_, k) => (
        <pointLight key={k} ref={(el) => void (pool.current[k] = el)} intensity={0} decay={2} distance={10} />
      ))}
    </>
  )
}
