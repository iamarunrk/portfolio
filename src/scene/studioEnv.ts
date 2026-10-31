import * as THREE from 'three';

/**
 * Procedural "product photography" studio used as the image-based lighting for
 * every 3D object: a dim cyclorama with big HDR softboxes and thin rim strips.
 * The strips are what give cans, jars and glossy plastic those crisp, long
 * specular streaks you see in packshot renders. Nothing is fetched.
 */
export function createStudioEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene();
  const disposables: { dispose(): void }[] = [];

  const emissive = (r: number, g: number, b: number, intensity: number) => {
    const m = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false });
    m.color.setRGB(r * intensity, g * intensity, b * intensity, THREE.LinearSRGBColorSpace);
    disposables.push(m);
    return m;
  };

  // Cyclorama: a large sphere, dark at the bottom and slightly lifted at the top.
  const roomGeo = new THREE.SphereGeometry(20, 48, 24);
  const colors: number[] = [];
  const pos = roomGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 20; // -1..1
    const t = THREE.MathUtils.smoothstep(y, -0.6, 0.9);
    const v = THREE.MathUtils.lerp(0.025, 0.16, t);
    colors.push(v, v * 1.02, v * 1.08);
  }
  roomGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const roomMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, toneMapped: false });
  scene.add(new THREE.Mesh(roomGeo, roomMat));
  disposables.push(roomGeo, roomMat);

  const plane = new THREE.PlaneGeometry(1, 1);
  disposables.push(plane);
  const panel = (
    mat: THREE.Material,
    pos: [number, number, number],
    scale: [number, number],
    lookAt: [number, number, number] = [0, 0, 0],
  ) => {
    const m = new THREE.Mesh(plane, mat);
    m.position.set(...pos);
    m.scale.set(scale[0], scale[1], 1);
    m.lookAt(...lookAt);
    scene.add(m);
    return m;
  };

  // Key softbox: big, upper-left-front.
  panel(emissive(1, 0.98, 0.95, 6.0), [-6, 6, 7], [7, 5]);
  // Fill: tall, right-front, softer.
  panel(emissive(0.95, 0.97, 1, 2.2), [8, 0.5, 5], [4, 9]);
  // Top light.
  panel(emissive(1, 1, 1, 2.5), [0, 10, 0], [8, 8]);
  // Rim strips behind, left & right: long thin streaks on cylinders.
  panel(emissive(1, 1, 1, 9.0), [-7, 1, -6], [0.9, 12]);
  panel(emissive(1, 1, 1, 7.0), [7.5, 1, -5], [0.7, 12]);
  // Front strip, low: catches the lower edge of glossy faces.
  panel(emissive(1, 1, 1, 3.0), [0, -2.5, 10], [10, 0.8]);
  // Subtle coloured bounce cards for a stylised, toy-like reflection tint.
  panel(emissive(1.0, 0.45, 0.75, 1.1), [-9, -4, 2], [5, 4]);
  panel(emissive(0.35, 0.75, 1.0, 1.0), [9, -4, -1], [5, 4]);
  // Warm floor bounce.
  panel(emissive(1.0, 0.9, 0.8, 0.5), [0, -9, 0], [14, 14]);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0.02, 0.1, 100, { size: 256 });
  pmrem.dispose();
  disposables.forEach((d) => d.dispose());
  return target.texture;
}
