# Text baseline regression Frame

Create one 1920×1080 Figma Frame with a dark background. Each case must keep its
TextNode boundary visible in the reference PNG and must record its node ID in
the visual-report case manifest.

Cases:

1. 140 px single-line English, `SF Pro Regular`, AUTO line height.
2. 96 px single-line Chinese, `PingFang SC Regular`, AUTO line height.
3. 20 px Chinese, fixed 40 px line height.
4. 36 px mixed Chinese/English with separate font runs.
5. Multi-line body text with automatic wrapping.
6. Three explicit paragraphs with distinct fixed/percent line heights.
7. Identical fixed-height boxes using TOP, CENTER and BOTTOM alignment.
8. Regular, Medium, Semibold and Bold runs using installed fonts.
9. Separate TextNodes for NONE, WIDTH_AND_HEIGHT, HEIGHT and TRUNCATE resize modes.
10. Two otherwise identical nodes using leadingTrim NONE and CAP_HEIGHT.

Export requirements:

- Export the Figma Frame as PNG at 1×.
- Export the same Frame through the plugin and render the PPTX slide to PNG at
  the same aspect ratio.
- Download `figma-export-ir-debug.json`; it contains Figma SVG baselines,
  source render bounds and the final OOXML text audit.
- Copy `fixtures/text-visual-cases.example.json`, replace the rectangles and
  baselines with those from the fixture, then run:

```sh
npm run visual:text -- \
  --figma figma.png \
  --ppt powerpoint.png \
  --cases fixtures/text-visual-cases.json \
  --out text-visual-report.json
```

The report keeps text-box error, visible-glyph top/bottom error, baseline error
and visual-line count separate. A matching OOXML structure alone is not a
visual pass.
