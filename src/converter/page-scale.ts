/**
 * Figma Frame → fixed 1920 × 1080 pt PowerPoint page.
 *
 * When the Frame is 1920 × 1080 px: scale=1 → 1 Figma px maps to 1 PPT pt.
 * Other Frame sizes fit uniformly into 1920×1080 pt with letterbox offsets.
 *
 * After mapping, IR geometry and typography numbers are in **pt**. Emission
 * uses pt/72 → inches for pptxgenjs (never /96).
 */

import type { Rect } from '../ir/types';
import {
  PPT_HEIGHT_PT,
  PPT_WIDTH_PT,
  round2,
  ptToInch,
} from './units';

export interface PageLayout {
  /** Always 1920 — target slide width in pt. */
  width: number;
  /** Always 1080 — target slide height in pt. */
  height: number;
  /** Uniform fit: min(1920/frameW, 1080/frameH). */
  scale: number;
  scaleX: number;
  scaleY: number;
  /** Letterbox offsets in pt. */
  offsetX: number;
  offsetY: number;
  frameWidth: number;
  frameHeight: number;
}

export interface FramePercents {
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
}

/** Fixed target slide in pt (custom 16:9, not PPT default widescreen). */
export function targetSlidePt(): { width: number; height: number } {
  return { width: PPT_WIDTH_PT, height: PPT_HEIGHT_PT };
}

/** Compute layout from a Figma frame (px) onto the 1920×1080 pt slide. */
export function computePageLayout(
  frameWidth: number,
  frameHeight: number,
  pptWidth: number = PPT_WIDTH_PT,
  pptHeight: number = PPT_HEIGHT_PT
): PageLayout {
  if (frameWidth <= 0 || frameHeight <= 0) {
    return {
      width: pptWidth,
      height: pptHeight,
      scale: 1,
      scaleX: 1,
      scaleY: 1,
      offsetX: 0,
      offsetY: 0,
      frameWidth,
      frameHeight,
    };
  }
  const scaleX = pptWidth / frameWidth;
  const scaleY = pptHeight / frameHeight;
  const scale = Math.min(scaleX, scaleY);
  return {
    width: pptWidth,
    height: pptHeight,
    scale,
    scaleX,
    scaleY,
    offsetX: (pptWidth - frameWidth * scale) / 2,
    offsetY: (pptHeight - frameHeight * scale) / 2,
    frameWidth,
    frameHeight,
  };
}

/** Always map onto the project’s 1920×1080 pt page. */
export function layoutForFrame(frameWidth: number, frameHeight: number): PageLayout {
  return computePageLayout(frameWidth, frameHeight, PPT_WIDTH_PT, PPT_HEIGHT_PT);
}

/** @deprecated Prefer layoutForFrame — slides are never “frame-sized” inches. */
export function frameAsPageLayout(frameWidth: number, frameHeight: number): PageLayout {
  return layoutForFrame(frameWidth, frameHeight);
}

export function toAxisPercent(value: number, axisSize: number): number {
  if (axisSize === 0) return 0;
  return (value / axisSize) * 100;
}

export function fromAxisPercent(percent: number, axisSize: number): number {
  return (axisSize * percent) / 100;
}

export function rectToFramePercents(
  rect: Rect,
  frameWidth: number,
  frameHeight: number
): FramePercents {
  return {
    xPercent: toAxisPercent(rect.x, frameWidth),
    yPercent: toAxisPercent(rect.y, frameHeight),
    widthPercent: toAxisPercent(rect.width, frameWidth),
    heightPercent: toAxisPercent(rect.height, frameHeight),
  };
}

/** Frame px → slide pt (uniform scale + letterbox). */
export function mapRectToSlide(rect: Rect, layout: PageLayout): Rect {
  return {
    x: rect.x * layout.scale + layout.offsetX,
    y: rect.y * layout.scale + layout.offsetY,
    width: rect.width * layout.scale,
    height: rect.height * layout.scale,
  };
}

export function mapPercentsToSlide(percents: FramePercents, layout: PageLayout): Rect {
  const contentW = layout.frameWidth * layout.scale;
  const contentH = layout.frameHeight * layout.scale;
  return {
    x: layout.offsetX + fromAxisPercent(percents.xPercent, contentW),
    y: layout.offsetY + fromAxisPercent(percents.yPercent, contentH),
    width: fromAxisPercent(percents.widthPercent, contentW),
    height: fromAxisPercent(percents.heightPercent, contentH),
  };
}

/**
 * Typography after page scale: Figma size × scale → PPT pt.
 * At scale=1: 140 px → 140 pt (1:1 panel mapping).
 */
export function mapTypographyPt(sourcePx: number, pageScale: number): number {
  return round2(sourcePx * pageScale);
}

/** Slide pt → inches for pptxgenjs (round2 on pt, exact /72). */
export function slidePtToInch(pt: number): number {
  return ptToInch(pt);
}

/** @deprecated Alias — IR slide space is pt after page mapping. */
export function slidePxToInch(pt: number): number {
  return slidePtToInch(pt);
}
