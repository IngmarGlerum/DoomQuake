import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { WEAPONS, type WeaponId } from '../combat/weapons'
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

/** Houding van de Beretta t.o.v. het wapenpunt: schuin naar binnen, zodat je de linkerkant en bovenkant ziet. */
const BERETTA_POSE = {
  /** t.o.v. het wapenpunt (vm.pos in rust) */
  position: new THREE.Vector3(-0.035, 0.115, 0.09),
  scale: 1.35,
  /** kanteling om de eigen loop-as (laat de linkerkant zien zonder de richting te veranderen) */
  roll: 0.5,
  /** afstand waarop de loop het kruisje snijdt */
  convergence: 12,
}

/**
 * Draai het pistool zo dat de loop vanuit de rustpositie precies naar het kruisje
 * (midden van het scherm) wijst, en kantel het daarna om zijn eigen loop-as.
 */
function berettaQuaternion(muzzleOffset: THREE.Vector3): THREE.Quaternion {
  const gun = new THREE.Vector3(0.22, -0.24, -0.35).add(BERETTA_POSE.position)
  // de loop-as ligt iets onder de oorsprong van het model
  const axis = gun.clone().add(new THREE.Vector3(0, muzzleOffset.y, 0))
  const target = new THREE.Vector3(0, 0, -BERETTA_POSE.convergence)
  const dir = target.sub(axis).normalize()
  const aim = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir)
  const roll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), BERETTA_POSE.roll)
  return aim.multiply(roll)
}

/** In het viewmodel ligt de schijf los op de launcher, zodat hij kan wegvliegen en herladen. */
const simpleGeometry = (id: WeaponId) => (id === 'disk' ? diskLauncherBodyGeometry() : weaponGeometry[id]())

function ViewmodelScene() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const beretta = useMemo(() => buildBeretta(), [])
  const poseQuat = useMemo(
    () => berettaQuaternion(beretta.muzzle.clone().multiplyScalar(BERETTA_SCALE * BERETTA_POSE.scale)),
    [beretta],
  )
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

  useFrame(() => {
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
    if (simple.current) {
      simple.current.visible = !isPistol
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
    if (flash.current) {
      flash.current.visible = flashing
      flash.current.position.copy(isPistol ? vm.pistolMuzzle : vm.flashPos)
      flash.current.rotation.z = Math.random() * Math.PI
    }
    if (muzzleLight.current) {
      muzzleLight.current.position.copy(isPistol ? vm.pistolMuzzle : vm.flashPos)
      muzzleLight.current.intensity = flashing ? 6 : 0
    }
  })

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
        <mesh ref={simple} visible={false}>
          <meshBasicMaterial vertexColors fog={false} />
        </mesh>
        <mesh ref={disk} geometry={viewDiskGeometry()} visible={false}>
          <meshBasicMaterial vertexColors fog={false} />
        </mesh>
      </group>
      <mesh ref={flash} visible={false} renderOrder={5}>
        <octahedronGeometry args={[0.1, 0]} />
        <meshBasicMaterial color={[2, 1.6, 0.5]} toneMapped={false} />
      </mesh>
    </>
  )
}
