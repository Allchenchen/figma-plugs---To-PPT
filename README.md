# To PPT

把 Figma 里选中的 Frame 导出成一份本地 PowerPoint（`.pptx`）。文件在浏览器里生成并下载，不上传设计稿，也不连接远程服务器。

## 项目解决什么问题

设计师在 Figma 里排好一页页画面后，需要一份能在 PowerPoint 或 Keynote 里改字、改简单样式的 PPT。这个插件做的是这一次导出，不把改过的 PPT 再导回 Figma。

复杂内容（遮罩、部分效果）会变成图片，避免拆散后和画面不一致。文字在可编辑模式下尽量保留为文本框。Figma 和 PowerPoint 的字体、换行不完全相同，结构正确不等于逐像素一致。

## 主要功能

- 只导出当前页上选中的 Frame。组、组件或其他类型不会单独成页。一个 Frame 对应一页。
- 多页顺序按 Frame 名称的自然排序，不按画布位置。`01 Title` 排在 `02 Cover` 前面，`2` 排在 `10` 前面。
- 幻灯片固定为 **1920×1080 磅**。其他尺寸的 Frame 按比例缩放后居中，四周留白。
- **Editable PPT**（默认）：文字、形状和图片尽量保持可编辑。遮罩组、图片填充的椭圆等复杂对象会局部变成 PNG。画板内部 `visible = false` 的图层不导出。
- **Image-based PPT**：每个选中的 Frame 导出成一张 2 倍 PNG，铺满该页。
- 界面语言为英文。未选中 Frame 时按钮不可用。导出过程中下载 `Figma_Export.pptx`。

## 安装方法

需要 Node.js 18 或更高版本，以及 npm。Figma 使用桌面版。

在项目根目录（含 `manifest.json` 的目录）执行：

```bash
npm install
npm run build
```

构建完成后得到 `dist/code.js` 和 `dist/ui.html`。

在 Figma 桌面版中：

1. 打开 **Plugins → Development → Import plugin from manifest…**
2. 选择本目录中的 `manifest.json`
3. 菜单中的插件名是 **To PPT**

改过源码后需要重新执行 `npm run build`，再重新运行插件。

## 使用方法

1. 在 Figma 当前页选中一个或多个 Frame。
2. 运行 **To PPT**。
3. 确认标题是 `1 frame selected` 或 `N frames selected`，芯片里的名称与选中项一致。
4. 选择 **Editable PPT** 或 **Image-based PPT**。
5. 点击 **Export to PowerPoint**。
6. 浏览器下载 `Figma_Export.pptx`。成功时界面显示 `Export successful !`。

没有选中 Frame 时，界面显示 `0 frames selected` 和 `Please select at least one frame.`，按钮不可点。

## 输入输出示例

**输入**

当前页选中两个 Frame：

| 图层名 | 尺寸 | 内容 |
|---|---|---|
| `02 Cover` | 1440×810 | 一个标题文本、一张底图 |
| `01 Title` | 1920×1080 | 一个标题文本、一个矩形 |

**输出文件：** `Figma_Export.pptx`

| | Editable PPT | Image-based PPT |
|---|---|---|
| 页数 | 2 | 2 |
| 页序 | 先 `01 Title`，后 `02 Cover` | 相同 |
| 页面尺寸 | 每页 1920×1080 磅 | 每页 1920×1080 磅 |
| `01 Title` | 标题是文本框，矩形是形状 | 整页一张 2 倍 PNG |
| `02 Cover` | 标题尽量是文本框；按比例缩放到 1920×1080 内并居中 | 整页一张 2 倍 PNG，同样居中留白 |

## 开发

```bash
npm run build       # 生成 dist/code.js 与 dist/ui.html
npm run watch
npm run typecheck
npm test
```

转换边界和尚未对齐的视觉差异见 [`docs/known-limitations.md`](docs/known-limitations.md)。规则说明见 [`docs/conversion-rules.md`](docs/conversion-rules.md)。
