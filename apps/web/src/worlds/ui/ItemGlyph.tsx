import { useSyncExternalStore, type ReactNode } from 'react';
import { baseItemOf } from '@agora/shared';
import { itemIconUrl, subscribeItemIcons } from '../art/itemIcons';
import { glyphOf, type Glyph } from './glyphs';

/** The ink every glyph is outlined in: it reads on the light HUD and on the dark theme alike. */
const INK = '#1d2328';
const WOOD = '#e8c48a';
const WOOD_EDGE = '#8a5a2b';

/**
 * The code-drawn icon of an item in a hotbar slot (P17.21d): a 16 px grid, outlined in ink, tinted by
 * its family or tier. Decorative: the slot's name is its accessible name, so the icon is hidden from
 * screen readers.
 */
export function ItemGlyph({ item, size = 22 }: { item: string; size?: number }) {
  const id = baseItemOf(item);
  const artwork = useSyncExternalStore(
    subscribeItemIcons,
    () => itemIconUrl(id),
    () => undefined,
  );
  const { glyph, tint } = glyphOf(item);
  if (artwork)
    return (
      <img
        className="wh-icon"
        src={artwork}
        width={size}
        height={size}
        alt=""
        aria-hidden="true"
        data-glyph={glyph}
        data-art="approved"
        style={{ imageRendering: 'pixelated', objectFit: 'contain' }}
      />
    );
  return (
    <svg
      className="wh-icon"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      data-glyph={glyph}
    >
      {shape(glyph, tint)}
    </svg>
  );
}

/** One glyph's shapes. Filled with the tint and outlined in ink. */
function shape(glyph: Glyph, tint: string): ReactNode {
  const o = { fill: tint, stroke: INK, strokeWidth: 1, strokeLinejoin: 'round' as const };
  const line = { fill: 'none', stroke: INK, strokeWidth: 1.2, strokeLinecap: 'round' as const };
  switch (glyph) {
    case 'sprout':
      return (
        <>
          <path d="M8 14V7" fill="none" stroke={INK} strokeWidth={1.6} strokeLinecap="round" />
          <path d="M8 8C5 8 2.8 6 2.8 2.8C6 2.8 8 5 8 8Z" {...o} />
          <path d="M8 7C8 4 10 2 13.2 2C13.2 5 11 7 8 7Z" {...o} fill="#5b9a48" />
        </>
      );
    case 'bloom':
      return (
        <>
          <circle cx="8" cy="9.2" r="4.6" {...o} />
          <path d="M9 5C9.5 2.5 11.5 1.8 13.5 2.4C13 4.8 11 5.4 9 5Z" {...o} fill="#4f9a5a" />
        </>
      );
    case 'leaf':
      return (
        <>
          <path d="M3 13C2 7 7 3 13.2 2.8C13.4 9 9.2 14 3 13Z" {...o} />
          <path d="M4 12L11.5 4.5" fill="none" stroke={INK} strokeWidth={0.8} />
        </>
      );
    case 'stone':
      return <path d="M2.5 10.8L4.5 5.2L10.2 3.6L13.6 7.1L12.6 12.6L7 13.6Z" {...o} />;
    case 'log':
      return (
        <>
          <rect x="2.5" y="5" width="11" height="6.2" rx="2" {...o} />
          <ellipse cx="13.2" cy="8.1" rx="1.5" ry="3" fill="#f3dbb0" stroke={INK} strokeWidth={1} />
        </>
      );
    case 'fiber':
      return (
        <>
          <path
            d="M4 13.5L6 2.5M7.8 13.5L9.8 2.5M11.6 13.5L13.6 2.5"
            fill="none"
            stroke={INK}
            strokeWidth={2.8}
            strokeLinecap="round"
          />
          <path
            d="M4 13.5L6 2.5M7.8 13.5L9.8 2.5M11.6 13.5L13.6 2.5"
            fill="none"
            stroke={tint}
            strokeWidth={1.4}
            strokeLinecap="round"
          />
        </>
      );
    case 'gem':
      return (
        <>
          <path d="M8 2L13.6 6L8 14.2L2.4 6Z" {...o} />
          <path d="M2.4 6H13.6" fill="none" stroke={INK} strokeWidth={0.7} />
        </>
      );
    case 'ingot':
      return (
        <>
          <path d="M2 12.2L4 6.4H12L14 12.2Z" {...o} />
          <path d="M2 12.2H14" fill="none" stroke={INK} strokeWidth={0.7} />
        </>
      );
    case 'drop':
      return (
        <path
          d="M8 2C10.6 5.6 12.6 7.6 12.6 10.2A4.6 4.6 0 0 1 3.4 10.2C3.4 7.6 5.4 5.6 8 2Z"
          {...o}
        />
      );
    case 'sack':
      return (
        <>
          <path d="M4 7Q8 5 12 7L13 14Q8 15.2 3 14Z" {...o} />
          <path d="M6 5.2L8 2.6L10 5.2" {...line} />
        </>
      );
    case 'paw':
      return (
        <>
          <ellipse cx="8" cy="10.6" rx="3.8" ry="3.2" {...o} />
          <circle cx="3.8" cy="6.6" r="1.5" {...o} />
          <circle cx="6.4" cy="4.4" r="1.5" {...o} />
          <circle cx="9.6" cy="4.4" r="1.5" {...o} />
          <circle cx="12.2" cy="6.6" r="1.5" {...o} />
        </>
      );
    case 'gear':
      return (
        <>
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="none"
            stroke={INK}
            strokeWidth={2.4}
            strokeDasharray="2 1.6"
          />
          <circle cx="8" cy="8" r="4.8" {...o} />
          <circle cx="8" cy="8" r="1.8" fill={INK} />
        </>
      );
    case 'house':
      return (
        <>
          <path
            d="M8 2L14.2 7.6H1.8Z"
            fill="#9b4a32"
            stroke={INK}
            strokeWidth={1}
            strokeLinejoin="round"
          />
          <rect x="3.4" y="7.4" width="9.2" height="6.4" {...o} />
          <rect x="6.8" y="9.8" width="2.4" height="4" fill={INK} />
        </>
      );
    case 'bowl':
      return (
        <>
          <path d="M1.8 7H14.2Q14.2 13.8 8 13.8Q1.8 13.8 1.8 7Z" {...o} />
          <path d="M6 4.6Q6.6 3.2 6 2M10 4.6Q10.6 3.2 10 2" {...line} strokeWidth={0.9} />
        </>
      );
    case 'fish':
      return (
        <>
          <path d="M11.4 8L15 4.8V11.2Z" {...o} />
          <ellipse cx="6.8" cy="8" rx="5" ry="3.3" {...o} />
          <circle cx="4.9" cy="7.4" r="0.9" fill={INK} />
        </>
      );
    case 'hoe':
      return (
        <>
          <path
            d="M3.4 13.6L9.8 5.2"
            fill="none"
            stroke={WOOD_EDGE}
            strokeWidth={2.6}
            strokeLinecap="round"
          />
          <path
            d="M3.4 13.6L9.8 5.2"
            fill="none"
            stroke={WOOD}
            strokeWidth={1.4}
            strokeLinecap="round"
          />
          <path d="M8.6 3.2L13.8 2L14.4 6.4L9.6 6.8Z" {...o} />
        </>
      );
    case 'can':
      return (
        <>
          <path d="M5 7.2Q5 3.4 7 3.4Q9 3.4 9 7.2" {...line} />
          <rect x="2.8" y="7" width="8.2" height="6.4" rx="1" {...o} />
          <path d="M10.6 8.6L14.4 4.4L15.2 5.3L11.8 9.8Z" {...o} />
        </>
      );
    case 'axe':
      return (
        <>
          <path
            d="M3.4 13.6L9.8 5.6"
            fill="none"
            stroke={WOOD_EDGE}
            strokeWidth={2.6}
            strokeLinecap="round"
          />
          <path
            d="M3.4 13.6L9.8 5.6"
            fill="none"
            stroke={WOOD}
            strokeWidth={1.4}
            strokeLinecap="round"
          />
          <path d="M6.8 3Q13.8 2 14.2 7.6L9.8 8.6Z" {...o} />
        </>
      );
    case 'pick':
      return (
        <>
          <path
            d="M8 4V14.2"
            fill="none"
            stroke={WOOD_EDGE}
            strokeWidth={2.6}
            strokeLinecap="round"
          />
          <path d="M8 4V14.2" fill="none" stroke={WOOD} strokeWidth={1.4} strokeLinecap="round" />
          <path
            d="M1.6 6.2Q8 0.4 14.4 6.2"
            fill="none"
            stroke={INK}
            strokeWidth={3.4}
            strokeLinecap="round"
          />
          <path
            d="M1.6 6.2Q8 0.4 14.4 6.2"
            fill="none"
            stroke={tint}
            strokeWidth={1.8}
            strokeLinecap="round"
          />
        </>
      );
    case 'shovel':
      return (
        <>
          <path
            d="M4.2 2.6L9.2 10"
            fill="none"
            stroke={WOOD_EDGE}
            strokeWidth={2.6}
            strokeLinecap="round"
          />
          <path
            d="M4.2 2.6L9.2 10"
            fill="none"
            stroke={WOOD}
            strokeWidth={1.4}
            strokeLinecap="round"
          />
          <path d="M8.2 9.4L12.6 8.4L13.6 12.4Q10.6 15 8.2 13.2Z" {...o} />
        </>
      );
    case 'rod':
      return (
        <>
          <path
            d="M2.4 13.6L12 3"
            fill="none"
            stroke={WOOD_EDGE}
            strokeWidth={2.2}
            strokeLinecap="round"
          />
          <path
            d="M2.4 13.6L12 3"
            fill="none"
            stroke={WOOD}
            strokeWidth={1}
            strokeLinecap="round"
          />
          <path d="M12 3V10.2" fill="none" stroke={INK} strokeWidth={0.7} />
          <circle cx="12" cy="10.8" r="1.2" {...o} />
        </>
      );
  }
}
