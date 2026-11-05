import type { IRTextLinearGradient, IRTextRun } from '../ir/types';
import { stripHash } from './colors';

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** DrawingML text fill. `ang` is the PowerPoint UI angle in 1/60000 degree. */
export function textGradientFillXml(gradient: IRTextLinearGradient): string {
  const stops = [...gradient.stops].sort((a, b) => a.position - b.position);
  const gs = stops
    .map((stop) => {
      const pos = Math.round(clamp01(stop.position) * 100000);
      const alpha =
        stop.opacity < 1 - 1e-6
          ? `<a:alpha val="${Math.round(clamp01(stop.opacity) * 100000)}"/>`
          : '';
      return `<a:gs pos="${pos}"><a:srgbClr val="${stripHash(stop.color)}">${alpha}</a:srgbClr></a:gs>`;
    })
    .join('');
  const degrees = ((gradient.angle % 360) + 360) % 360;
  const ang = Math.round(degrees * 60000);
  const path = gradient.style === 'diamond' ? 'rect' : gradient.style === 'radial' ? 'circle' : '';
  const geometry = path
    ? `<a:path path="${path}"><a:fillToRect l="${focusPct(gradient.center?.x ?? 0.5)}" t="${focusPct(gradient.center?.y ?? 0.5)}" r="${focusPct(1 - (gradient.center?.x ?? 0.5))}" b="${focusPct(1 - (gradient.center?.y ?? 0.5))}"/></a:path>`
    : `<a:lin ang="${ang}" scaled="1"/>`;
  return `<a:gradFill flip="none" rotWithShape="1"><a:gsLst>${gs}</a:gsLst>${geometry}</a:gradFill>`;
}

/** DrawingML percentage. 100% is 100000. Values may fall outside the box. */
function focusPct(value: number): number {
  return Math.round(value * 100000);
}

function gradientsEqual(a: IRTextLinearGradient, b: IRTextLinearGradient): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function replaceSolidFill(block: string, gradient: IRTextLinearGradient): string {
  const fill = textGradientFillXml(gradient);
  if (/<a:solidFill\b[\s\S]*?<\/a:solidFill>/.test(block)) {
    return block.replace(/<a:solidFill\b[\s\S]*?<\/a:solidFill>/, fill);
  }
  if (/<a:solidFill\b[^>]*\/>/.test(block)) {
    return block.replace(/<a:solidFill\b[^>]*\/>/, fill);
  }
  return block.replace(/<a:rPr\b[^>]*>/, (tag) => `${tag}${fill}`);
}

/**
 * Write linear text fills onto existing runs. The characters stay in `<a:t>`.
 * One shared gradient is applied to every run so a multi-line box keeps one fill.
 */
export function injectTextGradientFills(shape: string, runs: readonly IRTextRun[] | undefined): string {
  if (!runs || runs.length === 0) return shape;
  const gradients = runs.map((run) => run.fillGradient).filter((g): g is IRTextLinearGradient => !!g);
  if (gradients.length === 0) return shape;
  const shared =
    gradients.length === runs.length && gradients.every((g) => gradientsEqual(g, gradients[0]!))
      ? gradients[0]!
      : undefined;
  let index = 0;
  return shape.replace(/<a:r\b[^>]*>[\s\S]*?<\/a:r>/g, (block) => {
    const gradient = shared ?? runs[index]?.fillGradient;
    index += 1;
    if (!gradient) return block;
    return replaceSolidFill(block, gradient);
  });
}
