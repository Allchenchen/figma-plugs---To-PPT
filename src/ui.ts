import type {
  ExportOptions,
  ExportSizePreset,
  ExportStrategy,
  PluginMessageToUI,
  UIMessageToPlugin,
} from './ir/types';
import { createPptx } from './converter/converter';
import { postProcessPptx } from './converter/postprocess';

const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

const titleEl = $<HTMLHeadingElement>('selection-title');
const emptyEl = $<HTMLParagraphElement>('empty');
const chipsEl = $<HTMLDivElement>('chips');
const chipScrollEl = $<HTMLDivElement>('chip-scroll');
const exportBtn = $<HTMLButtonElement>('export');
const statusEl = $<HTMLParagraphElement>('status');
const statusTextEl = $<HTMLSpanElement>('status-text');

type StatusKind = 'idle' | 'exporting' | 'success' | 'failed';

let exporting = false;
let selectedCount = 0;

function post(msg: UIMessageToPlugin): void {
  parent.postMessage({ pluginMessage: msg }, '*');
}

function readOptions(): ExportOptions {
  const sizePreset = (
    document.querySelector<HTMLInputElement>('input[name="size"]')?.value ?? 'frame'
  ) as ExportSizePreset;
  const strategy = (
    document.querySelector<HTMLInputElement>('input[name="strategy"]:checked')?.value ?? 'editable'
  ) as ExportStrategy;
  return { sizePreset, strategy };
}

function selectionTitle(count: number): string {
  if (count === 1) return '1 frame selected';
  return `${count} frames selected`;
}

function placeScrollThumb(): void {
  const overflow = !chipsEl.hidden && chipsEl.scrollHeight > chipsEl.clientHeight + 1;
  chipsEl.classList.toggle('is-overflow', overflow);
  if (!overflow) {
    chipScrollEl.setAttribute('hidden', '');
    chipsEl.classList.remove('fade-top', 'fade-bottom');
    return;
  }
  chipScrollEl.removeAttribute('hidden');
  const maxScroll = chipsEl.scrollHeight - chipsEl.clientHeight;
  const minTop = 40;
  const maxTop = 94;
  const progress = maxScroll > 0 ? chipsEl.scrollTop / maxScroll : 0;
  chipScrollEl.style.top = `${minTop + (maxTop - minTop) * progress}px`;
  chipsEl.classList.toggle('fade-top', chipsEl.scrollTop > 1);
  chipsEl.classList.toggle('fade-bottom', chipsEl.scrollTop < maxScroll - 1);
}

function renderChips(names: readonly string[]): void {
  chipsEl.replaceChildren();
  if (names.length === 0) {
    emptyEl.hidden = false;
    chipsEl.hidden = true;
    chipsEl.classList.remove('is-overflow', 'fade-top', 'fade-bottom');
    chipScrollEl.setAttribute('hidden', '');
    return;
  }
  emptyEl.hidden = true;
  chipsEl.hidden = false;
  for (const name of names) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = name;
    chipsEl.appendChild(chip);
  }
  requestAnimationFrame(placeScrollThumb);
}

let statusKind: StatusKind = 'idle';

function setStatus(kind: StatusKind): void {
  if (kind === 'exporting' && statusKind === 'exporting') return;
  statusKind = kind;
  statusEl.hidden = kind === 'idle';
  statusEl.querySelectorAll('.icon').forEach((icon) => {
    icon.setAttribute('hidden', '');
  });
  if (kind === 'idle') {
    statusTextEl.textContent = '';
    return;
  }
  statusEl.querySelector(`.icon-${kind}`)?.removeAttribute('hidden');
  statusTextEl.textContent =
    kind === 'exporting' ? 'Exporting…' : kind === 'success' ? 'Export successful !' : 'Export failed.';
}

function downloadBlob(data: BlobPart, fileName: string, mime: string): void {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadPptx(data: Uint8Array, fileName: string): void {
  downloadBlob(data as unknown as BlobPart, fileName, PPTX_MIME);
}

function finishExport(kind: 'success' | 'failed'): void {
  exporting = false;
  exportBtn.disabled = selectedCount === 0;
  setStatus(kind);
}

async function onExport(): Promise<void> {
  if (exportBtn.disabled || selectedCount === 0) return;
  exporting = true;
  exportBtn.disabled = true;
  setStatus('exporting');
  post({ type: 'export', options: readOptions() });
}

window.onmessage = (event: MessageEvent<{ pluginMessage?: PluginMessageToUI }>) => {
  const msg = event.data?.pluginMessage;
  if (!msg) return;

  switch (msg.type) {
    case 'selection': {
      selectedCount = msg.count;
      titleEl.textContent = selectionTitle(msg.count);
      renderChips(msg.names);
      if (!exporting) {
        exportBtn.disabled = msg.count === 0;
        setStatus('idle');
      }
      break;
    }

    case 'progress': {
      setStatus('exporting');
      break;
    }

    case 'document': {
      Promise.resolve()
        .then(() => createPptx(msg.document, readOptions()))
        .then((pptx) => pptx.write({ outputType: 'arraybuffer' }))
        .then((buf) => postProcessPptx(buf as ArrayBuffer, msg.document, readOptions()))
        .then((out) => {
          downloadPptx(out, 'Figma_Export.pptx');
          finishExport('success');
        })
        .catch(() => {
          finishExport('failed');
        });
      break;
    }

    case 'error': {
      finishExport('failed');
      break;
    }
  }
};

chipsEl.addEventListener('scroll', placeScrollThumb);
exportBtn.addEventListener('click', onExport);
