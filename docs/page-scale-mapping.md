# 1920 × 1080 pt 页面映射

统一入口：`src/converter/page-scale.ts` + `src/converter/units.ts`。

## 固定页面

| 量 | 值 |
|---|---|
| 宽度 | **1920 pt** |
| 高度 | **1080 pt** |
| 比例 | 16:9 |
| 英寸 | `1920/72` × `1080/72` ≈ **26.6667 × 15** in（自定义布局，非 PPT 默认宽屏） |

布局名：`FIGMA_1920_1080`。

## Frame → 幻灯片

```text
scaleX = 1920 / frameWidth
scaleY = 1080 / frameHeight
scale  = min(scaleX, scaleY)
offset = 居中 letterbox（pt）
```

| Frame | scale | 映射 |
|---|---|---|
| 1920 × 1080 px | 1 | **1 px → 1 pt** |
| 1280 × 720 px | 1.5 | 等比放大 |
| 其他 | `min(...)` | 等比 + 可能 letterbox |

## 发射单位

```text
xIn = round2(xPt) / 72
fontSizePt = round2(figmaSize × scale)
```

- 几何 / 字号在 IR 中为 **pt**（页面映射之后）
- pptxgenjs 只接收 **inch**（pt÷72）；字号参数为 **pt**（不再 ÷72）
- 页面物理英寸 **不** round2
- EMU：`1 pt = 12700 EMU`
- 字号在 page scale 之后 **1:1**（无 UI 微调）
