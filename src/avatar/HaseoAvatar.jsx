import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import {
  createHaseoSkinTexture,
  deriveHaseoEyeLayout,
} from './HaseoSkinTexture.js';

const MODEL_URL = './assets/avatar/haseo.fbx';
const EYE_MODEL_URL = './assets/avatar/haseo-eye/eye.fbx';
const EYE_TEXTURE_URLS = {
  baseColor: './assets/avatar/haseo-eye/CORNEA_Base_Color.jpg',
  corneaNormal: './assets/avatar/haseo-eye/CORNEA_Normal_DirectX.jpg',
  corneaRoughness: './assets/avatar/haseo-eye/CORNEA_Roughness.jpg',
  irisNormal: './assets/avatar/haseo-eye/IRIS_Normal_DirectX.jpg',
};
const EYE_IRIS_UV_CENTER = [0.5, 0.5];
const EYE_TEXTURE_CROP = 0.36;
const EYE_SURFACE_OFFSET = 0.00035;
const EYE_APERTURE_FIT = 0.72;
const EYE_DEPTH_COMPRESSION = 0.18;
const EYE_TEXTURE_CENTER = [0.4725, 0.5161];
const clamp = (value, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number(value) || 0));
const rgb = (argb) => (Number(argb) >>> 0) & 0x00ffffff;

// The Haseo head FBX refers to a missing sidecar image; the head gets its
// procedural material, while the supplied eye FBX is loaded with its own maps.
let haseoTemplatePromise = null;
let haseoEyeAssetsPromise = null;

class EmptyTextureLoader {
  path = undefined;

  setPath(path) {
    this.path = path;
    return this;
  }

  load() {
    return new THREE.Texture();
  }
}

function loadHaseoTemplate() {
  if (!haseoTemplatePromise) {
    haseoTemplatePromise = fetch(MODEL_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status} while loading Haseo`);
        return response.arrayBuffer();
      })
      .then((buffer) => {
        const manager = new THREE.LoadingManager();
        manager.addHandler(/\.(?:png|jpe?g)$/i, new EmptyTextureLoader());
        return new FBXLoader(manager).parse(buffer, '');
      })
      .catch((error) => {
        haseoTemplatePromise = null;
        throw error;
      });
  }
  return haseoTemplatePromise;
}

function loadHaseoEyeAssets() {
  if (!haseoEyeAssetsPromise) {
    haseoEyeAssetsPromise = Promise.all([
      fetch(EYE_MODEL_URL).then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status} while loading the supplied Haseo eye model`);
        return response.arrayBuffer();
      }),
      ...Object.entries(EYE_TEXTURE_URLS).map(async ([name, url]) => [
        name,
        await new THREE.TextureLoader().loadAsync(url),
      ]),
    ]).then(([buffer, ...textureEntries]) => {
      const manager = new THREE.LoadingManager();
      manager.addHandler(/\.(?:png|jpe?g)$/i, new EmptyTextureLoader());
      const template = new FBXLoader(manager).parse(buffer, '');
      const textures = Object.fromEntries(textureEntries);
      textures.baseColor.colorSpace = THREE.SRGBColorSpace;
      for (const [name, texture] of Object.entries(textures)) {
        texture.flipY = false;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.repeat.set(EYE_TEXTURE_CROP, EYE_TEXTURE_CROP);
        texture.offset.set(
          EYE_TEXTURE_CENTER[0] - EYE_TEXTURE_CROP * 0.5,
          EYE_TEXTURE_CENTER[1] - EYE_TEXTURE_CROP * 0.5
        );
        texture.anisotropy = 4;
        texture.needsUpdate = true;
        if (name !== 'baseColor') texture.colorSpace = THREE.NoColorSpace;
      }

      const irisMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        map: textures.baseColor,
        normalMap: textures.irisNormal,
        normalScale: new THREE.Vector2(1, -1),
        roughness: 0.58,
        metalness: 0,
        side: THREE.DoubleSide,
      });
      const corneaMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        map: textures.baseColor,
        normalMap: textures.corneaNormal,
        normalScale: new THREE.Vector2(1, -1),
        roughnessMap: textures.corneaRoughness,
        roughness: 0.3,
        metalness: 0,
        clearcoat: 0.38,
        clearcoatRoughness: 0.12,
        side: THREE.DoubleSide,
      });

      template.traverse((object) => {
        if (!object.isMesh) return;
        const isCornea = /cornea/i.test(object.name);
        const oldMaterials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of oldMaterials) {
          material?.map?.dispose?.();
          material?.dispose?.();
        }
        object.material = isCornea ? corneaMaterial : irisMaterial;
        object.renderOrder = isCornea ? 2 : 1;
        object.frustumCulled = false;
        object.userData.haseoEyeModelPart = true;
      });

      return { template, textures, irisMaterial, corneaMaterial };
    }).catch((error) => {
      haseoEyeAssetsPromise = null;
      throw error;
    });
  }
  return haseoEyeAssetsPromise;
}

function findEyeIrisAnchor(template) {
  let irisMesh = null;
  template.traverse((object) => {
    if (!irisMesh && object.isMesh && /iris/i.test(object.name)) irisMesh = object;
  });
  const position = irisMesh?.geometry?.attributes?.position;
  const uv = irisMesh?.geometry?.attributes?.uv;
  const normals = irisMesh?.geometry?.attributes?.normal;
  if (!position || !uv) throw new Error('The supplied eye FBX has no iris UV geometry');

  let bestIndex = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < uv.count; i++) {
    const du = uv.getX(i) - EYE_IRIS_UV_CENTER[0];
    const dv = uv.getY(i) - EYE_IRIS_UV_CENTER[1];
    const distance = du * du + dv * dv;
    if (distance < bestDistance) {
      bestIndex = i;
      bestDistance = distance;
    }
  }
  if (bestIndex < 0) throw new Error('Could not locate the iris center in the supplied eye FBX');
  const normal = normals
    ? new THREE.Vector3(normals.getX(bestIndex), normals.getY(bestIndex), normals.getZ(bestIndex)).normalize()
    : new THREE.Vector3(1, 0, 0);
  return {
    position: new THREE.Vector3(position.getX(bestIndex), position.getY(bestIndex), position.getZ(bestIndex)),
    normal,
  };
}

function createSurfaceMaterial(skinMode, primaryHex, skinTexture) {
  if (skinMode === 0) {
    return new THREE.MeshBasicMaterial({
      color: rgb(primaryHex),
      map: skinTexture,
      side: THREE.DoubleSide,
      wireframe: true,
      transparent: true,
      opacity: 0.86,
    });
  }

  if (skinMode >= 5) {
    const palette = {
      5: { emissive: 0x34200f, intensity: 0.08 },
      6: { emissive: 0x123b3e, intensity: 0.08 },
      7: { emissive: 0x142c3b, intensity: 0.08 },
      8: { emissive: 0x0d1c2b, intensity: 0.08 },
    }[skinMode] || { emissive: 0x142c3b, intensity: 0.08 };

    return new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: skinTexture,
      emissive: palette.emissive,
      emissiveIntensity: palette.intensity,
      metalness: 0.02,
      roughness: 0.68,
      side: THREE.DoubleSide,
      transparent: false,
      opacity: 1,
      depthWrite: true,
    });
  }

  return new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: skinTexture,
    roughness: 0.66,
    metalness: 0,
    side: THREE.DoubleSide,
  });
}

function fitHaseoEyeMeshes(surface, eyeLayout, eyeAssets) {
  const anchor = findEyeIrisAnchor(eyeAssets.template);
  const templateBounds = new THREE.Box3().setFromObject(eyeAssets.template);
  const templateSize = templateBounds.getSize(new THREE.Vector3());
  const verticalModelRadius = Math.max(templateSize.y, templateSize.z) * 0.5;
  const horizontalModelRadius = verticalModelRadius;
  const depthModelRadius = templateSize.x * 0.5;

  return eyeLayout.map((eye) => {
    const normal = new THREE.Vector3(...eye.normal).normalize();
    if (normal.z < 0) normal.negate();
    const center = new THREE.Vector3(...eye.center);
    const orientation = new THREE.Quaternion().setFromUnitVectors(anchor.normal, normal);
    // Use the supplied eye's front geometry, but flatten its depth so the
    // eyeball sits inside the socket instead of bulging out at the temples.
    const scale = new THREE.Vector3(
      eye.scleraRadius[1] / depthModelRadius * EYE_APERTURE_FIT * EYE_DEPTH_COMPRESSION,
      eye.scleraRadius[1] / verticalModelRadius * EYE_APERTURE_FIT,
      eye.scleraRadius[0] / horizontalModelRadius * EYE_APERTURE_FIT
    );
    const eyeRoot = new THREE.Group();
    eyeRoot.name = `Haseo_${eye.name}_EyeModel`;
    eyeRoot.quaternion.copy(orientation);
    eyeRoot.scale.copy(scale);
    const anchorOffset = anchor.position.clone().multiply(scale).applyQuaternion(orientation);
    // The eyeball is partly embedded in the head. Nudge it forward just enough
    // for the full iris and sclera to show through the eye opening.
    eyeRoot.position.copy(center).addScaledVector(normal, EYE_SURFACE_OFFSET).sub(anchorOffset);
    eyeRoot.userData.haseoEyeModel = true;
    eyeRoot.userData.blinkMorph = eye.name;
    eyeRoot.userData.baseScaleY = scale.y;

    const eyeModel = eyeAssets.template.clone(true);
    eyeModel.traverse((object) => {
      if (!object.isMesh) return;
      object.geometry = object.geometry.clone();
      object.userData.haseoEyeModelPart = true;
    });
    eyeRoot.add(eyeModel);
    surface.add(eyeRoot);
    return eyeRoot;
  });
}

function setMorph(mesh, name, value) {
  const index = mesh?.morphTargetDictionary?.[name];
  if (index !== undefined) mesh.morphTargetInfluences[index] = clamp(value);
}

export default function HaseoAvatar({
  state = 'IDLE',
  outputLevel = 0,
  audioLevel = 0,
  viseme = null,
  timeline = null,
  skinMode = 7,
  showCircuits = true,
  primaryHex = 0xff00d4ff,
  accentHex = 0xff5ce1e6,
  closeUp = false,
  onPolygonCountChange = null,
}) {
  const canvasRef = useRef(null);
  const modelRef = useRef(null);
  const rendererRef = useRef(null);
  const livePropsRef = useRef({});
  const [loadError, setLoadError] = useState('');
  const [loaded, setLoaded] = useState(false);

  livePropsRef.current = {
    state,
    outputLevel,
    audioLevel,
    viseme,
    timeline,
    skinMode,
    showCircuits,
    primaryHex,
    accentHex,
    closeUp,
    onPolygonCountChange,
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    let cancelled = false;
    let animationId = 0;
    let root = null;
    let surface = null;
    let wireMesh = null;
    let surfaceMaterial = null;
    let wireMaterial = null;
    let disposed = false;

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1200);
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    rendererRef.current = renderer;

    scene.add(new THREE.HemisphereLight(0xd7eaff, 0x162133, 1.45));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
    keyLight.position.set(-55, 75, 110);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x83bbff, 0.75);
    fillLight.position.set(70, 5, 40);
    scene.add(fillLight);

    const resize = () => {
      const width = canvas.clientWidth || 1;
      const height = canvas.clientHeight || 1;
      renderer.setSize(width, height, false);
      const aspect = width / height;
      const bounds = modelRef.current?.bounds;
      const modelHeight = bounds?.height || 92;
      const zoom = livePropsRef.current.closeUp ? 0.91 : 0.78;
      const halfHeight = modelHeight / (2 * zoom);
      camera.left = -halfHeight * aspect;
      camera.right = halfHeight * aspect;
      camera.top = halfHeight;
      camera.bottom = -halfHeight;
      camera.updateProjectionMatrix();
    };

    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(resize)
      : null;
    observer?.observe(canvas);
    window.addEventListener('resize', resize);

    const loadModel = async () => {
      try {
        const [template, eyeAssets] = await Promise.all([loadHaseoTemplate(), loadHaseoEyeAssets()]);
        if (cancelled) return;
        const imported = template.clone(true);
        imported.updateMatrixWorld(true);
        const meshes = [];
        imported.traverse((object) => {
          if (object.isMesh && object.geometry?.attributes?.position) meshes.push(object);
        });
        surface = meshes[0];
        if (!surface) throw new Error('No mesh found in Haseo FBX');

        // FBXLoader's object bounds include every extreme morph target, which makes
        // the neutral face look tiny. Fit and center the actual neutral vertices only.
        const box = new THREE.Box3().setFromBufferAttribute(surface.geometry.attributes.position);
        box.applyMatrix4(surface.matrixWorld);
        const center = box.getCenter(new THREE.Vector3());
        const boundsSize = box.getSize(new THREE.Vector3());
        imported.position.sub(center);
        root = imported;

        const initialStyle = livePropsRef.current;
        const initialStyleKey = [initialStyle.skinMode, initialStyle.primaryHex, initialStyle.accentHex, initialStyle.showCircuits].join(':');
        const eyeLayout = deriveHaseoEyeLayout(surface.geometry, surface.morphTargetDictionary);
        const skinTexture = createHaseoSkinTexture(initialStyle.skinMode, initialStyle.accentHex, initialStyle.showCircuits);
        surfaceMaterial = createSurfaceMaterial(initialStyle.skinMode, initialStyle.primaryHex, skinTexture);
        surfaceMaterial.userData.haseoStyleKey = initialStyleKey;
        surface.material = surfaceMaterial;
        surface.frustumCulled = false;
        const eyeMeshes = fitHaseoEyeMeshes(surface, eyeLayout, eyeAssets);

        wireMesh = new THREE.Mesh(
          surface.geometry,
          new THREE.MeshBasicMaterial({
            color: rgb(livePropsRef.current.accentHex),
            side: THREE.DoubleSide,
            wireframe: true,
            transparent: true,
            opacity: 0.08,
            depthTest: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
          })
        );
        wireMaterial = wireMesh.material;
        wireMesh.visible = false;
        wireMaterial.color.setHex(rgb(initialStyle.accentHex));
        wireMesh.position.copy(surface.position);
        wireMesh.quaternion.copy(surface.quaternion);
        wireMesh.scale.copy(surface.scale);
        wireMesh.morphTargetInfluences = Array(surface.morphTargetInfluences?.length || 0).fill(0);
        wireMesh.morphTargetDictionary = { ...(surface.morphTargetDictionary || {}) };
        wireMesh.frustumCulled = false;
        surface.parent.add(wireMesh);

        scene.add(root);
        const distance = Math.max(boundsSize.z * 2.3, boundsSize.y * 1.9, 150);
        camera.position.set(0, 0, distance);
        camera.lookAt(0, 0, 0);
        modelRef.current = {
          root,
          surface,
          wireMesh,
          eyeLayout,
          eyeMeshes,
          styleKey: initialStyleKey,
          bounds: { height: boundsSize.y },
          nextBlinkAt: performance.now() + 2600,
          blinkStart: -1,
        };
        const indexCount = surface.geometry.index?.count ?? surface.geometry.attributes.position.count;
        livePropsRef.current.onPolygonCountChange?.(Math.floor(indexCount / 3));
        resize();
        if (!cancelled) setLoaded(true);
      } catch (error) {
        if (!cancelled) {
          console.error('Haseo FBX load error:', error);
          setLoadError('Le modèle Haseo n’a pas pu être chargé.');
        }
      }
    };

    const animate = (now) => {
      animationId = requestAnimationFrame(animate);
      if (disposed) return;
      const model = modelRef.current;
      const props = livePropsRef.current;
      if (model) {
        const { surface: head, wireMesh: wires } = model;
        const influences = head.morphTargetInfluences || [];
        influences.fill(0);

        const sample = props.timeline?.sample?.(now);
        const frame = sample?.frames?.length
          ? sample.frames[sample.frames.length - 1]
          : props.viseme;
        const speaking = props.state === 'SPEAKING' || Boolean(sample?.speaking);
        const level = Math.max(
          clamp(props.outputLevel),
          clamp(props.audioLevel),
          clamp(frame?.level)
        );
        const open = clamp(frame?.open ?? frame?.jaw ?? (speaking ? level * 0.55 : 0));
        const wide = Math.max(-1, Math.min(1, Number(frame?.wide ?? frame?.width ?? 0) || 0));
        const drive = speaking ? Math.max(open, level * 0.18) : open;

        setMorph(head, 'JawOpen', drive * 0.62);
        const vowelBlend = wide > 0.55 ? 0.24 : wide < -0.38 ? 0.22 : 0.78;
        setMorph(head, 'AA', drive * vowelBlend);
        setMorph(head, 'OH', drive * Math.max(0, Math.min(0.48, -wide * 0.5)));
        setMorph(head, 'OU', drive * Math.max(0, Math.min(0.36, (-wide - 0.45) * 0.65)));
        setMorph(head, 'EE', drive * Math.max(0, Math.min(0.55, wide * 0.55)));
        setMorph(head, 'IH', drive * Math.max(0, Math.min(0.25, wide * 0.25)));
        setMorph(head, 'MouthSmile_L', 0.035 + Math.max(0, wide) * 0.14);
        setMorph(head, 'MouthSmile_R', 0.035 + Math.max(0, wide) * 0.14);

        const time = now * 0.001;
        model.root.rotation.y = 0.12 * Math.sin(time * 0.43);
        model.root.rotation.x = 0.025 * Math.sin(time * 0.31 + 0.7);
        model.root.rotation.z = 0.018 * Math.sin(time * 0.26 + 1.2);
        setMorph(head, 'EyesLeft', Math.max(0, 0.12 * Math.sin(time * 0.37)));
        setMorph(head, 'EyesRight', Math.max(0, -0.12 * Math.sin(time * 0.37)));
        setMorph(head, 'EyesUp', Math.max(0, 0.08 * Math.sin(time * 0.29 + 1)));
        setMorph(head, 'EyesDown', Math.max(0, -0.08 * Math.sin(time * 0.29 + 1)));
        setMorph(head, 'BrowsU_C', props.state === 'LISTENING' ? 0.16 : props.state === 'THINKING' ? 0.08 : 0.035);
        setMorph(head, 'BrowsD_L', props.state === 'THINKING' ? 0.16 : 0);
        setMorph(head, 'BrowsD_R', props.state === 'THINKING' ? 0.16 : 0);

        if (now >= model.nextBlinkAt) {
          model.blinkStart = now;
          model.nextBlinkAt = now + 150 + 2500 + Math.random() * 2600;
        }
        const blinkAge = model.blinkStart < 0 ? Infinity : now - model.blinkStart;
        const blink = blinkAge < 170 ? Math.sin((Math.PI * blinkAge) / 170) : 0;
        setMorph(head, 'EyeBlink_L', blink);
        setMorph(head, 'EyeBlink_R', blink);
        for (const eye of model.eyeMeshes || []) {
          const blinkIndex = head.morphTargetDictionary?.[eye.userData.blinkMorph];
          const eyeBlink = blinkIndex === undefined ? 0 : clamp(head.morphTargetInfluences[blinkIndex]);
          eye.scale.y = eye.userData.baseScaleY * Math.max(0.015, 1 - eyeBlink * 0.985);
          eye.visible = eyeBlink < 0.995;
        }

        if (wires && head.morphTargetInfluences && wires.morphTargetInfluences) {
          const n = Math.min(head.morphTargetInfluences.length, wires.morphTargetInfluences.length);
          for (let i = 0; i < n; i++) wires.morphTargetInfluences[i] = head.morphTargetInfluences[i];
        }
      }
      renderer.render(scene, camera);
    };
    animationId = requestAnimationFrame(animate);
    void loadModel();

    return () => {
      cancelled = true;
      disposed = true;
      cancelAnimationFrame(animationId);
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      const disposedEyeGeometry = new Set();
      root?.traverse((object) => {
        if (!object.isMesh) return;
        if (object.userData.haseoEyeModelPart && !disposedEyeGeometry.has(object.geometry)) {
          disposedEyeGeometry.add(object.geometry);
          object.geometry?.dispose?.();
        }
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          material?.map?.dispose?.();
          material?.dispose?.();
        }
      });
      surfaceMaterial?.dispose?.();
      wireMaterial?.dispose?.();
      renderer.dispose();
      rendererRef.current = null;
      modelRef.current = null;
    };
  }, []);

  useEffect(() => {
    const model = modelRef.current;
    const renderer = rendererRef.current;
    if (!model || !renderer) return;

    const styleKey = [skinMode, primaryHex, accentHex, showCircuits].join(':');
    if (model.styleKey !== styleKey) {
      const texture = createHaseoSkinTexture(skinMode, accentHex, showCircuits);
      const material = createSurfaceMaterial(skinMode, primaryHex, texture);
      material.userData.haseoStyleKey = styleKey;
      model.surface.material.map?.dispose?.();
      model.surface.material.dispose();
      model.surface.material = material;
      model.styleKey = styleKey;
    }
    const wire = model.wireMesh;
    // Keep the surface human-looking; electrical tracks are painted into its texture,
    // rather than drawing a triangle wireframe across the whole face.
    wire.visible = false;
    wire.material.color.setHex(rgb(accentHex));
    wire.material.opacity = 0;
  }, [skinMode, showCircuits, primaryHex, accentHex, loaded]);

  return (
    <div className="haseo-avatar-renderer" role="img" aria-label="Avatar 3D Haseo">
      <canvas ref={canvasRef} className="haseo-avatar-canvas" />
      {!loaded && !loadError && <div className="haseo-avatar-status">Chargement du visage Haseo…</div>}
      {loadError && <div className="haseo-avatar-status is-error">{loadError}</div>}
    </div>
  );
}
