import * as THREE from 'three'
import type { WeaponId } from '../combat/weapons'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { buildRifle } from './arx160'
import { buildBeretta } from './beretta'
import { weaponGeometry as GEOMETRY } from './models'

let icons: Record<WeaponId, string> | null = null

/**
 * Rendert de 3D-wapenmodellen één keer van opzij naar kleine PNG's voor de HUD.
 * Lage resolutie (64×28) zodat ze net zo pixelig zijn als de game zelf.
 */
export function getWeaponIcons(): Record<WeaponId, string> {
  if (icons) return icons
  const W = 64
  const H = 28
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, preserveDrawingBuffer: true })
  renderer.setSize(W, H, false)
  renderer.setClearColor(0x000000, 0)
  const pmrem = new THREE.PMREMGenerator(renderer)
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture

  const result = {} as Record<WeaponId, string>
  for (const id of Object.keys(GEOMETRY) as WeaponId[]) {
    const scene = new THREE.Scene()
    let mesh: THREE.Object3D
    if (id === 'pistol' || id === 'machinegun') {
      // de gedetailleerde modellen, met licht en reflecties
      mesh = new THREE.Group().add(id === 'pistol' ? buildBeretta().root : buildRifle().root)
      scene.environment = env
      scene.environmentIntensity = 1.6
      scene.add(new THREE.HemisphereLight(0xe8eef8, 0x403830, 3))
      const sun = new THREE.DirectionalLight(0xffffff, 5)
      sun.position.set(2, 2.5, 1)
      scene.add(sun)
      const fill = new THREE.DirectionalLight(0xb0c4ff, 2.5)
      fill.position.set(2, -0.5, -1.5)
      scene.add(fill)
    } else {
      mesh = new THREE.Mesh(GEOMETRY[id](), new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1.5, 1.5, 1.5) }))
    }
    // iets gekanteld zodat je ook de bovenkant ziet
    mesh.rotation.set(0.25, 0, 0)
    scene.add(mesh)
    const box = new THREE.Box3().setFromObject(mesh)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    // camera rechts van het wapen: de loop wijst naar rechts in beeld
    const halfW = Math.max(size.z / 2, ((size.y / 2) * W) / H) * 1.08
    const halfH = (halfW * H) / W
    const camera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.01, 10)
    camera.position.set(center.x + 2, center.y, center.z)
    camera.lookAt(center)
    renderer.render(scene, camera)
    result[id] = canvas.toDataURL()
  }
  env.dispose()
  pmrem.dispose()
  renderer.dispose()
  renderer.forceContextLoss()
  icons = result
  return result
}
