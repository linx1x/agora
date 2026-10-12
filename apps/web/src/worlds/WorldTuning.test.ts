import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TUNING_FIELDS } from '@agora/shared';
import { WorldTuning } from './WorldTuning';

describe('WorldTuning panel (P17.12)', () => {
  it('shows a slider for every worldgen value, the preview canvas, and the params JSON', () => {
    const html = renderToStaticMarkup(createElement(WorldTuning, { onClose: () => {} }));
    expect(html.match(/type="range"/g)).toHaveLength(TUNING_FIELDS.length);
    expect(html).toContain('class="wt-canvas"');
    expect(html).toContain('params');
    expect(html).toContain('role="status"');
  });
});
