import * as THREE from 'three'

/**
 * Materialen voor de patiënten (zombies) in het gesticht. Alles wordt in de shader over de
 * bestaande textures van het model geschilderd, op de bind-pose-coördinaten (`vBind`, meters):
 * - zombiehuid: grauw, vlekkerig, met aders, ingevallen donkere oogkassen, een bebloede mond,
 *   bloed over kin en hals en een paar rottende wonden per patiënt
 * - ogen: melkwit (staar) met bloedvaten; tanden: geel en vuil
 * - kleding: vergeeld hemd of dwangbuis met riemen, vuil en bloed
 * - kogelwonden: blijvende gaten met een bloedvlek en een straaltje naar beneden (op alle delen)
 * Plus wat eigen licht uit de vooraf berekende belichting op de plek (`tint`).
 */

export const MAX_WOUNDS = 12

/** Gedeelde uniforms per patiënt (wonden en eigen licht), door al zijn materialen gebruikt. */
export interface PatientUniforms {
  uTint: { value: THREE.Color }
  uWounds: { value: THREE.Vector4[] }
  uWoundCount: { value: number }
  uRot: { value: THREE.Vector4[] }
  uSeed: { value: number }
}

export function patientUniforms(seed: number, rot: THREE.Vector4[]): PatientUniforms {
  return {
    uTint: { value: new THREE.Color(1, 1, 1) },
    uWounds: { value: Array.from({ length: MAX_WOUNDS }, () => new THREE.Vector4(0, -10, 0, 0)) },
    uWoundCount: { value: 0 },
    uRot: { value: rot },
    uSeed: { value: seed },
  }
}

const SELF_LIT = 0.25

const COMMON = `
varying vec3 vBind;
uniform vec3 uTint;
uniform vec4 uWounds[${MAX_WOUNDS}];
uniform float uWoundCount;
uniform vec4 uRot[3];
uniform float uSeed;
float zHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed) * 43758.5453); }
float zNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(zHash(i), zHash(i + vec2(1, 0)), f.x), mix(zHash(i + vec2(0, 1)), zHash(i + vec2(1, 1)), f.x), f.y);
}
float wetMask;
float clothMask;
// kogelwonden: gat, gescheurde rand, doorweekte vlek en een straaltje bloed naar beneden
void applyWounds(vec3 p, inout vec3 col) {
  for (int i = 0; i < ${MAX_WOUNDS}; i++) {
    if (float(i) >= uWoundCount) break;
    vec3 w = uWounds[i].xyz;
    float r = uWounds[i].w;
    float d = distance(p, w);
    float n = zNoise(p.xy * 160.0 + float(i) * 7.0);
    float soak = smoothstep(r * 3.4, r * 1.1, d + (n - 0.5) * r * 1.2);
    col = mix(col, vec3(0.26, 0.012, 0.012), soak * 0.85);
    float below = w.y - p.y;
    float dx = length((p - w).xz);
    float drip = step(0.0, below) * smoothstep(0.004 + below * 0.03 + r * 0.6, 0.002, dx) * smoothstep(0.26, 0.0, below);
    col = mix(col, vec3(0.2, 0.008, 0.008), drip * 0.9);
    float rim = smoothstep(r * 1.5, r * 0.8, d);
    col = mix(col, vec3(0.42, 0.05, 0.035), rim * 0.75);
    float hole = smoothstep(r * 0.75, r * 0.3, d);
    col = mix(col, vec3(0.04, 0.0, 0.0), hole);
    wetMask = max(wetMask, max(soak, drip));
  }
}
`

type Paint = 'skin' | 'eyes' | 'teeth' | 'beard' | 'cloth' | 'plain'

const PAINT: Record<Paint, string> = {
  skin: `
  {
    vec3 p = vBind;
    float ax = abs(p.x);
    float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
    float m1 = zNoise(p.xy * 14.0 + p.z * 7.0);
    float m2 = zNoise(p.yz * 45.0 + 3.0);
    // grauwe, gelig-groene huid, vlekkerig
    vec3 skin = mix(vec3(0.43, 0.41, 0.3), vec3(0.32, 0.36, 0.27), m1) * (0.75 + lum * 0.5) * (0.9 + m2 * 0.15);
    // vlekken: blauwpaars (lijkvlekken) en geelbruin
    skin = mix(skin, vec3(0.24, 0.16, 0.2), smoothstep(0.62, 0.82, m1) * 0.6);
    skin = mix(skin, vec3(0.42, 0.34, 0.16), smoothstep(0.7, 0.9, zNoise(p.xy * 9.0 + 11.0)) * 0.5);
    // aders
    float vein = smoothstep(0.03, 0.0, abs(zNoise(p.xy * 24.0 + p.zx * 9.0) - 0.5)) * 0.5;
    skin = mix(skin, vec3(0.24, 0.26, 0.4), vein);
    // ingevallen, donkere oogkassen en holle wangen
    vec2 e = vec2(ax - 0.033, (p.y - 1.726) * 1.15);
    float socket = smoothstep(0.046, 0.014, length(e)) * step(0.04, p.z);
    skin = mix(skin, vec3(0.1, 0.035, 0.045), socket * 0.92);
    float cheek = smoothstep(0.035, 0.0, length(vec2(ax - 0.05, (p.y - 1.665) * 1.4))) * step(0.03, p.z);
    skin *= 1.0 - cheek * 0.45;
    // gebarsten, uitgedroogde huid
    float crack = smoothstep(0.02, 0.0, abs(zNoise(p.xy * 55.0 + p.z * 20.0) - 0.5)) * 0.45;
    skin = mix(skin, vec3(0.18, 0.12, 0.1), crack);
    // mond: bloedige, gescheurde lippen
    float mouth = smoothstep(0.04, 0.012, length(vec2(p.x, (p.y - 1.655) * 1.6))) * step(0.07, p.z);
    skin = mix(skin, vec3(0.22, 0.015, 0.015), mouth * 0.95);
    // bloed uit de mond over kin en hals
    float run = step(p.y, 1.645) * step(1.48, p.y) * step(0.04, p.z);
    float chin = run * smoothstep(0.028, 0.006, abs(p.x + sin(p.y * 90.0 + uSeed) * 0.006 - (zHash(vec2(uSeed)) - 0.5) * 0.02));
    skin = mix(skin, vec3(0.24, 0.012, 0.012), chin * 0.85);
    // rottende plekken
    float rotWet = 0.0;
    for (int i = 0; i < 3; i++) {
      vec3 c = uRot[i].xyz;
      float r = uRot[i].w;
      float d = distance(p, c) + (zNoise(p.xy * 70.0 + float(i)) - 0.5) * r * 0.7;
      float rot = smoothstep(r, r * 0.45, d);
      vec3 flesh = mix(vec3(0.33, 0.04, 0.035), vec3(0.52, 0.44, 0.2), smoothstep(r * 0.45, r * 0.95, d));
      skin = mix(skin, flesh, rot);
      rotWet = max(rotWet, rot);
    }
    wetMask = max(max(mouth, chin), rotWet);
    diffuseColor.rgb = skin;
  }`,
  eyes: `
  {
    float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
    vec3 c = vec3(0.5, 0.47, 0.36) * (0.6 + lum * 0.45);
    // iris wordt melkachtig grijs (staar)
    c = mix(c, vec3(0.4, 0.42, 0.4), step(lum, 0.4) * 0.8);
    // bloedvaten
    float v = smoothstep(0.06, 0.0, abs(zNoise(vMapUv * 40.0) - 0.5));
    c = mix(c, vec3(0.55, 0.04, 0.04), v * 0.7);
    wetMask = 1.0;
    diffuseColor.rgb = c;
  }`,
  teeth: `
  {
    float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
    vec3 c = diffuseColor.rgb * vec3(0.82, 0.66, 0.42) * (0.85 + zNoise(vMapUv * 60.0) * 0.3);
    // tandvlees en bloed tussen de tanden
    c = mix(c, vec3(0.3, 0.03, 0.03), smoothstep(0.55, 0.3, lum) * 0.6);
    wetMask = 0.8;
    diffuseColor.rgb = c;
  }`,
  beard: `
  {
    diffuseColor.rgb *= vec3(0.55, 0.5, 0.45);
  }`,
  cloth: `
  {
    vec3 p = vBind;
    float ax = abs(p.x);
    float folds = 0.88 + 0.12 * zNoise(vec2(p.x * 22.0, p.y * 3.0));
    float dirt = zNoise(p.xy * 6.0) * 0.22 + zNoise(p.xy * 25.0) * 0.07;
    vec3 cloth = uCloth * folds * (1.0 - dirt);
    if (uJacket > 0.5) {
      float strap = 0.0;
      for (int i = 0; i < 3; i++) {
        float y = 1.18 - float(i) * 0.24;
        strap = max(strap, smoothstep(0.03, 0.02, abs(p.y - y - p.x * 0.18)) * step(ax, 0.3));
      }
      float buckle = smoothstep(0.03, 0.02, length(vec2(p.x - 0.12, p.y - 1.2)));
      cloth = mix(cloth, vec3(0.42, 0.38, 0.31) * folds, strap);
      cloth = mix(cloth, vec3(0.45), buckle);
    }
    // bloed: spetters op de borst en lange vegen naar beneden
    float splat = smoothstep(0.7, 0.8, zNoise(p.xy * vec2(9.0, 4.0) + 3.0)) * uBlood;
    float drip = smoothstep(0.8, 0.9, zNoise(vec2(p.x * 40.0, p.y * 1.5))) * uBlood * step(0.6, p.y);
    cloth = mix(cloth, vec3(0.24, 0.014, 0.014), clamp(splat + drip, 0.0, 1.0) * 0.9);
    wetMask = clamp(splat + drip, 0.0, 1.0) * 0.6;
    clothMask = 1.0;
    diffuseColor.rgb = cloth;
  }`,
  plain: '',
}

export interface ClothLook {
  cloth: THREE.Color
  jacket: number
  blood: number
}

/** Materiaal voor één deel van een patiënt, gebaseerd op het originele materiaal van het model. */
export function patientMaterial(base: THREE.MeshStandardMaterial, paint: Paint, u: PatientUniforms, look?: ClothLook) {
  const mat = base.clone()
  // kleding: de plooien van het originele pak (revers, naden) niet laten zien
  if (paint === 'cloth') mat.normalMap = null
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u)
    if (look) {
      shader.uniforms.uCloth = { value: look.cloth }
      shader.uniforms.uJacket = { value: look.jacket }
      shader.uniforms.uBlood = { value: look.blood }
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBind;')
      .replace(
        '#include <begin_vertex>',
        paint === 'cloth'
          ? // het kledingstuk van het model is een smoking: het strikje plat tegen de hals drukken
            '#include <begin_vertex>\nvBind = position;\nif (abs(position.x) < 0.075 && position.y > 1.41 && position.y < 1.54 && position.z > 0.085) transformed.z = 0.085;'
          : '#include <begin_vertex>\nvBind = position;',
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${COMMON}${look ? 'uniform vec3 uCloth;\nuniform float uJacket;\nuniform float uBlood;\n' : ''}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\nwetMask = 0.0;\nclothMask = 0.0;\n${PAINT[paint]}\napplyWounds(vBind, diffuseColor.rgb);`)
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>\nroughnessFactor = mix(clothMask > 0.5 ? 0.92 : 0.6, 0.22, wetMask);`,
      )
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uTint * ${SELF_LIT.toFixed(2)};`)
  }
  mat.customProgramCacheKey = () => `patient-${paint}-v2`
  return mat
}

/** Welke beschildering bij welk materiaal van het (Ready Player Me) model hoort. */
export function paintFor(materialName: string): Paint | 'hide' {
  switch (materialName) {
    case 'Wolf3D_Headwear':
      return 'hide'
    case 'Wolf3D_Skin':
    case 'Wolf3D_Body':
      return 'skin'
    case 'Wolf3D_Eye':
      return 'eyes'
    case 'Wolf3D_Teeth':
      return 'teeth'
    case 'Wolf3D_Beard':
      return 'beard'
    case 'Wolf3D_Outfit_Top':
    case 'Wolf3D_Outfit_Bottom':
      return 'cloth'
    default:
      return 'plain'
  }
}

/** Mogelijke plekken voor rottende wonden (bind-pose van het mannelijke model, meters). */
const ROT_SPOTS: [number, number, number, number][] = [
  [0.052, 1.69, 0.085, 0.022],
  [-0.055, 1.69, 0.085, 0.02],
  [0.02, 1.8, 0.1, 0.025],
  [0.078, 1.76, 0.02, 0.022],
  [-0.045, 1.62, 0.07, 0.02],
  [0.035, 1.56, 0.06, 0.025],
  [-0.075, 1.75, 0.0, 0.025],
]

export function rotSpots(seed: number) {
  const out: THREE.Vector4[] = []
  for (let i = 0; i < 3; i++) {
    const s = ROT_SPOTS[(seed * 3 + i * 5) % ROT_SPOTS.length]
    out.push(new THREE.Vector4(...s))
  }
  return out
}
