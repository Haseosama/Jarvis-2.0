// Présence devant l'écran, à partir du NOMBRE de visages vus par la caméra (aucune identification, aucune image conservée).
// Le suivi lisse les mesures pour ne pas clignoter : présent après 2 mesures positives, absent après 5 s sans visage ;
// « plusieurs personnes » (mode vie privée) après 2 mesures à 2 visages ou plus, levé après 3 s sans.

export const ABSENT_AFTER_MS = 5000;
export const MULTI_CLEAR_MS = 3000;

export class PresenceTracker {
  constructor({ absentAfterMs = ABSENT_AFTER_MS, multiClearMs = MULTI_CLEAR_MS } = {}) {
    this.absentAfterMs = absentAfterMs;
    this.multiClearMs = multiClearMs;
    this.state = { present: false, count: 0, multiple: false };
    this.hits = 0;
    this.multiHits = 0;
    this.lastSeen = 0;
    this.lastMulti = 0;
  }

  /** Une mesure : nombre de visages à l'instant `now`. Retourne { state, events } où events ⊂ ['arrived','left','multiple','alone']. */
  push(count, now) {
    const events = [];
    const prev = { ...this.state };
    const n = Math.max(0, Math.floor(Number(count) || 0));
    if (n > 0) { this.hits++; this.lastSeen = now; } else this.hits = 0;
    if (n >= 2) { this.multiHits++; this.lastMulti = now; } else this.multiHits = 0;

    let present = this.state.present;
    if (!present && this.hits >= 2) present = true;
    if (present && n === 0 && now - this.lastSeen >= this.absentAfterMs) present = false;

    let multiple = this.state.multiple;
    if (!multiple && this.multiHits >= 2) multiple = true;
    if (multiple && n < 2 && now - this.lastMulti >= this.multiClearMs) multiple = false;
    if (!present) multiple = false;

    this.state = { present, count: present ? n : 0, multiple };
    if (present && !prev.present) events.push('arrived');
    if (!present && prev.present) events.push('left');
    if (multiple && !prev.multiple) events.push('multiple');
    if (!multiple && prev.multiple && present) events.push('alone');
    return { state: this.state, events };
  }
}
