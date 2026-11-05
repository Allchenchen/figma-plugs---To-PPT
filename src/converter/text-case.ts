/**
 * Figma textCase → PowerPoint representation.
 *
 * DrawingML only exposes `cap="all"|"small"`. LOWER / TITLE have no native
 * OOXML attribute, so display characters are transformed at emit time while
 * UPPER / SMALL_CAPS keep source characters and use `cap`.
 */

export type TextCaseKind =
  | 'ORIGINAL'
  | 'UPPER'
  | 'LOWER'
  | 'TITLE'
  | 'SMALL_CAPS'
  | 'SMALL_CAPS_FORCED'
  | 'MIXED';

export type DrawingMlCap = 'all' | 'small';

/** OOXML `cap` when the case can stay character-preserving. */
export function drawingMlCap(textCase: TextCaseKind | undefined): DrawingMlCap | undefined {
  if (textCase === 'UPPER') return 'all';
  if (textCase === 'SMALL_CAPS' || textCase === 'SMALL_CAPS_FORCED') return 'small';
  return undefined;
}

/** Cases that require rewriting `<a:t>` content for visual fidelity. */
export function requiresCharacterCaseTransform(
  textCase: TextCaseKind | undefined
): textCase is 'LOWER' | 'TITLE' {
  return textCase === 'LOWER' || textCase === 'TITLE';
}

function titleCase(text: string): string {
  return text.replace(/([^\s\p{P}]+)/gu, (word) => {
    const chars = [...word];
    if (chars.length === 0) return word;
    return chars[0].toLocaleUpperCase('en-US') + chars.slice(1).join('').toLocaleLowerCase('en-US');
  });
}

/** Apply Figma display case to characters when OOXML cannot express it natively. */
export function applyDisplayTextCase(
  text: string,
  textCase: TextCaseKind | undefined
): string {
  if (textCase === 'LOWER') return text.toLocaleLowerCase('en-US');
  if (textCase === 'TITLE') return titleCase(text);
  return text;
}

export function textCaseCompatReason(
  textCase: TextCaseKind | undefined
): string | undefined {
  if (textCase === 'LOWER' || textCase === 'TITLE') {
    return `textCase=${textCase} has no DrawingML cap; characters transformed for visual match`;
  }
  if (textCase === 'MIXED') {
    return 'mixed textCase: per-run cap/transform applied where possible';
  }
  return undefined;
}
