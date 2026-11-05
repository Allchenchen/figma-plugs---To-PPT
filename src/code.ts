import type { PluginMessageToUI, UIMessageToPlugin } from './ir/types';
import { sortFramesByName } from './reader/frame-order';
import { readDocument } from './reader/reader';

figma.showUI(__html__, { width: 380, height: 552 });

function post(msg: PluginMessageToUI): void {
  figma.ui.postMessage(msg);
}

/** Same natural-name order as `readDocument` (preview ≡ export queue). */
function selectedFramesInExportOrder(): FrameNode[] {
  return sortFramesByName(
    figma.currentPage.selection.filter((n): n is FrameNode => n.type === 'FRAME')
  );
}

function postSelection(): void {
  const frames = selectedFramesInExportOrder();
  post({ type: 'selection', count: frames.length, names: frames.map((f) => f.name) });
}

postSelection();
figma.on('selectionchange', postSelection);

figma.ui.onmessage = async (msg: UIMessageToPlugin) => {
  if (msg.type === 'cancel') {
    figma.closePlugin();
    return;
  }

  if (msg.type === 'export') {
    try {
      const frames = selectedFramesInExportOrder();

      if (frames.length === 0) {
        post({ type: 'error', message: '请先选择一个 Frame' });
        return;
      }

      post({ type: 'progress', message: '正在读取设计稿…' });
      // Pass the sorted frame list only — do not re-sort inside modules differently.
      const document = await readDocument(frames, msg.options);
      post({ type: 'document', document });
    } catch (err) {
      post({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
};
