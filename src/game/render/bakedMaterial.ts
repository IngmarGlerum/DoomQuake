import * as THREE from 'three'

/**
 * PBR-materiaal voor de realistische weergave, gecombineerd met de vooraf berekende verlichting.
 *
 * - De gebakken belichting (vertex-attribuut `bake`) is de basis: albedo × bake, als "eigen licht".
 * - Echte lampen (de zaklamp, lampen dicht bij de speler) belichten het materiaal daarbovenop, met
 *   normal maps, glans en schaduw. Ze werken op de pure albedo, dus de zaklamp maakt ook donkere
 *   hoeken zichtbaar.
 * - Reflecties van de omgeving worden gedempt waar het donker is (anders glanzen donkere gangen).
 */
export function bakedMaterial(params: THREE.MeshStandardMaterialParameters & { bake?: number }) {
  const { bake = 0.8, ...rest } = params
  const mat = new THREE.MeshStandardMaterial(rest)
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uBake = { value: bake }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 bake;\nvarying vec3 vBake;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBake = bake;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBake;\nuniform float uBake;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vBake * uBake;')
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
reflectedLight.indirectDiffuse *= 0.0;
reflectedLight.indirectSpecular *= clamp(vBake * 1.2, 0.0, 1.0);`,
      )
  }
  mat.customProgramCacheKey = () => 'baked-v1'
  return mat
}
