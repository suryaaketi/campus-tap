// Phone bottom sheet in the style of Apple Maps: the map fills the screen and this panel rests at one of
// three heights. Drag the handle area to move it; a short tap steps it up a height.
// On wider screens the panel is a fixed sidebar and every call here does nothing.

export const DETENTS = ['peek','medium','large'];
const TOP_GAP = 52;   // map left visible above the sheet at its tallest
const EASE = 'transform .5s cubic-bezier(.32,.72,0,1)';

// Pick the resting height nearest to where a drag would carry the sheet.
export function nearestDetent(offsets, position, velocity = 0) {
  const projected = position + velocity * 180;
  return DETENTS.reduce((best,name) => Math.abs(offsets[name] - projected) < Math.abs(offsets[best] - projected) ? name : best, DETENTS[0]);
}

// Offsets are distances from the top of the screen to the top of the sheet, so larger means lower.
export function detentOffsets(viewport, peekVisible) {
  const large = TOP_GAP;
  const peek = Math.max(large, viewport - Math.min(viewport * 0.7, Math.max(120, peekVisible)));
  const medium = Math.max(large, Math.min(peek, Math.round(viewport * 0.44)));
  return { peek, medium, large };
}

export function createSheet(sheet, grab, { query = '(max-width:700px)', root = document.documentElement } = {}) {
  const media = matchMedia(query);
  let detent = 'medium', offset = 0, drag = null;
  const viewport = () => window.innerHeight;
  // The lowest height still shows what matters right now: where the tag says you are, the Start button, or the walk controls.
  function peekVisible() {
    const body = document.body, route = document.getElementById('route-view');
    const selector = body.classList.contains('walking') ? '#walk-controls' : route && !route.hidden ? '.route-actions' : '.origin-card';
    const anchor = sheet.querySelector(selector);
    if (!anchor || !anchor.offsetParent) return 180;
    return anchor.getBoundingClientRect().bottom - sheet.getBoundingClientRect().top + sheet.scrollTop + 18;
  }
  const offsets = () => detentOffsets(viewport(), peekVisible());
  function apply(y, animate) {
    offset = y;
    sheet.style.transition = animate ? EASE : 'none';
    sheet.style.transform = `translate3d(0,${Math.round(y)}px,0)`;
    root.style.setProperty('--sheet-visible', `${Math.max(0, viewport() - y)}px`);
    root.style.setProperty('--sheet-hidden', `${Math.max(0, y - TOP_GAP)}px`);
  }
  function clear() {
    sheet.style.transform = sheet.style.transition = '';
    root.style.removeProperty('--sheet-visible'); root.style.removeProperty('--sheet-hidden');
  }
  const api = {
    active: () => media.matches,
    get detent() { return detent; },
    // Height of map the sheet covers once it settles; used to frame routes above it.
    visible: () => media.matches ? Math.max(0, viewport() - offsets()[detent]) : 0,
    snap(name = detent, animate = true) {
      if (!media.matches) return;
      if (name !== detent || name === 'peek') sheet.scrollTo({ top: 0 });
      detent = DETENTS.includes(name) ? name : 'medium';
      sheet.dataset.detent = detent;
      apply(offsets()[detent], animate);
    },
    refresh() { api.snap(detent, true); }
  };

  grab.addEventListener('pointerdown', event => {
    if (!media.matches || event.button > 0 || event.target.closest('a,button,select,input')) return;
    const now = performance.now();
    drag = { startY: event.clientY, start: offset, lastY: event.clientY, lastT: now, velocity: 0, moved: false };
    grab.setPointerCapture(event.pointerId);
    root.classList.add('sheet-dragging');
  });
  grab.addEventListener('pointermove', event => {
    if (!drag) return;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dy) > 5) drag.moved = true;
    if (!drag.moved) return;
    const o = offsets(); let y = drag.start + dy;
    if (y < o.large) y = o.large - (o.large - y) * 0.2;   // resist past the ends, like iOS
    if (y > o.peek) y = o.peek + (y - o.peek) * 0.2;
    const now = performance.now();
    drag.velocity = (event.clientY - drag.lastY) / Math.max(1, now - drag.lastT);
    drag.lastY = event.clientY; drag.lastT = now;
    apply(y, false);
  });
  const release = () => {
    if (!drag) return;
    const { moved, velocity } = drag; drag = null;
    root.classList.remove('sheet-dragging');
    if (!moved) { api.snap(detent === 'peek' ? 'medium' : detent === 'medium' ? 'large' : 'medium'); return; }
    api.snap(nearestDetent(offsets(), offset, velocity));
  };
  grab.addEventListener('pointerup', release);
  grab.addEventListener('pointercancel', release);
  grab.addEventListener('lostpointercapture', release);

  let resizeFrame = 0;
  window.addEventListener('resize', () => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(() => media.matches ? api.snap(detent, false) : clear()); });
  media.addEventListener('change', () => media.matches ? api.snap(detent, false) : clear());
  return api;
}
