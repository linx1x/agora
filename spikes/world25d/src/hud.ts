/**
 * Shared spike chrome: options from the URL, a settings panel, live stats, nameplates as a DOM
 * overlay (screen-space, crisp at every zoom) and the scripted benchmark.
 */
import { BENCH_ROUTE, type Mob, type Sim } from './sim';

export interface Opts {
  tilt: number;
  fov: number;
  dist: number;
  bots: number;
  filter: 'nearest' | 'linear';
  scale: number;
  lights: boolean;
  shadows: boolean;
  wallH: number;
  names: boolean;
  bench: boolean;
  benchSec: number;
}

/** Options come from the query string or the hash (an artifact page keeps only the hash). */
function params(): URLSearchParams {
  return new URLSearchParams(`${location.search.slice(1)}&${location.hash.slice(1)}`);
}
function reloadWith(q: URLSearchParams) {
  location.hash = q.toString();
  location.reload();
}

export function readOpts(): Opts {
  const q = params();
  const n = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
  return {
    tilt: n('tilt', 35),
    fov: n('fov', 30),
    dist: n('dist', 16),
    bots: n('bots', 10),
    filter: q.get('filter') === 'linear' ? 'linear' : 'nearest',
    scale: n('scale', 1),
    lights: q.get('lights') !== '0',
    shadows: q.get('shadows') === '1',
    wallH: n('wallH', 1.5),
    names: q.get('names') !== '0',
    bench: q.get('bench') === '1',
    benchSec: n('sec', 15),
  };
}

export function gpuName(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
    if (!gl) return 'no WebGL';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch {
    return 'unknown';
  }
}

const CSS = `
:root{color-scheme:dark}
html,body{margin:0;height:100%;background:#10140f;overflow:hidden;font:13px/1.35 system-ui,sans-serif;color:#e8efe4}
#world{position:fixed;inset:0}
#world canvas{display:block;width:100%;height:100%;image-rendering:pixelated}
.np{position:fixed;left:0;top:0;transform:translate(-50%,-100%);padding:1px 6px;border-radius:8px;background:rgba(16,20,15,.72);font-size:12px;white-space:nowrap;pointer-events:none;will-change:transform}
.np.me{background:rgba(60,120,70,.85)}
#hud{position:fixed;left:8px;top:8px;max-width:min(360px,calc(100vw - 16px));background:rgba(16,20,15,.82);border:1px solid #2c3a2a;border-radius:10px;padding:8px 10px}
#hud h1{font-size:13px;margin:0 0 4px}
#hud .row{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:4px 0}
#hud label{display:flex;gap:4px;align-items:center}
#hud select,#hud button{font:inherit;background:#1f2a1d;color:#e8efe4;border:1px solid #3d5139;border-radius:6px;padding:2px 6px}
#hud :focus-visible{outline:2px solid #ffd36b;outline-offset:1px}
#stats{font-variant-numeric:tabular-nums;white-space:pre;font-family:ui-monospace,monospace;font-size:12px}
#result{white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:11px;max-height:30vh;overflow:auto}
#hud details summary{cursor:pointer}
`;

export class Hud {
  private frames: number[] = [];
  private work: number[] = [];
  private last = 0;
  firstFrameMs = -1;
  private plates = new Map<string, HTMLDivElement>();
  private statsEl: HTMLElement;
  private benchStart = -1;
  private benchFrames: number[] = [];
  private benchWork: number[] = [];
  private benchCalls: number[] = [];
  private done = false;
  /** filled by the view */
  calls = () => 0;
  extra = (): Record<string, number | string> => ({});

  constructor(
    public engine: 'three' | 'phaser',
    public opts: Opts,
    private sim: Sim,
  ) {
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.append(st);
    const hud = document.createElement('div');
    hud.id = 'hud';
    const sel = (k: string, label: string, vals: (string | number)[], cur: string | number) =>
      `<label>${label}<select data-k="${k}" aria-label="${label}">${vals
        .map((v) => `<option ${String(v) === String(cur) ? 'selected' : ''}>${v}</option>`)
        .join('')}</select></label>`;
    const o = opts;
    hud.innerHTML = `<h1>Agora 2.5D spike · ${engine === 'three' ? 'Three.js' : 'Phaser 4 (faked depth)'}</h1>
      <div id="stats" aria-live="off"></div>
      <details ${o.bench ? '' : 'open'}><summary>Settings</summary>
      <div class="row">${sel('tilt', 'Tilt', [30, 35, 45, 55], o.tilt)}${sel('fov', 'FOV', [20, 30, 45], o.fov)}${sel('dist', 'Distance', [10, 13, 16, 20, 26], o.dist)}</div>
      <div class="row">${sel('bots', 'Bots', [0, 10, 25, 50], o.bots)}${sel('filter', 'Pixels', ['nearest', 'linear'], o.filter)}${sel('scale', 'Render scale', [1, 0.75, 0.5, 0.33], o.scale)}</div>
      <div class="row">${sel('wallH', 'Wall height', [1, 1.5, 2], o.wallH)}${engine === 'three' ? sel('lights', 'Lights', ['1', '0'], o.lights ? '1' : '0') + sel('shadows', 'Sun shadows', ['0', '1'], o.shadows ? '1' : '0') : ''}${sel('names', 'Names', ['1', '0'], o.names ? '1' : '0')}</div>
      <div class="row"><button id="bench">Run ${o.benchSec} s benchmark</button><a href="${engine === 'three' ? 'phaser' : 'three'}.html#${params().toString()}" style="color:#9fd18b">Switch engine</a></div>
      </details>
      <div id="result"></div>`;
    document.body.append(hud);
    this.statsEl = hud.querySelector('#stats')!;
    hud.querySelectorAll('select').forEach((s) =>
      s.addEventListener('change', () => {
        const q = params();
        q.set((s as HTMLSelectElement).dataset.k!, (s as HTMLSelectElement).value);
        q.delete('bench');
        reloadWith(q);
      }),
    );
    hud.querySelector('#bench')!.addEventListener('click', () => {
      const q = params();
      q.set('bench', '1');
      reloadWith(q);
    });
    if (opts.bench) sim.setRoute(BENCH_ROUTE);
  }

  /** Called once per rendered frame by the view. */
  frame(now: number, workMs: number) {
    // performance.now() counts from navigation start, so this is "time to first frame"
    if (this.firstFrameMs < 0) {
      this.firstFrameMs = performance.now();
      if (parent !== window) parent.postMessage({ type: 'agora-bench-ready', engine: this.engine }, '*');
    }
    if (this.last) {
      const dt = now - this.last;
      this.frames.push(dt);
      if (this.frames.length > 120) this.frames.shift();
      if (this.benchStart > 0 && !this.done) {
        this.benchFrames.push(dt);
        this.benchWork.push(workMs);
        this.benchCalls.push(this.calls());
      }
    }
    this.work.push(workMs);
    if (this.work.length > 120) this.work.shift();
    this.last = now;
    if (this.opts.bench && this.benchStart < 0 && now > 2500) this.benchStart = now;
    if (this.opts.bench && this.benchStart > 0 && !this.done && now - this.benchStart > this.opts.benchSec * 1000) this.finish();
    if (this.frames.length % 10 === 0) this.renderStats();
  }

  private renderStats() {
    const f = this.frames;
    if (!f.length) return;
    const mean = f.reduce((a, b) => a + b, 0) / f.length;
    const w = this.work.reduce((a, b) => a + b, 0) / this.work.length;
    const ex = this.extra();
    this.statsEl.textContent =
      `fps ${(1000 / mean).toFixed(0).padStart(3)} · frame ${mean.toFixed(1)} ms · work ${w.toFixed(1)} ms\n` +
      `draw calls ${this.calls()} · first frame ${this.firstFrameMs.toFixed(0)} ms\n` +
      Object.entries(ex).map(([k, v]) => `${k} ${v}`).join(' · ');
  }

  private finish() {
    this.done = true;
    const sorted = [...this.benchFrames].sort((a, b) => a - b);
    const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
    const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const res = {
      engine: this.engine,
      gpu: gpuName(),
      ua: navigator.userAgent,
      dpr: devicePixelRatio,
      viewport: `${innerWidth}x${innerHeight}`,
      opts: this.opts,
      frames: sorted.length,
      fpsMean: +(1000 / mean).toFixed(1),
      frameMsMean: +mean.toFixed(2),
      frameMsP95: +pct(0.95).toFixed(2),
      frameMsP99: +pct(0.99).toFixed(2),
      workMsMean: +(this.benchWork.reduce((a, b) => a + b, 0) / this.benchWork.length).toFixed(2),
      drawCallsMean: Math.round(this.benchCalls.reduce((a, b) => a + b, 0) / this.benchCalls.length),
      firstFrameMs: Math.round(this.firstFrameMs),
      ...this.extra(),
    };
    (window as unknown as { __result: unknown }).__result = res;
    // inside the benchmark page (an iframe), hand the result to it to save
    if (parent !== window) parent.postMessage({ type: 'agora-bench-result', result: res }, '*');
    const el = document.querySelector('#result')!;
    el.textContent = JSON.stringify(res, null, 1);
    const b = document.createElement('button');
    b.textContent = 'Copy result';
    b.onclick = () => void navigator.clipboard?.writeText(JSON.stringify(res));
    el.prepend(b);
  }

  /** Move nameplates; `head` gives the screen point above a mob's head (or null when hidden). */
  plates_(mobs: Mob[], head: (m: Mob) => { x: number; y: number } | null) {
    if (!this.opts.names) return;
    for (const m of mobs) {
      let el = this.plates.get(m.id);
      if (!el) {
        el = document.createElement('div');
        el.className = m.id === 'me' ? 'np me' : 'np';
        el.textContent = m.name;
        document.body.append(el);
        this.plates.set(m.id, el);
      }
      const p = head(m);
      if (!p) el.style.display = 'none';
      else {
        el.style.display = '';
        el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
      }
    }
  }
}

export function bindKeys(sim: Sim) {
  addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'SELECT') return;
    sim.keys.add(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    if (e.key.startsWith('Arrow')) e.preventDefault();
  });
  addEventListener('keyup', (e) => sim.keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
  addEventListener('blur', () => sim.keys.clear());
}
