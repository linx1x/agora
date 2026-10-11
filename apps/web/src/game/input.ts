/** Keyboard state for movement, ignored while typing or when a dialog is open. */
const down = new Set<string>();
const MOVE_KEYS: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  KeyW: [0, -1],
  ArrowDown: [0, 1],
  KeyS: [0, 1],
  ArrowLeft: [-1, 0],
  KeyA: [-1, 0],
  ArrowRight: [1, 0],
  KeyD: [1, 0],
};

export function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable ||
    !!el.closest('[role="dialog"]')
  );
}

let installed = false;
export function installInput() {
  if (installed) return;
  installed = true;
  window.addEventListener('keydown', (e) => {
    if (isTyping() || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code in MOVE_KEYS) {
      down.add(e.code);
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => down.delete(e.code));
  window.addEventListener('blur', () => down.clear());
  document.addEventListener('visibilitychange', () => down.clear());
}

/** Virtual joystick direction (P8.2): a unit vector, or [0, 0] when released. */
let stick: [number, number] = [0, 0];
export function setStick(x: number, y: number) {
  stick = [x, y];
}

export function inputVector(): [number, number] {
  if (isTyping()) {
    down.clear();
    return [0, 0];
  }
  let x = 0;
  let y = 0;
  for (const k of down) {
    const v = MOVE_KEYS[k];
    if (v) {
      x += v[0];
      y += v[1];
    }
  }
  // keys win over the joystick; the joystick gives a unit vector (same speed as keys)
  if (!x && !y) return [stick[0], stick[1]];
  return [Math.sign(x), Math.sign(y)];
}

/** Test/automation hook: simulate held directions. */
export function setHeld(codes: string[]) {
  down.clear();
  for (const c of codes) down.add(c);
}
