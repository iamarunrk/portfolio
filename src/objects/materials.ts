import * as THREE from 'three';

/**
 * Material presets tuned for the studio environment (IBL only) with
 * NeutralToneMapping at exposure 1. All physically based; no punctual lights.
 */

type Params = THREE.MeshPhysicalMaterialParameters;

/** Glossy painted / printed metal (cans, pedals). Use with a roughness/metalness mask. */
export function paintedMetal(p: Params = {}): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    metalness: 0.5,
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    ...p,
  });
}

export function chrome(p: Params = {}): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color: '#f4f6f8', metalness: 1, roughness: 0.1, ...p });
}

export function brushedAluminium(p: Params = {}): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: '#e3e6ea',
    metalness: 1,
    roughness: 0.26,
    anisotropy: 0.45,
    clearcoat: 0.35,
    clearcoatRoughness: 0.12,
    ...p,
  });
}

export function gold(p: Params = {}): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color: '#E8B931', metalness: 1, roughness: 0.25, ...p });
}

export function glossyPlastic(color: THREE.ColorRepresentation, p: Params = {}): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0,
    roughness: 0.32,
    clearcoat: 0.8,
    clearcoatRoughness: 0.12,
    ...p,
  });
}

/** Clear glass for transmission (jar). */
export function glass(p: Params = {}): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    metalness: 0,
    roughness: 0.04,
    transmission: 1,
    thickness: 0.25,
    ior: 1.5,
    specularIntensity: 1,
    clearcoat: 0,
    ...p,
  });
}

/** Vinyl / paper stickers living on a transparent sticker sheet. */
export function stickerSheet(map: THREE.Texture, p: Params = {}): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    map,
    transparent: true,
    alphaTest: 0.01,
    roughness: 0.42,
    metalness: 0,
    clearcoat: 0.6,
    clearcoatRoughness: 0.18,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
    ...p,
  });
}

/** Holographic foil sticker: iridescent metal over a pastel rainbow print. */
export function holoFoil(map: THREE.Texture, p: Params = {}): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    map,
    transparent: true,
    alphaTest: 0.01,
    metalness: 0.85,
    roughness: 0.18,
    iridescence: 1,
    iridescenceIOR: 1.8,
    iridescenceThicknessMinimum: 180,
    iridescenceThicknessMaximum: 820,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -6,
    ...p,
  });
}

/**
 * Make back faces render as plain paper (the white back of a label or sticker) on a
 * DoubleSide material. Keeps alpha from the map.
 */
export function paperBackfaces<T extends THREE.MeshStandardMaterial>(m: T, back: THREE.ColorRepresentation = '#f3efe6'): T {
  const c = new THREE.Color(back);
  m.side = THREE.DoubleSide;
  m.forceSinglePass = true;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uPaperBack = { value: c };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uPaperBack;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n\tif ( !gl_FrontFacing ) diffuseColor.rgb = uPaperBack;');
  };
  m.customProgramCacheKey = () => 'paper-backfaces';
  return m;
}
