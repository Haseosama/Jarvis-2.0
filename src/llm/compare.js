// Comparateur de modèles : même invite envoyée en parallèle, classement Elo purement local.
import { callModel } from './providers.js';

export const ELO_START = 1000;
export const ELO_K = 24;

/** Probabilité de victoire attendue de A contre B. */
export function expectedScore(a, b) {
  return 1 / (1 + 10 ** ((b - a) / 400));
}

/**
 * Applique le vote « winner est meilleur que chacun des autres ». Renvoie un NOUVEL objet de classement.
 * `keys` = tous les participants du duel.
 */
export function applyVote(ratings, winner, keys) {
  const next = { ...ratings };
  const get = (k) => next[k] || { elo: ELO_START, games: 0, wins: 0 };
  const losers = [...new Set(keys)].filter((k) => k !== winner);
  if (!keys.includes(winner) || !losers.length) return next;
  const base = Object.fromEntries([winner, ...losers].map((k) => [k, get(k).elo]));
  let winnerDelta = 0;
  for (const loser of losers) {
    const delta = ELO_K * (1 - expectedScore(base[winner], base[loser]));
    winnerDelta += delta;
    const l = get(loser);
    next[loser] = { elo: l.elo - delta, games: l.games + 1, wins: l.wins };
  }
  const w = get(winner);
  next[winner] = { elo: w.elo + winnerDelta, games: w.games + losers.length, wins: w.wins + losers.length };
  return next;
}

export function leaderboard(ratings) {
  return Object.entries(ratings || {})
    .map(([key, r]) => ({ key, elo: Math.round(r.elo), games: r.games, wins: r.wins }))
    .sort((x, y) => y.elo - x.elo);
}

/** Lance la même invite sur plusieurs modèles en parallèle. `resolve(slot)` fournit clé et URL. */
export async function runComparison({ prompt, system = '', slots, resolve, call = callModel, onResult }) {
  const list = (slots || []).slice(0, 4);
  if (list.length < 2) throw new Error('Choisissez au moins deux modèles.');
  if (!String(prompt || '').trim()) throw new Error('Saisissez une invite.');
  return Promise.all(
    list.map(async (slot) => {
      const result = await call({ ...resolve(slot), system, messages: [{ role: 'user', content: prompt }] });
      const entry = { slot, ...result };
      onResult?.(entry);
      return entry;
    }),
  );
}
