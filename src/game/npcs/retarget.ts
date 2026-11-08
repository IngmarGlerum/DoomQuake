import * as THREE from 'three'

/**
 * Zet een animatie van het ene skelet over op het andere, ook als hun botten andere assen
 * hebben (zoals Xbot uit Mixamo en een via Blender geëxporteerd Mixamo-personage).
 *
 * Werkwijze: beide skeletten staan in rust in dezelfde houding (T-pose). Per frame nemen we voor elk
 * bot de draaiing ten opzichte van de ruststand over, in wereldruimte:
 *   doelWereld = (bronWereld · bronRust⁻¹) · doelRust
 * en rekenen dat terug naar een lokale draaiing onder de (al omgerekende) ouder.
 * De heupen bewegen alleen op en neer mee (de animaties blijven op hun plek).
 */
export function retargetClip(
  sourceRoot: THREE.Object3D,
  clip: THREE.AnimationClip,
  targetRoot: THREE.Object3D,
  options: {
    fps?: number
    hip?: string
    hipScale?: number
    /** naam van het bronbot bij een doelbot (standaard dezelfde naam) */
    sourceName?: (targetName: string) => string
    /** het doel staat in A-pose: armen eerst horizontaal zetten, zodat de ruststand een T-pose is */
    alignArms?: boolean
  } = {},
): THREE.AnimationClip {
  const fps = options.fps ?? 30
  const hipName = options.hip ?? 'mixamorigHips'
  const hipScale = options.hipScale ?? 1
  const sourceName = options.sourceName ?? ((n: string) => n)

  // botten van het doel in volgorde ouder-voor-kind, met hun tegenhanger in de bron
  const targets: THREE.Bone[] = []
  targetRoot.traverse((o) => {
    if ((o as THREE.Bone).isBone) targets.push(o as THREE.Bone)
  })
  const pairs = targets
    .map((t) => ({ t, s: sourceRoot.getObjectByName(sourceName(t.name)) }))
    .filter((p): p is { t: THREE.Bone; s: THREE.Object3D } => !!p.s)

  sourceRoot.updateMatrixWorld(true)
  targetRoot.updateMatrixWorld(true)
  const saved = targets.map((b) => b.quaternion.clone())
  if (options.alignArms) alignArmsToTPose(targets)
  const worldQ = (o: THREE.Object3D) => o.getWorldQuaternion(new THREE.Quaternion())
  const restSourceInv = new Map(pairs.map((p) => [p.t, worldQ(p.s).invert()]))
  const restTarget = new Map(pairs.map((p) => [p.t, worldQ(p.t)]))
  const restParent = new Map(pairs.map((p) => [p.t, p.t.parent ? worldQ(p.t.parent) : new THREE.Quaternion()]))

  const hip = pairs.find((p) => p.t.name === hipName)
  const restHipSource = hip ? hip.s.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3()
  const restHipTarget = hip ? hip.t.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3()
  const hipParentInv = hip?.t.parent ? hip.t.parent.matrixWorld.clone().invert() : new THREE.Matrix4()

  const frames = Math.max(2, Math.round(clip.duration * fps) + 1)
  const times = new Float32Array(frames)
  const quats = new Map(pairs.map((p) => [p.t, new Float32Array(frames * 4)]))
  const hipPos = new Float32Array(frames * 3)

  const mixer = new THREE.AnimationMixer(sourceRoot)
  mixer.clipAction(clip).play()
  const world = new Map<THREE.Object3D, THREE.Quaternion>()
  const q = new THREE.Quaternion()
  const local = new THREE.Quaternion()
  const p = new THREE.Vector3()

  for (let f = 0; f < frames; f++) {
    const t = Math.min(clip.duration, f / fps)
    times[f] = t
    mixer.setTime(t)
    sourceRoot.updateMatrixWorld(true)
    world.clear()
    for (const { t: bone, s } of pairs) {
      // draaiing t.o.v. rust (bron), toegepast op de rust van het doel
      q.copy(worldQ(s)).multiply(restSourceInv.get(bone)!).multiply(restTarget.get(bone)!)
      world.set(bone, q.clone())
      const parentWorld = (bone.parent && world.get(bone.parent)) || restParent.get(bone)!
      local.copy(parentWorld).invert().multiply(q)
      local.toArray(quats.get(bone)!, f * 4)
    }
    if (hip) {
      hip.s.getWorldPosition(p)
      const dy = (p.y - restHipSource.y) * hipScale
      p.copy(restHipTarget).setY(restHipTarget.y + dy).applyMatrix4(hipParentInv)
      p.toArray(hipPos, f * 3)
    }
  }
  mixer.stopAllAction()
  mixer.uncacheRoot(sourceRoot)
  // doel terug in zijn eigen ruststand
  targets.forEach((b, i) => b.quaternion.copy(saved[i]))
  targetRoot.updateMatrixWorld(true)

  const tracks: THREE.KeyframeTrack[] = pairs.map(({ t }) => new THREE.QuaternionKeyframeTrack(`${t.name}.quaternion`, times, quats.get(t)!))
  if (hip) tracks.push(new THREE.VectorKeyframeTrack(`${hip.t.name}.position`, times, hipPos))
  return new THREE.AnimationClip(clip.name, clip.duration, tracks)
}

/** Zet beide armen horizontaal naar buiten (T-pose), in wereldruimte. */
function alignArmsToTPose(bones: THREE.Bone[]) {
  const find = (suffix: string) => bones.find((b) => b.name.endsWith(suffix))
  const hips = find('Hips')
  if (!hips) return
  const hipPos = hips.getWorldPosition(new THREE.Vector3())
  for (const side of ['Left', 'Right']) {
    const arm = find(`${side}Arm`)
    const fore = find(`${side}ForeArm`)
    const hand = find(`${side}Hand`)
    if (!arm || !fore || !hand) continue
    const out = new THREE.Vector3(Math.sign(arm.getWorldPosition(new THREE.Vector3()).x - hipPos.x) || 1, 0, 0)
    aimWorld(arm, fore, out)
    aimWorld(fore, hand, out)
  }
}

/** Draai `bone` zodat de lijn naar `child` in richting `dir` (wereld) wijst. */
function aimWorld(bone: THREE.Object3D, child: THREE.Object3D, dir: THREE.Vector3) {
  bone.updateMatrixWorld(true)
  const a = bone.getWorldPosition(new THREE.Vector3())
  const b = child.getWorldPosition(new THREE.Vector3())
  const delta = new THREE.Quaternion().setFromUnitVectors(b.sub(a).normalize(), dir.clone().normalize())
  const parentWorld = bone.parent!.getWorldQuaternion(new THREE.Quaternion())
  const boneWorld = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(delta)
  bone.quaternion.copy(parentWorld.invert().multiply(boneWorld))
  bone.updateMatrixWorld(true)
}
