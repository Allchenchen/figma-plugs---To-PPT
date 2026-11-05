# 人工对比夹具（待验证）

本目录用于存放 **Figma 源文件** 与 **导出 PPTX / 截图**，供人工比对视觉一致性。  
自动化测试无法替代真实 Figma ↔ PowerPoint 渲染差异。

## 建议用例

| ID | 场景 | 验收重点 |
|---|---|---|
| M1 | 复杂 VECTOR/ALPHA Mask Group（多矢量内容） | 遮罩不拆散；位置/比例正确；整段局部 PNG，不拖垮整页 Frame |
| M2 | 透明底品牌标（色块 + 矢量/布尔遮罩，或多子遮罩组） | 不得只剩色块矩形；遮罩与内容同对象；可 PNG 降级 |
| T1 | 多段对齐文本（左/中/右）+ 字重/行距/段距 | 框位置相对 Frame 正确；无固定偏移 hack；对齐边不因加宽漂移 |
| T2 | 文本 `node.opacity` + `Paint.opacity` + 半透明 Group | 透明度可见；多子节点半透明 Group 整体栅格化，不错误相乘 |
| C1 | 嵌套 Frame + Clip content + 子溢出 | 溢出被裁；整节点局部 PNG；页内其它对象仍可编辑 |
| N1 | 嵌套 Group + 旋转 | 位置正确；旋转走局部 PNG |
| R1 | 带边框内容卡 + 圆形 Mask 头像 + 溢出插画（Research） | 边框原生；正文可编辑；头像局部 PNG；溢出不被裁 |

## 放置约定

```
fixtures/
  README.md                 # 本说明
  figma/                    # 放入 .fig 或分享链接说明（勿提交机密）
    mask-penguin.md         # 描述节点结构 / 复现步骤
    logo-mask.md
    text-opacity.md
  exports/                  # 导出的 .pptx 与并排截图（可选 git-lfs）
  checklist.md              # 每次人工验收勾选
```

## 当前状态

- 代码侧已针对上述根因加了单元/集成测试（见 `test/mask.test.ts`、`test/opacity.test.ts`、`test/text-layout.test.ts`、`test/compat.test.ts`）。
- 参考截图：`exports/before-figma.png`（正确）、`exports/after-pptx-broken.png`（旧导出缺陷：红块 Logo、企鹅拆散、正文不透明）。
- **请用最新 `npm run build` 产物重新 Import plugin 后再导出**，否则仍会看到旧结果。
- 新导出结果需再与 `before-figma.png` 目视对比 → 在通过前仍标记为 **待验证**。
