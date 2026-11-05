/**
 * Dual quality accounting for an IRDocument.
 * Visual structure (element counts / PNG reasons) and native editability are
 * reported separately so a full-slide PNG cannot be miscounted as "success".
 */
import type {
  ExportStrategy,
  IRDocument,
  IRElement,
  IRQualitySummary,
  IRReportEntry,
} from '../ir/types';

function isNativeEditable(el: IRElement): boolean {
  if (el.type === 'text' || el.type === 'shape' || el.type === 'line') return true;
  if (el.type === 'pictureShape') return true;
  // Native picture with FILL/FIT/CROP/TILE sizing stays a replaceable image object.
  if (el.type === 'image' && el.sizing) return true;
  return false;
}

function isFlattenedRaster(el: IRElement): boolean {
  return el.type === 'image' && !el.sizing;
}

function coversMostOfSlide(
  el: IRElement,
  slide: { width: number; height: number },
  ratio = 0.9
): boolean {
  const area = el.rect.width * el.rect.height;
  const slideArea = slide.width * slide.height;
  if (slideArea <= 0) return false;
  return area / slideArea >= ratio;
}

export function summarizeQuality(
  doc: IRDocument,
  strategy: ExportStrategy = 'editable'
): IRQualitySummary {
  const byType: Partial<Record<IRElement['type'], number>> = {};
  let irElementCount = 0;
  let nativeEditableCount = 0;
  let rasterObjectCount = 0;
  let wholeSlideRasterSuspect = false;

  for (const slide of doc.slides) {
    for (const el of slide.elements) {
      irElementCount++;
      byType[el.type] = (byType[el.type] ?? 0) + 1;
      if (isNativeEditable(el)) nativeEditableCount++;
      if (isFlattenedRaster(el)) {
        rasterObjectCount++;
        if (slide.elements.length <= 2 && coversMostOfSlide(el, slide)) {
          wholeSlideRasterSuspect = true;
        }
      }
    }
  }

  const tiers = { native: 0, ooxml: 0, png: 0 };
  const reasonCounts = new Map<string, number>();
  for (const e of doc.report.entries) {
    tiers[e.tier]++;
    if (e.reason) {
      reasonCounts.set(e.reason, (reasonCounts.get(e.reason) ?? 0) + 1);
    }
  }

  const topReasons = [...reasonCounts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  return {
    strategy,
    slideCount: doc.slides.length,
    irElementCount,
    byType,
    tiers,
    nativeEditableCount,
    rasterObjectCount,
    nativeEditableShare: irElementCount === 0 ? 0 : nativeEditableCount / irElementCount,
    wholeSlideRasterSuspect,
    topReasons,
  };
}

/** Human-readable dual report (UI + CLI). */
export function formatQualityReport(summary: IRQualitySummary, entries: IRReportEntry[]): string {
  const lines: string[] = [];
  lines.push(`策略：${summary.strategy === 'fidelity' ? '视觉一致优先' : '可编辑优先'}`);
  lines.push('—— 视觉一致性（结构） ——');
  lines.push(
    `幻灯片 ${summary.slideCount} · IR 元素 ${summary.irElementCount} · 报告条目 ${entries.length}`
  );
  const typeBits = Object.entries(summary.byType)
    .map(([k, v]) => `${k}:${v}`)
    .join(' · ');
  if (typeBits) lines.push(`类型 ${typeBits}`);
  if (summary.wholeSlideRasterSuspect) {
    lines.push('⚠ 疑似整页栅格化（单张大图占满幻灯片）— 不符合最小降级原则');
  }
  lines.push('（像素级观感需在 PowerPoint/WPS 中人工核对）');

  lines.push('—— 原生可编辑性 ——');
  const pct = Math.round(summary.nativeEditableShare * 100);
  lines.push(
    `可编辑对象 ${summary.nativeEditableCount}/${summary.irElementCount}（${pct}%）· 扁平 PNG ${summary.rasterObjectCount}`
  );
  lines.push(
    `报告分层 原生 ${summary.tiers.native} · OOXML ${summary.tiers.ooxml} · PNG ${summary.tiers.png}`
  );

  lines.push('—— 降级原因（Top） ——');
  if (summary.topReasons.length === 0) {
    lines.push('（无）');
  } else {
    for (const r of summary.topReasons) {
      lines.push(`×${r.count}  ${r.reason}`);
    }
  }
  return lines.join('\n');
}
