/* Palette switcher shared by the online and legacy menus. */
const PALETTES = [['red', 'Arasaka'], ['cyan', 'Netrunner'], ['amber', 'Neon'], ['green', 'Phosphor'], ['violet', 'Ultraviolet']];
const KEY = 'lanfps.palette';

function apply(id) {
  const [pid, name] = PALETTES.find(p => p[0] === id) || PALETTES[0];
  document.documentElement.dataset.palette = pid;
  const btn = document.getElementById('btn-palette');
  if (btn) { btn.textContent = name; btn.setAttribute('aria-label', `Colour palette: ${name}. Press to change.`); }
  try { localStorage.setItem(KEY, pid); } catch {}
}

/* `extra` palettes are prepended (the online build adds its Orbit theme); `fallback` is the
   palette used when the player never chose one. Classic calls initPalette() unchanged. */
export function initPalette(extra = [], fallback = 'red') {
  for (const p of [...extra].reverse()) if (!PALETTES.some(q => q[0] === p[0])) PALETTES.unshift(p);
  let id = fallback;
  try { id = localStorage.getItem(KEY) || id; } catch {}
  apply(id);
  document.getElementById('btn-palette')?.addEventListener('click', () => {
    const i = PALETTES.findIndex(p => p[0] === document.documentElement.dataset.palette);
    apply(PALETTES[(i + 1) % PALETTES.length][0]);
  });
}
