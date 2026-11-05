import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import {
  compareTextVisualCase,
  type PixelImage,
  type TextVisualCase,
} from '../src/validation/text-visual-diff';

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function png(path: string): PixelImage {
  const value = PNG.sync.read(readFileSync(path));
  return { width: value.width, height: value.height, data: value.data };
}

const figmaPath = argument('--figma');
const pptPath = argument('--ppt');
const casesPath = argument('--cases');
const outputPath = argument('--out');
const cases = JSON.parse(readFileSync(casesPath, 'utf8')) as TextVisualCase[];
const figma = png(figmaPath);
const ppt = png(pptPath);
const report = {
  figma: { path: figmaPath, width: figma.width, height: figma.height },
  ppt: { path: pptPath, width: ppt.width, height: ppt.height },
  cases: cases.map((testCase) => compareTextVisualCase(figma, ppt, testCase)),
};

writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Text visual report written to ${outputPath}`);
