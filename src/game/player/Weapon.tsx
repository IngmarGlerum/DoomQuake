import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { sfx } from '../audio'
import { fx } from '../combat/Effects'
import { spawnDisk } from '../combat/Disks'
import { ROCKET_EXPLOSION, explode } from '../combat/explosions'
import { raycast, runtime } from '../combat/runtime'
import { WEAPONS, type AmmoType, type WeaponDef, type WeaponId } from '../combat/weapons'
import { damageEnemy } from '../enemies/damage'
import { spawnRocket } from '../enemies/Projectiles'
import type { Lighting, RGB } from '../render/lighting'
import { diskSeat } from '../render/models'
import { player, useGame } from '../store'
import { fireButton } from './input'
import { vm } from './viewmodel'

/** hoeveel de camera omhoog schopt per schot */
const VIEW_PUNCH: Record<WeaponId, number> = { pistol: 0.014, shotgun: 0.03, machinegun: 0.005, rocket: 0.04, disk: 0.012 }
const SWITCH_TIME = 0.16
const AMMO_NAME: Record<AmmoType, string> = { bullets: 'kogels', shells: 'shells', rockets: 'raketten', disks: 'disks' }
const MAX_RANGE = 120

const rand = (a: number, b: number) => a + Math.random() * (b - a)

/** Tijdlijn van de disk-animatie (seconden na het schot). */
const DISK_FLY = 0.07
const DISK_RELOAD_START = 0.25
const DISK_RELOAD_END = 0.62

/**
 * Wapen-viewmodel + vuren. Hitscan via een raycast vanuit de camera; het lichtspoor
 * loopt van de loop naar het inslagpunt.
 */
export function Weapon({ lighting }: { lighting: Lighting }) {
  const camera = useThree((s) => s.camera)
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
    /** tijd sinds het laatste disk-schot (groot = schijf ligt klaar) */
    diskT: 99,
    diskSlid: true,
    diskClicked: true,
    /** tijd sinds het laatste pistoolschot (slede-animatie) */
    slideT: 99,
  })
  if (import.meta.env.DEV) Object.assign(window, { __weapon: { state: state.current, vm } })
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
    const local = def.id === 'pistol' ? vm.pistolMuzzle : def.id === 'machinegun' ? vm.rifleMuzzle : t.muzzle.set(...def.muzzle)
    const muzzle = camera.localToWorld(t.muzzle.copy(local))
    runtime.lastShot = { x: camera.position.x, z: camera.position.z, time: performance.now() }

    sfx[def.id]()
    if (def.id === 'disk') {
      fx.flash(muzzle, 0.8, [1.4, 1.6, 2], 0.05)
    } else {
      fx.flash(muzzle, def.id === 'shotgun' || def.id === 'rocket' ? 1.7 : 1.1, [2, 1.6, 0.7], def.id === 'rocket' ? 0.09 : 0.05)
      fx.muzzleSmoke(muzzle, t.forward)
    }

    if (def.id === 'disk') {
      fireDisk(def, muzzle, t.forward)
    } else if (def.projectile) {
      fireRocket(def, muzzle, t.forward)
    } else {
      fireHitscan(def, muzzle, t)
    }

    const s = state.current
    s.kick = def.kick
    s.flash = 0.05
    if (def.id === 'pistol') s.slideT = 0
    if (def.id === 'machinegun') {
      vm.rifleShots++
      vm.rifleT = 0
    }
    camera.rotation.x = Math.min(Math.PI / 2, camera.rotation.x + VIEW_PUNCH[def.id] * rand(0.7, 1.2))
    camera.rotation.y += rand(-0.3, 0.3) * VIEW_PUNCH[def.id]
  }

  /** Raket richting het punt onder het vizier; tegen een muur aan ontploft hij meteen. */
  const fireRocket = (def: WeaponDef, muzzle: THREE.Vector3, forward: THREE.Vector3) => {
    const aim = raycast(camera.position, forward, MAX_RANGE)
    const target = aim ? aim.point : camera.position.clone().addScaledVector(forward, MAX_RANGE)
    // zit er een muur tussen camera en loop, of staat het doel vlak voor je neus?
    const toMuzzle = muzzle.clone().sub(camera.position)
    const blocked = raycast(camera.position, toMuzzle.clone().normalize(), toMuzzle.length(), { ignoreEnemies: true })
    if (blocked || (aim && aim.distance < 1.4)) {
      const at = blocked ? blocked.point.addScaledVector(blocked.normal, 0.2) : aim!.point.addScaledVector(aim!.normal, 0.25)
      if (aim?.enemy) damageEnemy(aim.enemy, Math.round(rand(...def.damage)), aim.point, forward)
      explode(at, ROCKET_EXPLOSION)
      return
    }
    spawnRocket(muzzle, target, Math.round(rand(...def.damage)))
  }

  /** Disk richting het punt onder het vizier; hij stuitert verder in Disks.tsx. */
  const fireDisk = (def: WeaponDef, muzzle: THREE.Vector3, forward: THREE.Vector3) => {
    const aim = raycast(camera.position, forward, MAX_RANGE, { ignoreEnemies: true })
    const toMuzzle = muzzle.clone().sub(camera.position)
    const blocked = raycast(camera.position, toMuzzle.clone().normalize(), toMuzzle.length(), { ignoreEnemies: true })
    if (blocked || (aim && aim.distance < 1.2)) {
      // te dicht op een muur: lanceer vanuit de camera zelf
      spawnDisk(camera.position, forward, def.damage)
    } else {
      const target = aim ? aim.point : camera.position.clone().addScaledVector(forward, MAX_RANGE)
      spawnDisk(muzzle, target.sub(muzzle).normalize(), def.damage)
    }
    const s = state.current
    s.diskT = 0
    s.diskSlid = false
    s.diskClicked = false
  }

  const fireHitscan = (def: WeaponDef, muzzle: THREE.Vector3, t: typeof tmp.current) => {
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
  }

  useFrame((_, delta) => {
    const s = state.current
    const game = useGame.getState()

    // wisselen: zak weg, verwissel model, kom weer omhoog
    const wanted = game.weapon
    if (wanted !== s.shown) {
      s.lower = Math.min(1, s.lower + delta / SWITCH_TIME)
      if (s.lower >= 1) {
        s.shown = wanted
        // na het wisselen ligt er (als er munitie is) meteen een schijf klaar
        s.diskT = 99
        s.diskSlid = s.diskClicked = true
      }
    } else {
      s.lower = Math.max(0, s.lower - delta / SWITCH_TIME)
    }
    const def = WEAPONS[s.shown]
    vm.weapon = s.shown

    s.cooldown = Math.max(0, s.cooldown - delta)
    const ready = game.locked && game.status === 'playing' && wanted === s.shown && s.lower < 0.2
    const pressed = s.pressed || fireButton.pressed
    const held = s.held || fireButton.held
    if (ready && s.cooldown <= 0 && (pressed || (held && def.auto))) {
      s.pressed = false
      fireButton.pressed = false
      if (game.useAmmo()) {
        fire(def)
        s.cooldown = def.cooldown
      } else {
        sfx.click()
        s.cooldown = 0.35
        game.say(`Geen ${AMMO_NAME[def.ammo]} meer voor de ${def.name}`)
      }
    }
    if (!game.locked) s.pressed = fireButton.pressed = false

    s.kick = Math.max(0, s.kick - delta * (def.auto ? 14 : 4))
    s.flash = Math.max(0, s.flash - delta)
    if (player.grounded) s.bob += delta * player.speed * 0.9
    const bobAmount = Math.min(player.speed / 10, 1)

    vm.pos.set(
      0.22 + Math.cos(s.bob) * 0.025 * bobAmount,
      -0.24 + Math.abs(Math.sin(s.bob)) * 0.02 * bobAmount + s.kick * 0.03 - s.lower * 0.45,
      -0.35 + s.kick * 0.1,
    )
    vm.rotX = s.kick * 0.3
    vm.flash = s.flash
    vm.flashPos.set(def.muzzle[0], def.muzzle[1], def.muzzle[2])

    // pistool: slede schiet naar achteren en veert terug
    s.slideT += delta
    vm.rifleT += delta
    vm.recoil = s.slideT < 0.035 ? s.slideT / 0.035 : Math.max(0, 1 - (s.slideT - 0.035) / 0.09)

    lighting.sample(camera.position.x, camera.position.y, camera.position.z, undefined, light.current)
    const c = light.current
    vm.light.setRGB(c[0], c[1], c[2])
    const boost = s.flash > 0 ? 1.2 : 0
    vm.tint.setRGB(Math.min(1.4, c[0] + 0.15 + boost), Math.min(1.4, c[1] + 0.15 + boost), Math.min(1.4, c[2] + 0.15 + boost))

    // disk launcher: schijf vliegt weg, launcher is even leeg, nieuwe schijf schuift van onder in beeld
    vm.disk.visible = false
    if (def.id === 'disk') {
      s.diskT += delta
      const t = s.diskT
      const hasAmmo = game.ammo.disks > 0
      const [sx, sy, sz] = diskSeat
      vm.disk.rot.set(0, 0, 0)
      if (t < DISK_FLY) {
        // wegvliegen: snel naar voren
        const k = t / DISK_FLY
        vm.disk.visible = true
        vm.disk.pos.set(sx, sy + k * 0.05, sz - k * 0.9)
        vm.disk.rot.y = t * 60
      } else if (t >= DISK_RELOAD_START && hasAmmo) {
        if (!s.diskSlid) {
          s.diskSlid = true
          sfx.diskSlide()
        }
        // van onder het scherm omhoog naar de slede, met een ease-out
        const k = Math.min(1, (t - DISK_RELOAD_START) / (DISK_RELOAD_END - DISK_RELOAD_START))
        const e = 1 - (1 - k) ** 3
        vm.disk.visible = true
        vm.disk.pos.set(sx + (1 - e) * 0.05, sy - (1 - e) * 0.6, sz + (1 - e) * 0.12)
        vm.disk.rot.set((1 - e) * 0.6, (1 - e) * 4, 0)
        if (k >= 1 && !s.diskClicked) {
          s.diskClicked = true
          sfx.diskClick()
          s.kick = Math.max(s.kick, 0.15)
        }
      }
    }
  })

  return null
}
