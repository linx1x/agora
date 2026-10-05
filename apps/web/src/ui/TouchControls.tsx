import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mic } from 'lucide-react';
import { setStick } from '../game/input';
import { snapDir, stickVector } from '../game/stick';
import { media } from '../media/MediaManager';
import { useStore } from '../state/store';
import { BOTTOM_SHEET_QUERY, useCompactLayout, useMedia } from './layout';

/** Base radius in CSS px; the knob travels this far from the centre. */
const R = 46;

/**
 * Virtual joystick (P8.2), bottom-left on touch screens. It is a pointer-only twin of
 * the arrow keys, which keep working everywhere, so it is hidden from assistive tech.
 */
function Joystick() {
  const base = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const active = useRef<number | null>(null);
  const [held, setHeld] = useState(false);

  const place = (x: number, y: number) => {
    if (knob.current) knob.current.style.transform = `translate(${x}px, ${y}px)`;
  };
  const update = (e: React.PointerEvent) => {
    const r = base.current!.getBoundingClientRect();
    const out = stickVector(
      e.clientX - (r.left + r.width / 2),
      e.clientY - (r.top + r.height / 2),
      R,
    );
    place(out.knob[0], out.knob[1]);
    const [x, y] = snapDir(out.dir);
    setStick(x, y);
  };
  const release = () => {
    active.current = null;
    setHeld(false);
    place(0, 0);
    setStick(0, 0);
  };
  // never leave the avatar walking: release on unmount, blur and hidden tab
  useEffect(() => {
    const stop = () => active.current !== null && release();
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', stop);
    return () => {
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', stop);
      setStick(0, 0);
    };
  }, []);

  return (
    <div
      ref={base}
      className={`joystick${held ? ' held' : ''}`}
      aria-hidden="true"
      onPointerDown={(e) => {
        if (active.current !== null) return;
        active.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        (document.activeElement as HTMLElement | null)?.blur?.();
        setHeld(true);
        update(e);
        e.preventDefault();
      }}
      onPointerMove={(e) => active.current === e.pointerId && update(e)}
      onPointerUp={(e) => active.current === e.pointerId && release()}
      onPointerCancel={(e) => active.current === e.pointerId && release()}
      onLostPointerCapture={(e) => active.current === e.pointerId && release()}
    >
      <div ref={knob} className="joystick-knob" />
    </div>
  );
}

/** Push-to-talk on a touch screen: hold the button (there is no key to hold). */
function HoldToTalk() {
  const { t } = useTranslation();
  const talking = useStore((s) => s.talking);
  const down = (on: boolean) => media.setTalking(on);
  useEffect(() => () => media.setTalking(false), []);
  return (
    <button
      type="button"
      className={`hold-talk${talking ? ' live' : ''}`}
      aria-pressed={talking}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        down(true);
      }}
      onPointerUp={() => down(false)}
      onPointerCancel={() => down(false)}
      onLostPointerCapture={() => down(false)}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
          e.preventDefault();
          down(true);
        }
      }}
      onKeyUp={(e) => (e.key === ' ' || e.key === 'Enter') && down(false)}
      onBlur={() => down(false)}
    >
      <Mic size={22} aria-hidden />
      <span>{t('touch.holdToTalk')}</span>
    </button>
  );
}

/** Touch-only overlay: joystick and hold-to-talk. Hidden while a sheet or build mode is up. */
export function TouchControls() {
  const compact = useCompactLayout();
  // on narrow portrait phones the panel is a bottom sheet over the joystick
  const bottomSheet = useMedia(BOTTOM_SHEET_QUERY);
  const panelOpen = useStore((s) => s.panelOpen);
  const building = useStore((s) => !!s.build);
  const dialog = useStore((s) => s.dialog);
  const joystick = useStore((s) => s.settings.joystick);
  const ptt = useStore((s) => s.settings.pushToTalk && s.mic);
  const online = useStore((s) => s.conn === 'online');
  const covered = (compact && bottomSheet && panelOpen) || !!dialog || building || !online;
  if (covered) return null;
  return (
    <div className="touch-controls">
      {joystick && <Joystick />}
      {ptt && <HoldToTalk />}
    </div>
  );
}
