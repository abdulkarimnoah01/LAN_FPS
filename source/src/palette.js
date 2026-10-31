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

export function initPalette() {
  let id = 'red';
  try { id = localStorage.getItem(KEY) || id; } catch {}
  apply(id);
  document.getElementById('btn-palette')?.addEventListener('click', () => {
    const i = PALETTES.findIndex(p => p[0] === document.documentElement.dataset.palette);
    apply(PALETTES[(i + 1) % PALETTES.length][0]);
  });
}
