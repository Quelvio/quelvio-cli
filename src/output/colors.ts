import pc from 'picocolors';

export type ColorMode = 'auto' | 'always' | 'never';

let mode: ColorMode = 'auto';

export function setColorMode(next: ColorMode): void {
  mode = next;
}

export function colorsEnabled(stream: NodeJS.WriteStream = process.stdout): boolean {
  if (mode === 'never') return false;
  if (mode === 'always') return true;
  if (process.env.NO_COLOR && process.env.NO_COLOR.length > 0) return false;
  return Boolean(stream.isTTY);
}

type Colorizer = (s: string) => string;

function wrap(fn: Colorizer): Colorizer {
  return (s: string) => (colorsEnabled() ? fn(s) : s);
}

export const c = {
  bold: wrap(pc.bold),
  dim: wrap(pc.dim),
  cyan: wrap(pc.cyan),
  green: wrap(pc.green),
  red: wrap(pc.red),
  yellow: wrap(pc.yellow),
  magenta: wrap(pc.magenta),
  blue: wrap(pc.blue),
  gray: wrap(pc.gray),
};
