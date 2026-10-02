import { HeadMesh } from './HeadMesh.js';

const meshCache = new Map();

/** Loads and caches a head mesh asset (shared by the avatar view and the polygon editor). */
export async function loadHeadMesh(url) {
  if (meshCache.has(url)) return meshCache.get(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch mesh: ${url}`);
  const buf = await res.arrayBuffer();
  const parsed = HeadMesh.parse(buf);
  meshCache.set(url, parsed);
  return parsed;
}
