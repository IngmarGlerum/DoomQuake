import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { sfx } from '../audio'
import { WEAPONS, type WeaponId } from '../combat/weapons'
import { RIFLE_SCALE, buildRifle, casingGeometry, casingMaterial, flashTextures } from '../render/arx160'
import { BERETTA_SCALE, buildBeretta } from '../render/beretta'
import { diskLauncherBodyGeometry, viewDiskGeometry, weaponGeometry } from '../render/models'
import { vm } from './viewmodel'

/**
 * Het wapen wordt in een eigen canvas over het spel heen getekend, op hogere resolutie dan
 * de pixelige wereld. Zo blijven details als gravures, kartels en ruitjes zichtbaar.
 */
const VIEWMODEL_RENDER_HEIGHT = 620

function useViewmodelDpr() {
  const calc = () => Math.min(window.devicePixelRatio || 1, VIEWMODEL_RENDER_HEIGHT / window.innerHeight)
  const [dpr, setDpr] = useState(calc)
  useEffect(() => {
    const onResize = () => setDpr(calc())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return dpr
}

export function ViewmodelCanvas() {
  const dpr = useViewmodelDpr()
  return (
    <Canvas
      className="viewmodel"
      dpr={dpr}
      gl={{ alpha: true, antialias: true }}
      camera={{ fov: 80, near: 0.01, far: 5, position: [0, 0, 0] }}
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1 }}
    >
      <ViewmodelScene />
    </Canvas>
  )
}

interface Pose {
  /** t.o.v. het wapenpunt (vm.pos in rust) */
  position: THREE.Vector3
  scale: number
  /** kanteling om de eigen loop-as (0 = rechtop); verandert de richting van de loop niet */
  roll: number
  /** afstand waarop de loop het kruisje snijdt */
  convergence: number
  /** extra draai naar binnen (radialen), zodat je meer van de linkerkant ziet */
  yaw?: number
}

/** Houding van de Beretta t.o.v. het wapenpunt. */
const BERETTA_POSE: Pose = { position: new THREE.Vector3(-0.035, 0.115, 0.09), scale: 1.35, roll: 0, convergence: 12 }

/** Houding van het aanvalsgeweer: laag rechts, kolf naar de schouder, vizieren in beeld. */
const RIFLE_POSE: Pose = { position: new THREE.Vector3(-0.02, 0.135, 0.1), scale: 1, roll: 0, convergence: 14, yaw: 0.24 }

/**
 * Draai het wapen zo dat de loop vanuit de rustpositie precies naar het kruisje
 * (midden van het scherm) wijst, en kantel het daarna om zijn eigen loop-as.
 */
function aimQuaternion(pose: Pose, muzzleOffset: THREE.Vector3): THREE.Quaternion {
  const gun = new THREE.Vector3(0.22, -0.24, -0.35).add(pose.position)
  // de loop-as ligt iets onder de oorsprong van het model
  const axis = gun.clone().add(new THREE.Vector3(0, muzzleOffset.y, 0))
  const target = new THREE.Vector3(0, 0, -pose.convergence)
  const dir = target.sub(axis).normalize()
  const aim = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir)
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), pose.yaw ?? 0)
  const roll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), pose.roll)
  return turn.multiply(aim).multiply(roll)
}

/** Lege hulzen die uit de uitwerppoort vliegen (camera-coördinaten). */
const CASINGS = 14
const FLASH_TIME = 0.045

const rand = (a: number, b: number) => a + Math.random() * (b - a)

/** In het viewmodel ligt de schijf los op de launcher, zodat hij kan wegvliegen en herladen. */
const simpleGeometry = (id: WeaponId) => (id === 'disk' ? diskLauncherBodyGeometry() : weaponGeometry[id]())

function ViewmodelScene() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const beretta = useMemo(() => buildBeretta(), [])
  const poseQuat = useMemo(
    () => aimQuaternion(BERETTA_POSE, beretta.muzzle.clone().multiplyScalar(BERETTA_SCALE * BERETTA_POSE.scale)),
    [beretta],
  )
  const rifle = useMemo(() => buildRifle(), [])
  const rifleQuat = useMemo(() => aimQuaternion(RIFLE_POSE, rifle.muzzle.clone().multiplyScalar(RIFLE_SCALE * RIFLE_POSE.scale)), [rifle])
  const rifleFx = useMemo(() => {
    const tex = flashTextures()
    const mat = (map: THREE.Texture) =>
      new THREE.MeshBasicMaterial({ map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide })
    // mondingsvuur in mm, aan de loopmond vast: drie gekruiste vlammentongen naar voren,
    // vier korte zijstralen uit de sleuven van de vlamdemper en een ster recht van voren
    const flash = new THREE.Group()
    flash.position.copy(rifle.muzzle)
    const petalMat = mat(tex.petal)
    const petalGeo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0).rotateX(-Math.PI / 2)
    const tongues: THREE.Mesh[] = []
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(petalGeo, petalMat)
      m.rotation.z = (i * Math.PI) / 3
      flash.add(m)
      tongues.push(m)
    }
    const jets: THREE.Mesh[] = []
    for (let i = 0; i < 4; i++) {
      const pivot = new THREE.Group()
      pivot.rotation.z = (i * Math.PI) / 2 + Math.PI / 4
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), petalMat)
      m.position.z = 16
      pivot.add(m)
      flash.add(pivot)
      jets.push(m)
    }
    const starMats = tex.stars.map(mat)
    const star = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), starMats[0])
    star.position.z = -4
    flash.add(star)
    flash.visible = false
    rifle.root.add(flash)

    const caseMat = casingMaterial()
    const casings = Array.from({ length: CASINGS }, () => {
      const mesh = new THREE.Mesh(casingGeometry(), caseMat)
      mesh.visible = false
      return { mesh, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, tinked: true }
    })
    return { flash, tongues, jets, star, starMats, petalMat, casings, caseMat, lastShots: vm.rifleShots, next: 0 }
  }, [rifle])
  const casingGroup = useRef<THREE.Group>(null)
  const root = useRef<THREE.Group>(null)
  const simple = useRef<THREE.Mesh>(null)
  const disk = useRef<THREE.Mesh>(null)
  const flash = useRef<THREE.Mesh>(null)
  const key = useRef<THREE.DirectionalLight>(null)
  const rim = useRef<THREE.DirectionalLight>(null)
  const hemi = useRef<THREE.HemisphereLight>(null)
  const muzzleLight = useRef<THREE.PointLight>(null)

  // reflecties voor het staal: een eenvoudige studio-omgeving
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = env
    return () => {
      scene.environment = null
      env.dispose()
      pmrem.dispose()
    }
  }, [gl, scene])

  useEffect(() => () => beretta.materials.forEach((m) => m.dispose()), [beretta])
  useEffect(() => () => rifle.materials.forEach((m) => m.dispose()), [rifle])
  useEffect(() => {
    const g = casingGroup.current
    if (!g) return
    for (const c of rifleFx.casings) g.add(c.mesh)
    return () => {
      for (const c of rifleFx.casings) g.remove(c.mesh)
      rifleFx.caseMat.dispose()
    }
  }, [rifleFx])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    const g = root.current
    if (!g) return
    const id = WEAPONS[vm.weapon].id
    g.position.copy(vm.pos)
    g.rotation.set(vm.rotX, 0, 0)

    const isPistol = id === 'pistol'
    beretta.root.visible = isPistol
    if (isPistol) {
      // echte positie van de loopmond, voor mondingsvuur en lichtsporen
      g.updateMatrixWorld()
      beretta.root.localToWorld(vm.pistolMuzzle.copy(beretta.muzzle))
    }
    const isRifle = id === 'machinegun'
    rifle.root.visible = isRifle
    if (isRifle) {
      g.updateMatrixWorld()
      rifle.root.localToWorld(vm.rifleMuzzle.copy(rifle.muzzle))
    }
    updateRifle(isRifle, dt)

    if (simple.current) {
      simple.current.visible = !isPistol && !isRifle
      const geo = simpleGeometry(id)
      if (simple.current.geometry !== geo) simple.current.geometry = geo
      ;(simple.current.material as THREE.MeshBasicMaterial).color.copy(vm.tint)
    }

    // Beretta: slede en loop slaan terug, haan klapt mee
    beretta.slide.position.z = vm.recoil * 24
    beretta.barrel.position.z = vm.recoil * 5
    beretta.hammer.rotation.x = -vm.recoil * 0.35

    if (disk.current) {
      disk.current.visible = vm.disk.visible
      disk.current.position.copy(vm.disk.pos)
      disk.current.rotation.copy(vm.disk.rot)
      ;(disk.current.material as THREE.MeshBasicMaterial).color.copy(vm.tint).multiplyScalar(1.15)
    }

    // belichting volgt het licht in de wereld, met wat minimum zodat het wapen zichtbaar blijft
    const lum = THREE.MathUtils.clamp((vm.light.r + vm.light.g + vm.light.b) / 3, 0.12, 1.3)
    if (key.current) {
      key.current.color.copy(vm.light).multiplyScalar(1 / Math.max(lum, 0.12)).lerp(new THREE.Color(1, 1, 1), 0.4)
      key.current.intensity = 0.6 + lum * 2.6
    }
    if (rim.current) rim.current.intensity = 0.25 + lum * 0.9
    if (hemi.current) hemi.current.intensity = 0.25 + lum * 0.8
    scene.environmentIntensity = 0.18 + lum * 0.55

    const flashing = vm.flash > 0
    const muzzlePos = isPistol ? vm.pistolMuzzle : isRifle ? vm.rifleMuzzle : vm.flashPos
    if (flash.current) {
      flash.current.visible = flashing && !isRifle
      flash.current.position.copy(muzzlePos)
      flash.current.rotation.z = Math.random() * Math.PI
    }
    if (muzzleLight.current) {
      muzzleLight.current.position.copy(muzzlePos)
      muzzleLight.current.intensity = flashing ? (isRifle ? 9 : 6) : 0
    }
  })

  /** Grendel, mondingsvuur en hulzen van het aanvalsgeweer. */
  const updateRifle = (isRifle: boolean, dt: number) => {
    const f = rifleFx
    const t = vm.rifleT
    // grendel + laadhendel: in 18 ms naar achteren, in 45 ms terug
    const k = t < 0.018 ? t / 0.018 : Math.max(0, 1 - (t - 0.018) / 0.045)
    rifle.bolt.position.z = k * 45

    // nieuw schot: mondingsvuur elke keer anders, en een huls de lucht in
    if (vm.rifleShots !== f.lastShots) {
      f.lastShots = vm.rifleShots
      const len = 0.75 + Math.random() * 0.6
      f.tongues.forEach((m, i) => {
        const l = (i === 0 ? 420 : 300) * len * (0.75 + Math.random() * 0.5)
        m.scale.set(95 + Math.random() * 60, 1, l)
        m.visible = Math.random() < 0.9
      })
      f.tongues[0].visible = true
      f.jets.forEach((m) => {
        m.scale.set(30 + Math.random() * 16, 60 + Math.random() * 70, 1)
        m.visible = Math.random() < 0.8
      })
      f.star.material = f.starMats[Math.floor(Math.random() * f.starMats.length)]
      f.star.rotation.z = Math.random() * Math.PI * 2
      f.star.scale.setScalar(240 + Math.random() * 160)
      f.flash.rotation.z = Math.random() * Math.PI * 2

      if (isRifle) {
        const c = f.casings[f.next]
        f.next = (f.next + 1) % CASINGS
        rifle.root.localToWorld(c.mesh.position.copy(rifle.ejectPort))
        // naar rechts, omhoog en iets naar achteren, met wat spreiding
        c.vel.set(1.5 + Math.random() * 0.7, 1.0 + Math.random() * 0.6, 0.35 + Math.random() * 0.4)
        c.spin.set(rand(-8, 8), rand(-30, -18), rand(-12, 12))
        c.mesh.quaternion.copy(rifle.root.getWorldQuaternion(c.mesh.quaternion))
        // de huls ligt dwars in de poort: as naar rechts, hals naar voren-rechts
        c.mesh.rotateZ(-Math.PI / 2)
        c.mesh.scale.setScalar(RIFLE_SCALE * RIFLE_POSE.scale)
        c.mesh.visible = true
        c.life = 0
        c.tinked = false
      }
    }

    const visible = isRifle && t < FLASH_TIME
    f.flash.visible = visible
    if (visible) {
      // eerste frame vol, daarna snel uitdovend; de ster dooft sneller dan de vlammen
      const fade = Math.min(1, 1 - t / FLASH_TIME)
      f.petalMat.opacity = fade
      ;(f.star.material as THREE.MeshBasicMaterial).opacity = fade * fade
    }

    for (const c of f.casings) {
      if (!c.mesh.visible) continue
      c.life += dt
      c.vel.y -= 9.8 * dt
      c.mesh.position.addScaledVector(c.vel, dt)
      c.mesh.rotation.x += c.spin.x * dt
      c.mesh.rotation.y += c.spin.y * dt
      c.mesh.rotation.z += c.spin.z * dt
      // de huls is al uit beeld als hij de grond raakt: dan alleen nog het getik
      if (!c.tinked && c.life > 0.42) {
        c.tinked = true
        sfx.casing()
      }
      if (c.life > 0.9) c.mesh.visible = false
    }
  }

  return (
    <>
      <hemisphereLight ref={hemi} args={[0xbfc8d8, 0x2a2018, 0.6]} />
      <directionalLight ref={key} position={[-1.2, 2.2, 1.4]} intensity={2} />
      <directionalLight ref={rim} position={[1.5, 0.6, -2]} intensity={0.6} color={0xa0b8ff} />
      <pointLight ref={muzzleLight} color={0xffb050} distance={1.2} decay={1.5} intensity={0} />

      <group ref={root}>
        {/* Beretta: oorsprong = achterkant bovenop de slede; licht naar binnen gedraaid */}
        <group position={BERETTA_POSE.position} quaternion={poseQuat} scale={BERETTA_POSE.scale}>
          <primitive object={beretta.root} />
        </group>
        <group position={RIFLE_POSE.position} quaternion={rifleQuat} scale={RIFLE_POSE.scale}>
          <primitive object={rifle.root} />
        </group>
        <mesh ref={simple} visible={false}>
          <meshBasicMaterial vertexColors fog={false} />
        </mesh>
        <mesh ref={disk} geometry={viewDiskGeometry()} visible={false}>
          <meshBasicMaterial vertexColors fog={false} />
        </mesh>
      </group>
      <group ref={casingGroup} />
      <mesh ref={flash} visible={false} renderOrder={5}>
        <octahedronGeometry args={[0.1, 0]} />
        <meshBasicMaterial color={[2, 1.6, 0.5]} toneMapped={false} />
      </mesh>
    </>
  )
}
