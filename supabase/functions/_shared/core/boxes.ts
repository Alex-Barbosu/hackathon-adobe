import { z } from "zod";

// [ymin, xmin, ymax, xmax] normalized to 0..1000, the convention Gemini uses for box_2d.
export const BoxSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);
export type Box = z.infer<typeof BoxSchema>;

const MAX = 1000;
const clamp = (n: number): number => Math.min(MAX, Math.max(0, Math.round(n)));

// Models occasionally emit swapped or out-of-range corners; normalize before storing.
export function clampBox(box: Box): Box {
  const [a, b, c, d] = box.map(clamp) as Box;
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
}

export function boxArea(box: Box): number {
  const [ymin, xmin, ymax, xmax] = box;
  return Math.max(0, ymax - ymin) * Math.max(0, xmax - xmin);
}
