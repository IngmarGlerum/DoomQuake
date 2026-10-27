import * as THREE from 'three'

/**
 * Gedeelde toestand tussen de wapenlogica (in de spelwereld) en het viewmodel-canvas
 * dat het wapen op hogere resolutie tekent. Alles in camera-coördinaten.
 */
export const vm = {
  /** index in WEAPONS van het wapen dat in beeld is */
  weapon: 0,
  /** positie en kanteling van het wapen (bob, terugslag, wisselen) */
  pos: new THREE.Vector3(0.22, -0.24, -0.35),
  rotX: 0,
  /** mondingsvuur: resterende tijd en positie */
  flash: 0,
  flashPos: new THREE.Vector3(),
  /** licht in de wereld op de plek van de speler (voor belichting van het wapen) */
  light: new THREE.Color(1, 1, 1),
  /** kleur voor de eenvoudige (vertex-color) wapens, inclusief flits */
  tint: new THREE.Color(1, 1, 1),
  /** losse schijf op de disk launcher */
  disk: { visible: false, pos: new THREE.Vector3(), rot: new THREE.Euler() },
  /** loopmond van het gedetailleerde pistool (camera-coördinaten), door het viewmodel bijgewerkt */
  pistolMuzzle: new THREE.Vector3(0.18, -0.19, -0.71),
  /** hoe ver de slede van het pistool naar achteren staat (0..1) */
  recoil: 0,
  /** loopmond van het aanvalsgeweer (camera-coördinaten), door het viewmodel bijgewerkt */
  rifleMuzzle: new THREE.Vector3(0.22, -0.23, -1.22),
  /** aantal schoten met het geweer (nieuw schot → mondingsvuur + huls) en tijd sinds het laatste */
  rifleShots: 0,
  rifleT: 99,
}
