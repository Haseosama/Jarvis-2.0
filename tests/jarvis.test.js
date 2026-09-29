import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { HeadMesh, HairStyle, CharacterMesh, HAIR_SHADES, BUILT_IN_FACES, recolourHair } from '../src/avatar/HeadMesh.js';
import { textToVisemes, VisemeStream, pcmVisemes, HoloAvatar } from '../src/avatar/Visemes.js';
import {
  parseMapRings,
  parseCities,
  solarSystemObjects,
  satelliteStateAt,
  DEFAULT_SATELLITES,
  moonPhase,
} from '../src/space/SpaceEngine.js';
import { hostBridge } from '../src/core/hostBridge.js';
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

  it('persists avatar face selection and defines distinct voice profiles for all 30 voices', async () => {
    assert.equal(normalizeFaceId('female01'), 'lea');
    assert.equal(normalizeFaceId('male02'), 'marc');
    assert.equal(normalizeFaceId('char:adam'), 'adam');
    assert.equal(normalizeFaceId('char:mei'), 'mei');

    for (const face of BUILT_IN_FACES) {
      assert.ok(face.id, 'face has id');
      assert.ok(face.gender === 'female' || face.gender === 'male', `${face.id} has gender`);
    }

    assert.equal(ALL_VOICES.length, 30);
    for (const v of ALL_VOICES) {
      const prof = VOICE_PROFILES[v];
      assert.ok(prof, `Voice ${v} has acoustic profile`);
      assert.ok(prof.gender === 'female' || prof.gender === 'male');
      assert.ok(typeof prof.pitch === 'number' && prof.pitch > 0.5 && prof.pitch < 1.5);
      assert.ok(typeof prof.rate === 'number' && prof.rate > 0.7 && prof.rate < 1.4);
    }

    configStore.update({ avatarFaceId: 'marc', voiceName: 'Fenrir' });
    assert.equal(configStore.get().avatarFaceId, 'marc');
    assert.equal(configStore.get().voiceName, 'Fenrir');
  });
});
