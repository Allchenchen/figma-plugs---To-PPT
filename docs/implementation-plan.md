# 实施顺序与验收标准

## 能力盘点（相对代码现状）

| 能力 | 状态 | 备注 |
|---|---|---|
| Frame → 多幻灯片 IR | 已完成 | |
| 绝对坐标 / 相对 Frame | 已完成 | |
| TEXT / RECT / ELLIPSE 原生 | 已完成 | |
| 图片填充 + crop/tile 后处理 | 已完成 | |
| Mask 分段 + 整组 PNG | 已完成 | 含回归单测 |
| 文本 Fill opacity + 底色烘焙 | 已完成 | 待桌面目视 |
| 半透明多子 Group → PNG | 已完成 | |
| renderBounds / PNG 宽高比放置 | 已完成 | |
| clipsContent + 溢出 → PNG | 已完成 | |
| 布局 Frame chrome + 深层 Mask 不整卡栅格化 | 已完成 | Research 页类结构 |
| 矩阵模块 | 部分 | 纯函数就绪，Reader 未全面用累计矩阵放置旋转 native |
| editable vs fidelity 策略 | 已完成 | `decideFallback(node, mode)`；导出选项传入 Reader |
| 双重质量报告（可编辑占比 / 整页栅格嫌疑） | 已完成 | `report/quality.ts` + UI 面板 |
| 原生旋转 / 复杂 SVG 路径 | 未实现 | P3 |
| 自动化像素回归（PPT 渲染） | 未实现 | 需桌面或无头 PPT；现为 OOXML + 人工 fixtures |
| 开源文档交付 | 进行中 | 本目录五份文档 |

---

## P0 — 当前页问题 → 通用规则（进行中 / 大部分完成）

| 项 | 通用规则 | 验收 |
|---|---|---|
| Mask 拆散 | R-MASK-2/3 | `test/mask.test.ts` + `test/compat.test.ts`；人工 M1/M2 |
| 图形变形 / 错位 | R-GEO-2/3/6 | `test/image-placement.test.ts` |
| 文字位置 | R-TXT-1/2 | `test/text-layout.test.ts` |
| 文字透明度 | R-OP-3/4 | `test/opacity.test.ts` |
| Clip content | R-CLIP-1 | `test/geometry-clip.test.ts` |

**P0 出口**：`npm run typecheck && npm test && npm run build` 全绿；fixtures checklist 人工项仍标「待验证」直至桌面确认。

## P1 — 基础引擎

- 旋转：评估原生 `rot` vs 继续 PNG
- INSTANCE / 变体属性更完整读取
- 图层顺序与 zIndex 对照报告
- 策略分叉：`fidelity` 提高 PNG 比例；`editable` 放宽 demask 条件（仍禁止拆复杂 mask）

## P2 — 文本与复杂组合

- 已完成：TextRun / Paragraph / VisualLine 三级模型与逐段落混合行距 OOXML
- 已完成：段内混合行距按 SVG 视觉行进行最小范围原生文本框拆分
- 已完成：Frame / Group / Component / Instance / Auto Layout 统一 TextNode 入口
- 已完成：字符/段落/TextBox 属性分层及简单累计旋转、缩放、翻转
- 已完成：混合行距验收测试 `test/mixed-line-height.test.ts`（结构层；像素视觉待人工）
- 缺失字体诊断/警告（默认保留源字体，禁止静默替换）
- Auto Layout 间距与文本框高度
- 复合蒙版更细 picture-shape 路径

## P3 — OOXML 增强

- 参考 svg2ooxml **规范**（不引入 AGPL 代码）扩展 custGeom / 渐变
- 减少不必要的 STAR/POLYGON PNG

## P4 — 回归体系

- 扩展 `fixtures/figma/*` 最小结构说明
- 可选：导出 PNG 与 Figma 基准 pixelmatch（需渲染链）
- 可编辑对象统计写入报告摘要

---

## 每阶段工程门禁

1. `npm run typecheck`
2. `npm test`
3. `npm run build`
4. 抽查 PPTX ZIP（`test/ooxml*.ts` / integration）
5. 更新 `known-limitations.md`（勿把计划写成已实现）
6. 人工：`fixtures/checklist.md`

## 本次交付（相对上一状态）

- 策略：`editable` / `fidelity` 真正影响 Compat（导出选项传入 Reader）
- 质量：`report/quality.ts` 双重统计 + UI 报告；禁止把整页 PNG 算成高质量
- 文本：underline / strikethrough 原生映射（FigDeck 对齐）
- 测试：229 项；`strategy` / `quality` 回归
