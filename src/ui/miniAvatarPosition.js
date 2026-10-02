export function clampMiniAvatarPosition(
  left,
  top,
  cardWidth,
  cardHeight,
  viewportWidth,
  viewportHeight,
  inset = 8
) {
  const minLeft = viewportWidth >= cardWidth + inset * 2 ? inset : 0;
  const minTop = viewportHeight >= cardHeight + inset * 2 ? inset : 0;
  const maxLeft = Math.max(minLeft, viewportWidth - cardWidth - inset);
  const maxTop = Math.max(minTop, viewportHeight - cardHeight - inset);
  return {
    left: Math.max(minLeft, Math.min(maxLeft, Number(left) || 0)),
    top: Math.max(minTop, Math.min(maxTop, Number(top) || 0)),
  };
}
