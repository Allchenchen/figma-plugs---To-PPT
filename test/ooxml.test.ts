import { describe, it, expect } from 'vitest';
import {
  srcRectXml,
  tileXml,
  custGeomFromPathXml,
  custGeomFromVerticesXml,
  roundRectCustGeomXml,
  roundRectPrstGeomXml,
  roundRectAdj,
  radiusFromRoundRectAdj,
  imageCornerGeometryXml,
  cornersAreUniform,
  ELLIPSE_GEOM_XML,
} from '../src/converter/ooxml';

describe('srcRectXml', () => {
  it('emits the four edge attributes', () => {
    expect(srcRectXml({ l: 1000, r: 2000, t: 3000, b: 4000 })).toBe(
      '<a:srcRect l="1000" r="2000" t="3000" b="4000"/>'
    );
  });
});

describe('tileXml', () => {
  it('anchors top-left with the given ratios', () => {
    expect(tileXml(50000, 25000)).toBe(
      '<a:tile algn="tl" flip="none" sx="50000" sy="25000" tx="0" ty="0"/>'
    );
  });
});

describe('custGeomFromPathXml', () => {
  it('emits a single editable path with moveTo/lnTo/close', () => {
    const xml = custGeomFromPathXml('M 0 0 L 96 0 L 96 96 Z', 96, 96);
    expect(xml).toContain('<a:custGeom>');
    expect(xml).toContain('<a:path w="1219200" h="1219200">'); // 96pt × 12700 EMU
    expect(xml).toContain('<a:moveTo><a:pt x="0" y="0"/></a:moveTo>');
    expect(xml).toContain('<a:lnTo><a:pt x="1219200" y="0"/></a:lnTo>');
    expect(xml).toContain('<a:close/>');
  });

  it('emits cubic beziers', () => {
    const xml = custGeomFromPathXml('M 0 0 C 96 0 96 96 0 96', 96, 96);
    expect(xml).toContain('<a:cubicBezTo>');
  });

  it('scales coordinates for slide presets', () => {
    const xml = custGeomFromPathXml('M 0 0 L 96 0', 96, 96, 0.5);
    expect(xml).toContain('<a:pt x="609600" y="0"/>'); // 96 × 0.5 × 12700
    expect(xml).toContain('<a:path w="609600" h="609600">');
  });
});

describe('custGeomFromVerticesXml', () => {
  it('emits a closed polygon', () => {
    const xml = custGeomFromVerticesXml(
      [
        { x: 0, y: 0 },
        { x: 96, y: 0 },
        { x: 48, y: 96 },
      ],
      96,
      96
    );
    expect(xml).toContain('<a:moveTo>');
    expect(xml).toContain('<a:lnTo>');
    expect(xml).toContain('<a:close/>');
  });
});

describe('roundRectCustGeomXml', () => {
  it('emits quadratic beziers for corners', () => {
    const xml = roundRectCustGeomXml(96, 96, 8, 8, 8, 8);
    expect(xml).toContain('<a:quadBezTo>');
    expect(xml).toContain('<a:custGeom>');
  });
});

describe('roundRectAdj / roundRectPrstGeomXml', () => {
  it('encodes adj as r/shortSide×100000 (not 2× half-side)', () => {
    // r=10, minSide=100 → adj = 10/100*100000 = 10000
    expect(roundRectPrstGeomXml(10, 200, 100)).toBe(
      '<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 10000"/></a:avLst></a:prstGeom>'
    );
    expect(roundRectAdj(10, 200, 100)).toBe(10000);
  });

  it('matches Figma card sample 369×615 r=10 → adj≈2710', () => {
    expect(roundRectAdj(10, 369, 615)).toBe(2710);
    expect(radiusFromRoundRectAdj(2710, 369, 615)).toBeCloseTo(10, 1);
  });

  it('keeps adj invariant under proportional scale and axis swap', () => {
    const base = roundRectAdj(10, 369, 615);
    expect(roundRectAdj(20, 738, 1230)).toBe(base);
    expect(roundRectAdj(10, 615, 369)).toBe(base);
  });

  it('emits rect when radius is 0', () => {
    expect(roundRectPrstGeomXml(0, 369, 615)).toContain('prst="rect"');
    expect(roundRectAdj(0, 369, 615)).toBe(0);
  });

  it('clamps radius to half the short side', () => {
    // shortSide=100 → max r=50 → adj=50000
    expect(roundRectAdj(1000, 200, 100)).toBe(50000);
  });

  it('handles fractional radii', () => {
    expect(roundRectAdj(2.5, 100, 200)).toBe(2500);
    expect(radiusFromRoundRectAdj(2500, 100, 200)).toBeCloseTo(2.5, 5);
  });
});

describe('imageCornerGeometryXml routing', () => {
  it('routes uniform unsmoothed corners to prstGeom', () => {
    const xml = imageCornerGeometryXml(100, 100, 8, 8, 8, 8, 1, 0);
    expect(xml).toContain('prst="roundRect"');
    expect(xml).not.toContain('custGeom');
  });

  it('routes independent corners to custGeom', () => {
    const xml = imageCornerGeometryXml(100, 100, 4, 8, 12, 16, 1, 0);
    expect(xml).toContain('<a:custGeom>');
    expect(cornersAreUniform(4, 8, 12, 16)).toBe(false);
  });

  it('routes cornerSmoothing > 0 to custGeom even when radii match', () => {
    const xml = imageCornerGeometryXml(100, 100, 8, 8, 8, 8, 1, 0.6);
    expect(xml).toContain('<a:custGeom>');
  });
});

describe('ELLIPSE_GEOM_XML', () => {
  it('is a prstGeom ellipse', () => {
    expect(ELLIPSE_GEOM_XML).toBe('<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>');
  });
});
