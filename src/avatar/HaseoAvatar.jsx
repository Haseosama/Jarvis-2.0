import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { createHaseoSkinTexture, deriveHaseoEyeLayout } from './HaseoSkinTexture.js';

const MODEL_URL = './assets/avatar/haseo.fbx';
const clamp = (value, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number(value) || 0));
const rgb = (argb) => (Number(argb) >>> 0) & 0x00ffffff;

// The FBX refers to an image that was not supplied. Return a blank texture instead
// of making a broken network request; the model is deliberately rendered with a
// material generated from Jarvis' skin / hologram selection.
let haseoTemplatePromise = null;

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
        manager.addHandler(/\.png$/i, new EmptyTextureLoader());
        return new FBXLoader(manager).parse(buffer, '');
      })
      .catch((error) => {
        haseoTemplatePromise = null;
        throw error;
      });
  }
  return haseoTemplatePromise;
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
        const template = await loadHaseoTemplate();
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
        const skinTexture = createHaseoSkinTexture(initialStyle.skinMode, initialStyle.accentHex, initialStyle.showCircuits, 1024, eyeLayout);
        surfaceMaterial = createSurfaceMaterial(initialStyle.skinMode, initialStyle.primaryHex, skinTexture);
        surfaceMaterial.userData.haseoStyleKey = initialStyleKey;
        surface.material = surfaceMaterial;
        surface.frustumCulled = false;

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
      root?.traverse((object) => {
        if (!object.isMesh) return;
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
      const texture = createHaseoSkinTexture(skinMode, accentHex, showCircuits, 1024, model.eyeLayout);
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
