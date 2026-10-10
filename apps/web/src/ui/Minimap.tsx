import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Minus, Plus, Map as MapIcon } from 'lucide-react';
import { tileDef, type Biome } from '@agora/shared';
import { PALETTES } from '../game/tiles';
import { rendered } from '../game/controller';
import { store, useStore } from '../state/store';

const SCALE = 2;

/** Corner minimap (P8.6): floor plan, people dots; click to walk there. Zoom buttons. */
export function Minimap() {
  const { t } = useTranslation();
  const map = useStore((s) => s.map);
  const mapRev = useStore((s) => s.mapRev);
  const open = useStore((s) => s.minimap);
  const me = useStore((s) => s.me);
  const base = useRef<HTMLCanvasElement | null>(null);
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!map) return;
    const cv = document.createElement('canvas');
    cv.width = map.width * SCALE;
    cv.height = map.height * SCALE;
    const c = cv.getContext('2d')!;
    const floor = map.layers.floor ?? [];
    const furn = map.layers.furniture ?? [];
    for (let i = 0; i < map.width * map.height; i++) {
      const x = (i % map.width) * SCALE;
      const y = Math.floor(i / map.width) * SCALE;
      const fd = tileDef(floor[i] ?? 0);
      const pal = PALETTES[(fd?.biome ?? 'hub') as Biome];
      let col = pal.floor;
      if (map.solid[i])
        col = map.occlude[i]
          ? '#1b2733'
          : tileDef(furn[i] ?? 0)?.base?.startsWith('plant') ||
              tileDef(furn[i] ?? 0)?.base?.startsWith('border')
            ? pal.leafDark
            : '#4a5866';
      c.fillStyle = col;
      c.fillRect(x, y, SCALE, SCALE);
    }
    for (const z of map.zones.filter((q) => q.kind === 'portal')) {
      c.fillStyle = '#5fd3c6';
      c.fillRect((z.x / 32) * SCALE, (z.y / 32) * SCALE, (z.w / 32) * SCALE, (z.h / 32) * SCALE);
    }
    base.current = cv;
  }, [map, mapRev]);

  useEffect(() => {
    if (!open || !map) return;
    const draw = () => {
      const cv = ref.current;
      if (!cv || !base.current) return;
      const c = cv.getContext('2d')!;
      c.drawImage(base.current, 0, 0);
      for (const [id, p] of rendered) {
        const x = (p.x / 32) * SCALE;
        const y = (p.y / 32) * SCALE;
        c.fillStyle = id === me ? '#5fd3c6' : '#f3f6f8';
        c.strokeStyle = '#17324d';
        c.lineWidth = 1;
        c.beginPath();
        c.arc(x, y, id === me ? 3.5 : 2.5, 0, Math.PI * 2);
        c.fill();
        c.stroke();
      }
    };
    draw();
    const iv = setInterval(draw, 300);
    return () => clearInterval(iv);
  }, [open, map, me]);

  if (!map) return null;
  return (
    <div className="minimap-wrap">
      <div className="zoom-btns" role="group" aria-label={t('minimap.zoom')}>
        <button
          type="button"
          className="icon-btn"
          aria-label={t('minimap.zoomIn')}
          title={`${t('minimap.zoomIn')} (+)`}
          onClick={() => zoomStep(1)}
        >
          <Plus size={16} aria-hidden />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label={t('minimap.zoomOut')}
          title={`${t('minimap.zoomOut')} (−)`}
          onClick={() => zoomStep(-1)}
        >
          <Minus size={16} aria-hidden />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-pressed={open}
          aria-label={t('minimap.toggle')}
          title={`${t('minimap.toggle')} (N)`}
          onClick={() => store.set({ minimap: !open })}
        >
          <MapIcon size={16} aria-hidden />
        </button>
      </div>
      {open && (
        <canvas
          ref={ref}
          className="minimap"
          width={map.width * SCALE}
          height={map.height * SCALE}
          role="img"
          aria-label={t('minimap.label')}
          onClick={(e) => {
            const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
            const x = ((e.clientX - r.left) / r.width) * map.pxWidth;
            const y = ((e.clientY - r.top) / r.height) * map.pxHeight;
            store.set({ navRequest: { kind: 'point', x, y } });
          }}
        />
      )}
    </div>
  );
}

export function zoomStep(dir: number) {
  const levels = [1, 2, 3, 4];
  const cur = store.get().zoom ?? 2;
  const i = levels.indexOf(cur);
  store.set({ zoom: levels[Math.max(0, Math.min(levels.length - 1, (i < 0 ? 1 : i) + dir))]! });
}
