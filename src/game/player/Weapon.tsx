import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { sfx } from '../audio'
import { fx } from '../combat/Effects'
import { raycast, runtime } from '../combat/runtime'
import { WEAPONS, type WeaponDef, type WeaponId } from '../combat/weapons'
import { damageEnemy } from '../enemies/Enemies'
import type { Lighting, RGB } from '../render/lighting'
import { machinegunGeometry, pistolGeometry, shotgunGeometry } from '../render/models'
import { player, useGame } from '../store'

const GEOMETRY: Record<WeaponId, () => THREE.BufferGeometry> = {
  pistol: pistolGeometry,
  shotgun: shotgunGeometry,
  machinegun: machinegunGeometry,
}
/** hoeveel de camera omhoog schopt per schot */
const VIEW_PUNCH: Record<WeaponId, number> = { pistol: 0.014, shotgun: 0.03, machinegun: 0.005 }
const SWITCH_TIME = 0.16
const MAX_RANGE = 120

const rand = (a: number, b: number) => a + Math.random() * (b - a)

/**
 * Wapen-viewmodel + vuren. Hitscan via een raycast vanuit de camera; het lichtspoor
 * loopt van de loop naar het inslagpunt.
 */
export function Weapon({ lighting }: { lighting: Lighting }) {
  const camera = useThree((s) => s.camera)
  const group = useRef<THREE.Group>(null)
  const gun = useRef<THREE.Mesh>(null)
  const flash = useRef<THREE.Mesh>(null)
  const state = useRef({
    kick: 0,
    flash: 0,
    cooldown: 0,
    bob: 0,
    held: false,
    pressed: false,
    /** wapen dat nu in beeld is */
    shown: useGame.getState().weapon,
    /** 0 = omhoog, 1 = helemaal weggezakt */
    lower: 0,
  })
  const light = useRef<RGB>([0, 0, 0])

  useEffect(() => {
    const s = state.current
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0 || !useGame.getState().locked) return
      s.held = true
      s.pressed = true
    }
    const onUp = (e: MouseEvent) => {
      if (e.button === 0) s.held = false
    }
    const select = (i: number) => {
      if (useGame.getState().selectWeapon(i)) sfx.weaponSwitch()
    }
    const onKey = (e: KeyboardEvent) => {
      const slot = WEAPONS.findIndex((w) => e.code === `Digit${w.slot}` || e.code === `Numpad${w.slot}`)
      if (slot >= 0) select(slot)
    }
    const onWheel = (e: WheelEvent) => {
      if (!useGame.getState().locked) return
      const n = WEAPONS.length
      select((useGame.getState().weapon + (e.deltaY > 0 ? 1 : -1) + n) % n)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onWheel)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onWheel)
    }
  }, [])

  const tmp = useRef({ forward: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(), dir: new THREE.Vector3(), muzzle: new THREE.Vector3() })

  const fire = (def: WeaponDef) => {
    const t = tmp.current
    camera.getWorldDirection(t.forward)
    t.right.setFromMatrixColumn(camera.matrixWorld, 0)
    t.up.setFromMatrixColumn(camera.matrixWorld, 1)
    const muzzle = camera.localToWorld(t.muzzle.set(...def.muzzle))
    runtime.lastShot = { x: camera.position.x, z: camera.position.z, time: performance.now() }

    sfx[def.id]()
    fx.flash(muzzle, def.id === 'shotgun' ? 1.6 : 1.1, [2, 1.6, 0.7], 0.05)
    fx.muzzleSmoke(muzzle, t.forward)

    let fleshSounds = 0
    let wallSounds = 0
    for (let i = 0; i < def.pellets; i++) {
      // willekeurig punt in een cirkel → gelijkmatige kegel
      const a = Math.random() * Math.PI * 2
      const r = Math.sqrt(Math.random()) * def.spread
      t.dir
        .copy(t.forward)
        .addScaledVector(t.right, Math.cos(a) * r)
        .addScaledVector(t.up, Math.sin(a) * r)
        .normalize()
      const hit = raycast(camera.position, t.dir, MAX_RANGE)
      const end = hit ? hit.point : camera.position.clone().addScaledVector(t.dir, MAX_RANGE)
      fx.tracer(muzzle, end, def.tracer)
      if (!hit) continue
      if (hit.enemy) {
        damageEnemy(hit.enemy, Math.round(rand(...def.damage)), hit.point, t.dir)
        if (fleshSounds++ < 2) sfx.flesh(hit.point)
      } else {
        fx.wallImpact(hit.point, hit.normal, hit.collider.parent()?.isFixed() ?? true)
        if (wallSounds++ < 2) sfx.ricochet(hit.point)
      }
    }

    const s = state.current
    s.kick = def.kick
    s.flash = 0.05
    camera.rotation.x = Math.min(Math.PI / 2, camera.rotation.x + VIEW_PUNCH[def.id] * rand(0.7, 1.2))
    camera.rotation.y += rand(-0.3, 0.3) * VIEW_PUNCH[def.id]
  }

  useFrame((_, delta) => {
    const g = group.current
    const m = gun.current
    if (!g || !m || !flash.current) return
    const s = state.current
    const game = useGame.getState()

    // wisselen: zak weg, verwissel model, kom weer omhoog
    const wanted = game.weapon
    if (wanted !== s.shown) {
      s.lower = Math.min(1, s.lower + delta / SWITCH_TIME)
      if (s.lower >= 1) s.shown = wanted
    } else {
      s.lower = Math.max(0, s.lower - delta / SWITCH_TIME)
    }
    const def = WEAPONS[s.shown]
    const geometry = GEOMETRY[def.id]()
    if (m.geometry !== geometry) m.geometry = geometry

    s.cooldown = Math.max(0, s.cooldown - delta)
    const ready = game.locked && game.status === 'playing' && wanted === s.shown && s.lower < 0.2
    if (ready && s.cooldown <= 0 && (s.pressed || (s.held && def.auto))) {
      s.pressed = false
      if (game.useAmmo()) {
        fire(def)
        s.cooldown = def.cooldown
      } else {
        sfx.click()
        s.cooldown = 0.35
        game.say(`Geen ${def.ammo === 'shells' ? 'shells' : 'kogels'} meer voor de ${def.name}`)
      }
    }
    if (!game.locked) s.pressed = false

    s.kick = Math.max(0, s.kick - delta * (def.auto ? 14 : 4))
    s.flash = Math.max(0, s.flash - delta)
    if (player.grounded) s.bob += delta * player.speed * 0.9
    const bobAmount = Math.min(player.speed / 10, 1)

    g.position.copy(camera.position)
    g.quaternion.copy(camera.quaternion)
    m.position.set(
      0.22 + Math.cos(s.bob) * 0.025 * bobAmount,
      -0.24 + Math.abs(Math.sin(s.bob)) * 0.02 * bobAmount + s.kick * 0.03 - s.lower * 0.45,
      -0.35 + s.kick * 0.1,
    )
    m.rotation.x = s.kick * 0.3
    flash.current.visible = s.flash > 0
    flash.current.position.set(def.muzzle[0], def.muzzle[1], def.muzzle[2])
    flash.current.rotation.z = Math.random() * Math.PI

    lighting.sample(camera.position.x, camera.position.y, camera.position.z, undefined, light.current)
    const boost = s.flash > 0 ? 1.2 : 0
    const c = light.current
    ;(m.material as THREE.MeshBasicMaterial).color.setRGB(
      Math.min(1.4, c[0] + 0.15 + boost),
      Math.min(1.4, c[1] + 0.15 + boost),
      Math.min(1.4, c[2] + 0.15 + boost),
    )
  })

  return (
    <group ref={group}>
      <mesh ref={gun} geometry={GEOMETRY[WEAPONS[state.current.shown].id]()} renderOrder={10}>
        <meshBasicMaterial vertexColors depthTest={false} fog={false} />
      </mesh>
      <mesh ref={flash} renderOrder={11} visible={false}>
        <octahedronGeometry args={[0.12, 0]} />
        <meshBasicMaterial color={[2, 1.6, 0.5]} depthTest={false} fog={false} />
      </mesh>
    </group>
  )
}
