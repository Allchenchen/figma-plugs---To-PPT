# Text vertical-layout diagnostics

## Evidence from the current `Insight & Idea` export

The latest `Figma_Export.pptx` title shape contains:

- geometry: x 195 px, y 105 px, width 796 px, height 167 px;
- requested font: SF Pro, 105 pt (the 72/96 conversion of Figma 140 px);
- `anchor="t"` and zero left/top/right/bottom insets;
- no `lnSpc`, `spcBef`, `spcAft`, `spAutoFit` or `normAutofit`.

After normalizing the two screenshots to the slide viewport, the title's
visible-glyph bounds are the same to pixel precision (approximately y 73–140).
The gap between the top of the TextNode and the cap glyph is therefore not
evidence of conversion drift. It is the font line box: ascender space is not
the same thing as the visible cap-height boundary.

Figma `leadingTrim=CAP_HEIGHT` removes space above the first cap-height and
below the last alphabetic baseline. DrawingML has no first-baseline-offset or
cap-height-trim property. Top anchor and top inset cannot express that semantic
without also changing ordinary `leadingTrim=NONE` text.

## Diagnostic data

Every non-empty TextNode now records:

- source font family, style, weight and size;
- `hasMissingFont`;
- TextNode geometry and Figma render bounds;
- SVG viewport and each visual line's Figma baseline;
- line-height, paragraph spacing, alignment, resize mode and leading trim.

After PPTX post-processing, `pptxTextAudit` records each editable text shape's
final geometry, body anchor/insets/autofit, paragraph spacing and run font data.
Download the IR diagnostic JSON only after PPTX generation has completed.

OOXML records the requested typeface, not the typeface PowerPoint ultimately
resolved at render time. Because this project does not embed fonts, the
PowerPoint font dropdown and rendered glyph measurements remain required to
confirm substitution.

## Fix policy (R-TXT-19 / R-TXT-21 / R-TXT-22)

1. **Box geometry** is always Figma's measured rect; zero insets; mapped
   `textAlignVertical` only. Never nudge `y`/`height` or invent `tIns` from
   `lineHeight - fontSize` / render-bounds guesses.
2. **Row spacing**: PptxGenJS turns every `\n` into a separate `<a:p>`, so Exact
   `lnSpc` would not space single-line paragraphs. Matching adjacent paragraphs
   (same line-height, zero paragraph spacing, no lists) are collapsed to one
   `<a:p>` with `<a:br/>` so `lnSpc` applies between visual rows. U+2028/U+2029
   are normalized to `\n` before paragraph split.
3. **Autofit**: postprocess forces `<a:noAutofit/>` so PPT never reflows the box.
4. `leadingTrim=CAP_HEIGHT` still has no DrawingML equivalent; keep IR + report.
   Soft-break + Exact mapping addresses the Insight body overlap class of bugs;
   residual cap-top flush vs Figma remains a known limitation to verify visually.
5. Attribute matrix: `docs/text-attribute-mapping.md`.
