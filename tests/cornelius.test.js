import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { validateArgs } from '../src/actions/argValidation.js';
import { describeTime, resolveZone } from '../src/core/worldClock.js';
import { describeDepartures, mapDepartures, mapPlaces, parisToEpoch, runTransit } from '../src/integrations/transit.js';
import { ToolRegistry } from '../src/actions/ToolRegistry.js';

const require = createRequire(import.meta.url);
const { guardedFetch, nextHop } = require('../electron/httpGuard.cjs');

describe('arguments typés des outils', () => {
  const params = {
    properties: {
      n: { type: 'NUMBER', minimum: 1, maximum: 10 },
      ok: { type: 'BOOLEAN' },
      mode: { type: 'STRING', enum: ['jour', 'nuit'] },
    },
  };
  it('convertit sans ambiguïté', () => {
    assert.deepEqual(validateArgs(params, { n: '7', ok: 'oui', mode: 'JOUR' }).args, { n: 7, ok: true, mode: 'jour' });
  });
  it('refuse avec une phrase claire', () => {
    assert.match(validateArgs(params, { n: 11 }).error, /au plus 10/);
    assert.match(validateArgs(params, { n: 'beaucoup' }).error, /nombre est attendu/);
    assert.match(validateArgs(params, { ok: 'peut-être' }).error, /oui ou non/);
    assert.match(validateArgs(params, { mode: 'soir' }).error, /jour, nuit/);
  });
  it('laisse passer l’absence et les paramètres inconnus', () => {
    assert.deepEqual(validateArgs(params, { autre: 1 }).args, { autre: 1 });
    assert.equal(validateArgs(undefined, { a: 1 }).args.a, 1);
  });
  it('le registre refuse un argument invalide sans lancer l’outil', async () => {
    const reg = new ToolRegistry({});
    let ran = 0;
    reg.register({ name: 't', description: '', parameters: { type: 'OBJECT', properties: { n: { type: 'NUMBER', maximum: 3 } } }, run: async () => { ran++; return 'ok'; } });
    assert.match(await reg.execute('t', { n: 9 }), /status=failed/);
    assert.equal(ran, 0);
    assert.equal(await reg.execute('t', { n: '2' }), 'ok');
  });
});

describe('heure dans le monde', () => {
  it('résout villes et fuseaux, refuse l’inconnu', () => {
    assert.equal(resolveZone('Tokyo'), 'Asia/Tokyo');
    assert.equal(resolveZone('New York'), 'America/New_York');
    assert.equal(resolveZone('Asia/Tokyo'), 'Asia/Tokyo');
    assert.equal(resolveZone('Narnia'), null);
    assert.equal(resolveZone(''), 'Europe/Paris');
  });
  it('indique le décalage de jour', () => {
    const date = new Date('2026-10-21T20:30:00Z'); // 22 h 30 à Paris (CEST), 5 h 30 le lendemain à Tokyo
    assert.match(describeTime('Tokyo', date), /lendemain par rapport à Paris/);
    assert.doesNotMatch(describeTime('Berlin', date), /lendemain|veille/);
    assert.match(describeTime('Los Angeles', date), /Los Angeles/);
  });
});

describe('transports (PRIM)', () => {
  it('convertit l’heure locale de Paris, heure d’été et d’hiver', () => {
    assert.equal(new Date(parisToEpoch('20261021T143000')).toISOString(), '2026-10-21T12:30:00.000Z');
    assert.equal(new Date(parisToEpoch('20261231T143000')).toISOString(), '2026-12-31T13:30:00.000Z');
    assert.equal(parisToEpoch('n’importe quoi'), null);
  });
  const body = {
    departures: [
      { display_informations: { label: '102', direction: 'Gare' }, stop_date_time: { departure_date_time: '20261021T143500', base_departure_date_time: '20261021T143000', data_freshness: 'realtime' } },
      { display_informations: { label: '115', direction: 'Mairie' }, stop_date_time: { departure_date_time: '20261021T144500', data_freshness: 'base_schedule' } },
      { display_informations: { label: '102', direction: 'Gare' }, additional_informations: ['deleted'], stop_date_time: { departure_date_time: '20261021T145500' } },
    ],
  };
  it('décrit les passages, horaire théorique et supprimés compris', () => {
    const now = parisToEpoch('20261021T143000');
    const text = describeDepartures(mapDepartures(body), 'maison', now);
    assert.match(text, /ligne 102 direction Gare dans 5 min\./);
    assert.match(text, /Ensuite 115 dans 15 min/);
    assert.match(text, /1 passage supprimé/);
    assert.match(describeDepartures(mapDepartures(body), 'maison', parisToEpoch('20261021T160000')), /Aucun passage prévu/);
    assert.match(describeDepartures([{ at: now + 60000, realtime: false, cancelled: false, line: '9', direction: '' }], 'x', now), /horaire théorique/);
  });
  it('liste les arrêts proposés', () => {
    const places = mapPlaces({ places: [{ id: 'stop_area:IDFM:1', embedded_type: 'stop_area', name: 'Mairie', stop_area: { label: 'Mairie (Montreuil)' }, administrative_regions: [{ name: 'Montreuil' }] }, { id: 'poi:2', embedded_type: 'poi' }] });
    assert.deepEqual(places, [{ id: 'stop_area:IDFM:1', label: 'Mairie (Montreuil)', city: 'Montreuil' }]);
  });
  it('outil : jeton manquant, ajout, passage, erreurs claires', async () => {
    let list = [];
    const store = { get: () => list, set: (l) => { list = l; } };
    const calls = [];
    const fetcher = async (r) => { calls.push(r); return { ok: true, status: 200, json: body }; };
    assert.match(await runTransit({ action: 'next' }, { token: '', fetcher, store }), /jeton PRIM manquant/);
    assert.match(await runTransit({ action: 'add', stop_id: 'poi:x', name: 'a' }, { token: 't', fetcher, store }), /stop_id invalide/);
    assert.match(await runTransit({ action: 'add', stop_id: 'stop_area:IDFM:1', name: 'maison' }, { token: 't', fetcher, store }), /status=done/);
    const out = await runTransit({ action: 'next', name: 'maison' }, { token: 't', fetcher, store, now: () => parisToEpoch('20261021T143000') });
    assert.match(out, /ligne 102/);
    assert.equal(calls[0].headers.apikey, 't');
    assert.match(calls[0].url, /stop_areas\/stop_area:IDFM:1\/departures/);
    const down = await runTransit({ action: 'next' }, { token: 't', fetcher: async () => ({ ok: false, status: 429 }), store });
    assert.match(down, /Quota PRIM dépassé/);
    assert.doesNotMatch(down, /Aucun passage/);
  });
});

describe('client HTTP protégé', () => {
  it('ne suit jamais https vers http et retire les jetons vers un autre site', () => {
    const cur = new URL('https://a.example/x');
    assert.match(nextHop(cur, 'http://a.example/y', {}).error, /https vers http/);
    assert.match(nextHop(cur, 'ftp://a.example/y', {}).error, /protocole/);
    const same = nextHop(cur, '/z', { apikey: 'k', Accept: 'a' });
    assert.deepEqual(same.headers, { apikey: 'k', Accept: 'a' });
    const other = nextHop(cur, 'https://b.example/z', { apikey: 'k', Authorization: 'Bearer t', Accept: 'a' });
    assert.deepEqual(other.headers, { Accept: 'a' });
  });
  const fakeRes = (status, headers, text) => ({ status, ok: status < 300, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, body: null, arrayBuffer: async () => Buffer.from(text) });
  it('suit trois redirections au plus', async () => {
    let n = 0;
    const loop = async () => fakeRes(302, { location: `/${++n}` }, '');
    const r = await guardedFetch('https://a.example/', { fetchImpl: loop });
    assert.match(r.error, /Trop de redirections/);
    assert.equal(n, 4);
  });
  it('suit une redirection puis coupe et signale une réponse trop grosse', async () => {
    const seq = [fakeRes(301, { location: '/final' }, ''), fakeRes(200, {}, 'x'.repeat(100))];
    const r = await guardedFetch('https://a.example/', { fetchImpl: async () => seq.shift(), maxBytes: 10 });
    assert.equal(r.buffer.length, 10);
    assert.equal(r.truncated, true);
  });
  it('une redirection sur POST est signalée, pas rejouée', async () => {
    const r = await guardedFetch('https://a.example/', { method: 'POST', body: 'x', fetchImpl: async () => fakeRes(302, { location: '/ailleurs' }, '') });
    assert.match(r.error, /adresse finale/);
  });
});
