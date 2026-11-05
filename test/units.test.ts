import { describe, it, expect } from 'vitest';
import {
  ptToInch,
  pxToPt,
  round2,
  PPT_WIDTH_PT,
  PPT_HEIGHT_PT,
  PPT_WIDTH_IN,
  PPT_HEIGHT_IN,
  PT_PER_INCH,
  EMU_PER_PT,
} from '../src/converter/units';

describe('units (1920×1080 pt page)', () => {
  it('defines the custom 16:9 page in pt and inches', () => {
    expect(PPT_WIDTH_PT).toBe(1920);
    expect(PPT_HEIGHT_PT).toBe(1080);
    expect(PPT_WIDTH_IN).toBeCloseTo(1920 / 72);
    expect(PPT_HEIGHT_IN).toBe(15);
    expect(PPT_WIDTH_IN * PT_PER_INCH).toBe(1920);
  });

  it('converts pt to inches via /72', () => {
    expect(ptToInch(72)).toBe(1);
    expect(ptToInch(1920)).toBeCloseTo(26.666666, 5);
    expect(ptToInch(0)).toBe(0);
  });

  it('uses 12700 EMU per pt', () => {
    expect(EMU_PER_PT).toBe(12700);
    expect(400 * EMU_PER_PT).toBe(5080000);
  });

  it('keeps legacy pxToPt for geometric reference only', () => {
    expect(pxToPt(96)).toBeCloseTo(72);
  });

  it('round2 keeps two decimal places', () => {
    expect(round2(1.234)).toBe(1.23);
    expect(round2(13.5)).toBe(13.5);
  });
});
