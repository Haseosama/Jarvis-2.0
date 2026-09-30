import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  HeadMesh,
  HairStyle,
  CharacterMesh,
  HAIR_SHADES,
  BUILT_IN_FACES,
  POLYGON_LEVELS,
  CircuitTraces,
  NetworkWeb,
  recolourHair,
} from '../src/avatar/HeadMesh.js';
import { textToVisemes, VisemeStream, pcmVisemes, HoloAvatar } from '../src/avatar/Visemes.js';
import { AvatarRenderer } from '../src/avatar/AvatarRenderer.js';
import {
  parseMapRings,
  parseCities,
  solarSystemObjects,
  satelliteStateAt,
  DEFAULT_SATELLITES,
  parseTleCatalog,
  tleStateAt,
  moonPhase,
} from '../src/space/SpaceEngine.js';
import { hostBridge } from '../src/core/hostBridge.js';
import { PluginEngine } from '../src/core/PluginEngine.js';
import { ToolRegistry } from '../src/actions/ToolRegistry.js';
import { normalizeAircraft, haversineDistanceKm } from '../src/space/TrackingService.js';
import { configStore, ALL_VOICES, VOICE_PROFILES, normalizeFaceId } from '../src/core/ConfigStore.js';

const ASSETS_DIR = path.resolve(process.cwd(), 'public/assets');

function readArrayBuffer(relPath) {
  const buf = fs.readFileSync(path.join(ASSETS_DIR, relPath));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe('Jarvis 2.0 PC Edition — Core & Binary Asset Suite', () => {
  it('parses JHM2 3D head meshes (Classic, Léa, Marc) and animates HoloAvatar', () => {
    for (const file of ['avatar/head_mesh.bin', 'avatar/head_mesh_lea.bin', 'avatar/head_mesh_marc.bin']) {
      const ab = readArrayBuffer(file);
      const mesh = HeadMesh.parse(ab);
      assert.ok(mesh.vertexCount > 500, `${file} vertexCount > 500`);
      assert.ok(mesh.faceCount > 500, `${file} faceCount > 500`);
      assert.ok(mesh.nHead > 500, `${file} nHead > 500`);

      const holo = new HoloAvatar(mesh);
      holo.step(0.016, 0.65, true, 'IDLE', [{ level: 0.7, open: 0.8, wide: 0.2 }]);
      assert.ok(holo.mouth > 0, 'HoloAvatar mouth > 0 when speaking');
    }
  });

  it('animates a visible mouth cavity and eases back to a closed resting pose', () => {
    const mesh = HeadMesh.parse(readArrayBuffer('avatar/head_mesh.bin'));
    const avatar = new HoloAvatar(mesh);
    avatar.step(0.02, 1, true, 'IDLE', [{ level: 1, open: 1, wide: 0.1 }], 0.02);
    avatar.pose();

    const averageY = (chain) => chain.reduce((sum, i) => sum + avatar.pv[3 * i + 1], 0) / chain.length;
    const openGap = averageY(mesh.mouthUpper) - averageY(mesh.mouthLower);
    const peakMouth = avatar.mouth;
    assert.ok(peakMouth > 0.3, `open mouth drive is visible (${peakMouth})`);
    assert.ok(openGap > 0.03, `upper/lower lips separate for the mouth cavity (${openGap})`);

    const renderer = Object.create(AvatarRenderer.prototype);
    renderer.mesh = mesh;
    renderer.xs = new Float32Array(mesh.vertexCount);
    renderer.ys = new Float32Array(mesh.vertexCount);
    renderer.holo = false;
    renderer.skin = 1;
    renderer.lips = 0;
    const cameraDistance = 4.6;
    for (let i = 0; i < mesh.vertexCount; i++) {
      const z = avatar.pv[3 * i + 2];
      const scale = (cameraDistance / Math.max(cameraDistance - z, 0.35)) * 200;
      renderer.xs[i] = avatar.pv[3 * i] * scale;
      renderer.ys[i] = -avatar.pv[3 * i + 1] * scale;
    }
    let fills = 0;
    const gradient = { addColorStop() {} };
    const ctx = {
      save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
      fill() { fills++; }, clip() {}, stroke() {}, ellipse() {},
      createLinearGradient() { return gradient; }, createRadialGradient() { return gradient; },
    };
    renderer.drawMouth(ctx, avatar, 200, 1, 0xff00d4ff, 1);
    assert.ok(fills >= 3, 'draws the mouth cavity, teeth and tongue while speaking');

    for (let i = 0; i < 20; i++) {
      avatar.step(0.02, 0, false, 'IDLE', [{ level: 0, open: 0, wide: 0 }], 0.02);
    }
    avatar.pose();
    assert.ok(avatar.mouth < peakMouth * 0.1, 'mouth relaxes back toward closed after speech');
    assert.ok(averageY(mesh.mouthUpper) - averageY(mesh.mouthLower) < openGap * 0.2, 'lip gap returns toward rest');
    for (let i = 0; i < mesh.vertexCount; i++) {
      const z = avatar.pv[3 * i + 2];
      const scale = (cameraDistance / Math.max(cameraDistance - z, 0.35)) * 200;
      renderer.xs[i] = avatar.pv[3 * i] * scale;
      renderer.ys[i] = -avatar.pv[3 * i + 1] * scale;
    }
    const restingFills = fills;
    renderer.drawMouth(ctx, avatar, 200, 1, 0xff00d4ff, 1);
    assert.equal(fills, restingFills, 'closed mouth has no dark cavity overlay');
  });

  it('parses JHR1 3D hairstyles and fits them onto a head mesh', () => {
    const headAb = readArrayBuffer('avatar/head_mesh_lea.bin');
    const head = HeadMesh.parse(headAb);
    const hairAb = readArrayBuffer('avatar/hair/women09_00.bin');
    const style = HairStyle.parse(hairAb);
    assert.ok(style.vertexCount > 100);
    assert.ok(style.faceCount > 100);

    const fitted = style.fitOn(head, HAIR_SHADES[0].colours);
    assert.ok(fitted.vertexCount > head.nHead);
    const recoloured = recolourHair(fitted, HAIR_SHADES[0].colours, HAIR_SHADES[4].colours);
    assert.equal(recoloured.vertexCount, fitted.vertexCount);
  });

  it('parses JCH1/JCH2 3D textured characters (Adam & Mei)', () => {
    for (const charId of ['adam', 'mei']) {
      const meta = JSON.parse(
        fs.readFileSync(path.join(ASSETS_DIR, `avatar/characters/${charId}/meta.json`), 'utf8')
      );
      const bin = readArrayBuffer(`avatar/characters/${charId}/mesh.bin`);
      const ch = CharacterMesh.parse(bin, meta, null);
      assert.ok(ch.vertexCount > 1000);
      assert.ok(ch.faceCount > 1000);
    }
  });

  it('computes French visemes from text and F1/F2 formants from 24kHz PCM audio', () => {
    const seq = textToVisemes('Bonjour Jarvis, quelle est la météo sur Bordeaux ?');
    assert.ok(seq.length > 10);

    const stream = new VisemeStream();
    stream.feedText('Bonjour');
    const frames = stream.frames([{ level: 0.6, open: 0.4, wide: 0.1 }]);
    assert.equal(frames.length, 1);
    assert.ok(frames[0].open >= 0);

    const pcm = new Float32Array(2400);
    for (let i = 0; i < pcm.length; i++) {
      pcm[i] = 0.4 * Math.sin((2 * Math.PI * 600 * i) / 24000) + 0.2 * Math.sin((2 * Math.PI * 1800 * i) / 24000);
    }
    const audioVis = pcmVisemes(pcm, 24000);
    assert.ok(audioVis.length > 0);
    assert.ok(audioVis[0].level > 0);
  });

  it('parses Natural Earth binary world map (land.bin, borders.bin, cities.tsv) and computes orbits/astronomy', () => {
    const land = parseMapRings(readArrayBuffer('sky/land.bin'));
    const borders = parseMapRings(readArrayBuffer('sky/borders.bin'));
    const cities = parseCities(fs.readFileSync(path.join(ASSETS_DIR, 'sky/cities.tsv'), 'utf8'));

    assert.ok(land.length > 50);
    assert.ok(borders.length > 20);
    assert.ok(cities.length > 50);

    const now = Date.now();
    const issState = satelliteStateAt(DEFAULT_SATELLITES[0], now);
    assert.ok(issState.lat >= -55 && issState.lat <= 55);

    const bodies = solarSystemObjects({ latDeg: 44.8378, lonDeg: -0.5792 }, now);
    assert.ok(bodies.length >= 7);

    const phase = moonPhase(now);
    assert.ok(phase.lit >= 0 && phase.lit <= 1);
  });

  it('normalizes live ADS-B aircraft into selectable flight telemetry', () => {
    const plane = normalizeAircraft({
      hex: 'a0b1c2', flight: 'AFR123', lat: 44.8, lon: -0.6, alt_baro: 35000,
      gs: 420, track: 180, baro_rate: -512, t: 'A320', r: 'F-GKXY', squawk: '7000', messages: 1300,
    }, 'adsb.fi');
    assert.equal(plane.icao24, 'a0b1c2');
    assert.equal(plane.category, 'commercial');
    assert.equal(plane.altitudeM, 35000 * 0.3048);
    assert.equal(plane.speedKnots, 420);
    assert.equal(plane.verticalRateFpm, -512);
    assert.ok(haversineDistanceKm(44.84, -0.58, 48.86, 2.35) > 400);
  });

  it('parses live TLE catalog lines and propagates a selectable satellite position', () => {
    const tle = [
      'ISS (ZARYA)',
      '1 25544U 98067A   24146.40251785  .00015505  00000-0  27885-3 0  9997',
      '2 25544  51.6402 189.7042 0004381 334.8091 106.8778 15.50091157455243',
    ].join('\n');
    const [iss] = parseTleCatalog(tle, 'science');
    assert.equal(iss.norad, 25544);
    assert.equal(iss.name, 'ISS (ZARYA)');
    assert.ok(iss.meanMotionRevDay > 15);
    assert.ok(iss.apogeeAltKm > iss.perigeeAltKm);
    const position = tleStateAt(iss, iss.epoch + 60 * 60_000);
    assert.ok(position.lat >= -90 && position.lat <= 90);
    assert.ok(position.lon >= -180 && position.lon <= 180);
    assert.ok(position.altKm > 200 && position.altKm < 1000);
  });

  it('validates all 82 bundled JSON plugins', () => {
    const index = JSON.parse(fs.readFileSync(path.join(ASSETS_DIR, 'plugins/index.json'), 'utf8'));
    assert.equal(index.length, 82);
    for (const entry of index) {
      const spec = entry.spec || entry;
      assert.ok(spec.name, `Plugin ${entry.fileName} has name`);
      assert.ok(spec.description, `Plugin ${entry.fileName} has description`);
    }
  });

  it('validates hostBridge methods required by App, ConfigStore, ToolRegistry, and PCControlPanel', async () => {
    assert.equal(typeof hostBridge.onPushToTalk, 'function');
    const unsub = hostBridge.onPushToTalk(() => {});
    assert.equal(typeof unsub, 'function');
    unsub();

    const sys = await hostBridge.getSystemInfo();
    assert.ok(sys.cpuCores > 0);
    assert.ok(typeof sys.cpuUsagePercent === 'number');
    assert.ok(typeof sys.memUsagePercent === 'number');

    const dev = await hostBridge.setDeviceSetting({ setting: 'volume', value: 50 });
    assert.equal(dev.ok, true);

    const win = await hostBridge.windowControl({ action: 'list' });
    assert.equal(win.ok, true);
    assert.ok(Array.isArray(win.windows));
  });

  it('subdivides Classic avatar to 84,000+ polygons, generates PCB electrical circuits, and keeps only Classic/Léa/Marc', async () => {
    assert.deepEqual(
      BUILT_IN_FACES.map((f) => f.id),
      ['classic', 'lea', 'marc']
    );
    assert.equal(normalizeFaceId('female01'), 'lea');
    assert.equal(normalizeFaceId('male02'), 'marc');
    assert.equal(normalizeFaceId('char:adam'), 'classic');
    assert.equal(normalizeFaceId('char:mei'), 'classic');
    assert.equal(normalizeFaceId('cartoon'), 'classic');

    const classicAb = readArrayBuffer('avatar/head_mesh.bin');
    const baseClassic = HeadMesh.parse(classicAb);
    const ecoClassic = HeadMesh.applyPolygonLevel(baseClassic, 'eco');
    const lowClassic = HeadMesh.applyPolygonLevel(baseClassic, 'low');
    const medClassic = HeadMesh.applyPolygonLevel(baseClassic, 'medium');
    const highClassic = HeadMesh.applyPolygonLevel(baseClassic, 'high');
    const ultraClassic = HeadMesh.applyPolygonLevel(baseClassic, 'ultra');

    assert.equal(POLYGON_LEVELS.length, 5);
    assert.ok(ecoClassic.faceCount < lowClassic.faceCount, 'eco < low polygons');
    assert.ok(lowClassic.faceCount < medClassic.faceCount, 'low < medium polygons');
    assert.ok(medClassic.faceCount < highClassic.faceCount, 'medium < high polygons');
    assert.ok(highClassic.faceCount > 80000, `Expected >80,000 polygons on high Classic, got ${highClassic.faceCount}`);
    assert.ok(ultraClassic.faceCount > 140000, `Expected >140,000 polygons on ultra Classic, got ${ultraClassic.faceCount}`);

    const circuits = new CircuitTraces(highClassic);
    assert.ok(circuits.trackCount > 50, `Expected >50 circuit tracks, got ${circuits.trackCount}`);
    assert.ok(circuits.segments.length > 500, 'Expected >500 circuit segment endpoints');
    assert.ok(circuits.pads.length > 100, 'Expected >100 circuit pads');

    const web = new NetworkWeb(highClassic);
    assert.ok(web.count > 5000, `Expected >5,000 polygon web nodes, got ${web.count}`);
    assert.ok(web.edges.length > 20000, 'Expected >20,000 polygon web edge endpoints');

    assert.equal(ALL_VOICES.length, 30);
    for (const v of ALL_VOICES) {
      const prof = VOICE_PROFILES[v];
      assert.ok(prof, `Voice ${v} has acoustic profile`);
      assert.ok(prof.gender === 'female' || prof.gender === 'male');
    }

    configStore.update({
      avatarFaceId: 'classic',
      avatarSkin: 7,
      avatarCircuits: false,
      avatarPolygonLevel: 'low',
      voiceName: 'Fenrir',
    });
    assert.equal(configStore.get().avatarFaceId, 'classic');
    assert.equal(configStore.get().avatarSkin, 7);
    assert.equal(configStore.get().avatarCircuits, false);
    assert.equal(configStore.get().avatarPolygonLevel, 'low');
    assert.equal(configStore.get().voiceName, 'Fenrir');
  });

  it('checks bundled plugin definitions, parameter placeholders, desktop routines and JSON/index sync', () => {
    const index = JSON.parse(fs.readFileSync(path.join(ASSETS_DIR, 'plugins/index.json'), 'utf8'));
    const tools = new Set([...new ToolRegistry().tools.keys()]);
    assert.equal(index.length, 82);
    for (const entry of index) {
      const spec = entry.spec || entry;
      assert.ok(spec.name && spec.description, `Plugin ${entry.fileName} has metadata`);
      const disk = JSON.parse(fs.readFileSync(path.join(ASSETS_DIR, `plugins/${entry.fileName}`), 'utf8'));
      assert.deepEqual(spec, disk, `${spec.name} index entry matches its JSON file`);
      const declared = new Set((spec.parameters || []).map((p) => p.name));
      const templates = [spec.url, spec.uri, spec.body, spec.body_template, ...(spec.steps || []).flatMap((step) => Object.values(step.args || {}))]
        .filter((value) => typeof value === 'string').join(' ');
      for (const [, key] of templates.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)) {
        assert.ok(declared.has(key), `${spec.name} uses declared placeholder ${key}`);
      }
      if (spec.type === 'routine') {
        assert.ok(spec.steps?.length > 0, `${spec.name} has routine steps`);
        for (const step of spec.steps) assert.ok(tools.has(step.tool), `${spec.name} uses PC tool ${step.tool}`);
      }
      if (spec.type === 'http') assert.ok(spec.url.startsWith('https://'), `${spec.name} uses HTTPS`);
    }
  });

  it('keeps the app, lockfile and GitHub release tag on the bumped package version', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
    const lock = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package-lock.json'), 'utf8'));
    const workflow = fs.readFileSync(path.resolve(process.cwd(), '.github/workflows/build-exe.yml'), 'utf8');
    const app = fs.readFileSync(path.resolve(process.cwd(), 'src/App.jsx'), 'utf8');
    assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
    assert.notEqual(pkg.version, '2.0.0', 'new release increments the previous 2.0.0 tag');
    assert.equal(lock.version, pkg.version);
    assert.equal(lock.packages[''].version, pkg.version);
    assert.match(app, /v\{packageJson\.version\}/);
    assert.match(workflow, /node -p "require\('\.\/package\.json'\)\.version"/);
    assert.match(workflow, /gh release create \$tag/);
    assert.doesNotMatch(workflow, /gh release create v2\.0\.0/);
  });

  it('formats nested JSON, array fields, and missing required plugin parameters safely', async () => {
    const engine = new PluginEngine();
    engine.loaded = true;
    engine.catalog = [{
      name: 'meteo_test', description: 'Météo de test.', type: 'http',
      parameters: [{ name: 'ville', description: 'Ville requise', required: true }],
      url: 'https://example.com/weather?city={ville}', result_fields: ['current.temperature', 'current.wind_speed'],
    }];
    const originalFetch = hostBridge.httpFetch;
    const calls = [];
    hostBridge.httpFetch = async (payload) => {
      calls.push(payload);
      return { ok: true, status: 200, text: '{"current":{"temperature":21,"wind_speed":9}}', json: { current: { temperature: 21, wind_speed: 9 } } };
    };
    try {
      const missing = await engine.runPlugin('meteo_test', {});
      assert.match(missing, /ville/);
      const result = await engine.runPlugin('meteo_test', { ville: 'Saint Étienne' });
      assert.match(calls[0].url, /Saint%20%C3%89tienne/);
      assert.match(result, /temperature : 21/);
      assert.match(result, /wind_speed : 9/);
      assert.match(result, /Données externes/);
      assert.equal(engine.formatResponse({ result_items: 'rows', result_fields: ['name', 'nested.value'] }, '', { rows: [{ name: 'Avion', nested: { value: 12 } }] }), '1. Avion — 12');
      assert.match(engine.formatResponse({ name: 'wikipedia_recherche' }, '', ['Jarvis', ['Jarvis'], ['Assistant personnel'], ['https://fr.wikipedia.org/wiki/Jarvis']]), /Assistant personnel/);
      assert.match(engine.formatResponse({ name: 'asteroides_du_jour' }, '', { near_earth_objects: { today: [{ name: '2026 AB', close_approach_data: [{ close_approach_date: '2026-09-29', miss_distance: { kilometers: '123456' } }], estimated_diameter: { kilometers: { estimated_diameter_max: 0.3 } } }] } }), /2026 AB.*123.456 km/);
    } finally {
      hostBridge.httpFetch = originalFetch;
    }
  });
});
