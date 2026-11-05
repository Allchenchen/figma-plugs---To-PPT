/**
 * Strip heavy binary payloads from an IRDocument so it can be downloaded as a
 * compact JSON diagnostic without embedding multi-MB base64 images.
 */
import type { IRDocument, IRElement } from '../ir/types';

function stripElement(el: IRElement): IRElement | Record<string, unknown> {
  if (el.type === 'image' || el.type === 'pictureShape') {
    const { data, ...rest } = el;
    return {
      ...rest,
      data: `[omitted base64, ${data.length} chars]`,
      mimeType: el.mimeType,
    };
  }
  return el;
}

export function irDocumentForDebug(doc: IRDocument): unknown {
  return {
    report: doc.report,
    slides: doc.slides.map((s) => ({
      id: s.id,
      name: s.name,
      width: s.width,
      height: s.height,
      backgroundColor: s.backgroundColor,
      elements: s.elements.map(stripElement),
    })),
  };
}
