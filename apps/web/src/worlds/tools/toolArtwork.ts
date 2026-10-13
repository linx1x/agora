/** Shared vector masters for inventory icons and the tools held during a swing. */
export interface ToolLayer {
  d: string;
  fill: string;
  stroke?: string;
  width?: number;
}
const INK = '#302c28';
export const TOOL_FAMILIES = ['hoe', 'can', 'axe', 'pick', 'shovel', 'rod'] as const;
export type ToolFamily = (typeof TOOL_FAMILIES)[number];
export function isToolFamily(value: string): value is ToolFamily {
  return TOOL_FAMILIES.some((family) => family === value);
}

/** Hand attachment on the 32px master: the can is held by its upper loop. */
export function toolGrip(tool: ToolFamily): readonly [number, number] {
  return tool === 'can' ? [14, 4] : [16, 27];
}

/** All masters point upward on a 32px grid. */
export function toolLayers(tool: ToolFamily, metal: string): ToolLayer[] {
  const layer = (d: string, fill: string, stroke = INK, width = 1.2): ToolLayer => ({
    d,
    fill,
    stroke,
    width,
  });
  const handle = [
    layer('M14.5 8H17.5L18 27Q16 30 14 27Z', '#aa7043'),
    layer('M15 10H16.2V26H15Z', '#e9bd79', 'none'),
    layer('M14 23H18V25H14Z', '#65503c', 'none'),
  ];
  const shine = (d: string) => layer(d, 'none', '#fff4d5', 1);
  switch (tool) {
    case 'hoe':
      return [
        ...handle,
        layer('M8 4L24 5L24 9L18 10L17 16L10 15L11 8L8 8Z', metal),
        layer('M10 13L17 14V16L10 15Z', '#626b64', 'none'),
        shine('M10 5L22 6'),
      ];
    case 'axe':
      return [
        ...handle,
        layer('M9 5L17 4L23 2Q29 8 25 15L18 12L14 10L9 10Z', metal),
        layer('M23 2Q29 8 25 15L23 13Q25 7 21 4Z', '#eef0d9', 'none'),
        layer('M14 5H18V10H14Z', '#716655'),
        shine('M19 5L22 4'),
      ];
    case 'pick':
      return [
        ...handle,
        layer('M2 12Q6 3 16 3Q26 3 30 12L23 8L17 7L9 8Z', metal),
        shine('M6 8Q16 1 26 8'),
        layer('M14 4H18V10H14Z', '#887257'),
      ];
    case 'shovel':
      return [
        ...handle,
        layer('M9 3H23L22 12Q21 16 16 19Q11 16 10 12Z', metal),
        layer('M10 11Q12 16 16 18Q21 15 22 11L20 12L16 16L12 12Z', '#65716b', 'none'),
        shine('M11 5H20M16 6V13'),
      ];
    case 'can':
      return [
        layer('M8 13V9Q8 2 14 2Q20 2 20 9V13H17V9Q17 5 14 5Q11 5 11 9V13Z', metal),
        layer('M20 16L27 8L30 10L24 22L19 23Z', metal),
        layer('M4 12Q13 9 22 12L23 26Q13 30 3 26Z', metal),
        layer('M4 22Q13 26 23 22V26Q13 30 3 26Z', '#5b7167', 'none'),
        layer('M26 7L31 9L30 13L25 10Z', '#d6dfce'),
        shine('M6 14V21M9 13Q14 12 19 13'),
        layer('M10 18H17V22H10Z', '#d4ac63'),
      ];
    case 'rod':
      return [
        layer('M13 28L18 3L20 3L17 28Z', '#b77c46'),
        shine('M16 20L19 4'),
        layer('M14 22L17 23L16 29L13 28Z', '#645341'),
        layer('M20 3Q28 9 26 20', 'none', '#eee2ba', 0.9),
        layer('M24 20H28V24H24Z', '#c86a50'),
        layer('M24 20H28V22H24Z', '#f4e6c6', 'none'),
        layer('M13 19A3 3 0 1 0 19 19A3 3 0 1 0 13 19', metal),
      ];
  }
}

export function drawTool(g: CanvasRenderingContext2D, tool: ToolFamily, metal: string): void {
  g.lineJoin = 'round';
  g.lineCap = 'round';
  for (const layer of toolLayers(tool, metal)) {
    const path = new Path2D(layer.d);
    if (layer.fill !== 'none') {
      g.fillStyle = layer.fill;
      g.fill(path);
    }
    if (layer.stroke && layer.stroke !== 'none') {
      g.strokeStyle = layer.stroke;
      g.lineWidth = layer.width ?? 1;
      g.stroke(path);
    }
  }
}
