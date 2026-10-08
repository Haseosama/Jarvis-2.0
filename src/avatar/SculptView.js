// Dessin 2D de l'éditeur de polygones (aucune dépendance au DOM : testable avec n'importe quel contexte 2D).
import { isVertexVisible, trianglePoints } from './MeshSculpt.js';

export const SCULPT_COLOURS = {
  background: '#050c18',
  skin: [128, 176, 200],
  wire: 'rgba(210, 240, 255, 0.42)',
  point: 'rgba(160, 230, 255, 0.85)',
  selected: '#ffb300',
  soft: '#22d3ee',
  hover: '#ffffff',
};

/**
 * opts : { topo, mode: 'both'|'solid'|'wire', showPoints, selection:Set, soft:Map|null,
 *          hoverVertex:int, hoverTriangle:int, box:[x0,y0,x1,y1]|null }
 */
export function drawSculptScene(ctx, scene, opts) {
  const { cam, proj, front, shade, depth, tris } = scene;
  const { topo, mode = 'both', showPoints = true, selection = new Set(), soft = null, hoverVertex = -1, hoverTriangle = -1, box = null } = opts;
  ctx.fillStyle = SCULPT_COLOURS.background;
  ctx.fillRect(0, 0, cam.width, cam.height);

  const nTri = tris.length / 3;
  const order = [];
  for (let t = 0; t < nTri; t++) if (front[t]) order.push(t);
  order.sort((a, b) => depth[a] - depth[b]); // peintre : du plus loin au plus proche

  const selectedTri = (t) => {
    const [a, b, c] = trianglePoints(topo, t);
    return selection.has(a) && selection.has(b) && selection.has(c);
  };

  if (mode !== 'wire') {
    const [sr, sg, sb] = SCULPT_COLOURS.skin;
    for (const t of order) {
      const a = tris[3 * t]; const b = tris[3 * t + 1]; const c = tris[3 * t + 2];
      const k = 0.28 + 0.72 * shade[t];
      ctx.fillStyle = selectedTri(t) ? `rgb(${Math.round(255 * k)},${Math.round(170 * k)},${Math.round(40 * k)})` : `rgb(${Math.round(sr * k)},${Math.round(sg * k)},${Math.round(sb * k)})`;
      ctx.beginPath();
      ctx.moveTo(proj[3 * a], proj[3 * a + 1]);
      ctx.lineTo(proj[3 * b], proj[3 * b + 1]);
      ctx.lineTo(proj[3 * c], proj[3 * c + 1]);
      ctx.closePath();
      ctx.fill();
    }
  }

  if (mode !== 'solid') {
    ctx.strokeStyle = SCULPT_COLOURS.wire;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (const t of order) {
      const a = tris[3 * t]; const b = tris[3 * t + 1]; const c = tris[3 * t + 2];
      ctx.moveTo(proj[3 * a], proj[3 * a + 1]);
      ctx.lineTo(proj[3 * b], proj[3 * b + 1]);
      ctx.lineTo(proj[3 * c], proj[3 * c + 1]);
      ctx.closePath();
    }
    ctx.stroke();
  }

  if (hoverTriangle >= 0 && front[hoverTriangle]) {
    const a = tris[3 * hoverTriangle]; const b = tris[3 * hoverTriangle + 1]; const c = tris[3 * hoverTriangle + 2];
    ctx.strokeStyle = SCULPT_COLOURS.hover;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(proj[3 * a], proj[3 * a + 1]);
    ctx.lineTo(proj[3 * b], proj[3 * b + 1]);
    ctx.lineTo(proj[3 * c], proj[3 * c + 1]);
    ctx.closePath();
    ctx.stroke();
  }

  // Zone d'influence douce (taille et opacité = poids)
  if (soft) {
    ctx.fillStyle = SCULPT_COLOURS.soft;
    for (const [r, w] of soft) {
      if (selection.has(r) || w < 0.05 || !isVertexVisible(scene, r)) continue;
      ctx.globalAlpha = 0.25 + 0.6 * w;
      ctx.beginPath();
      ctx.arc(proj[3 * r], proj[3 * r + 1], 1.2 + 2.2 * w, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  if (showPoints) {
    ctx.fillStyle = SCULPT_COLOURS.point;
    for (const r of topo.reps) {
      if (selection.has(r) || !isVertexVisible(scene, r)) continue;
      ctx.fillRect(proj[3 * r] - 1, proj[3 * r + 1] - 1, 2, 2);
    }
  }

  ctx.fillStyle = SCULPT_COLOURS.selected;
  for (const r of selection) {
    if (!isVertexVisible(scene, r)) continue;
    ctx.beginPath();
    ctx.arc(proj[3 * r], proj[3 * r + 1], 3.2, 0, Math.PI * 2);
    ctx.fill();
  }

  if (hoverVertex >= 0) {
    ctx.strokeStyle = SCULPT_COLOURS.hover;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(proj[3 * hoverVertex], proj[3 * hoverVertex + 1], 6, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (box) {
    ctx.strokeStyle = SCULPT_COLOURS.selected;
    ctx.fillStyle = 'rgba(255, 179, 0, 0.12)';
    ctx.lineWidth = 1;
    ctx.setLineDash?.([5, 4]);
    ctx.fillRect(Math.min(box[0], box[2]), Math.min(box[1], box[3]), Math.abs(box[2] - box[0]), Math.abs(box[3] - box[1]));
    ctx.strokeRect(Math.min(box[0], box[2]), Math.min(box[1], box[3]), Math.abs(box[2] - box[0]), Math.abs(box[3] - box[1]));
    ctx.setLineDash?.([]);
  }
}
