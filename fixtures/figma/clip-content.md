# 最小样例：Frame + Clip Content

## 结构（任意页面可复现）

1. 根 Frame（幻灯片）
2. 子 Frame：开启 **Clip content**
3. 子 Frame 内放一个矩形，故意超出子 Frame 边界（例如 x 为负或宽超出）

## 期望导出

- 子 Frame 整节点为**局部 PNG**（reason: `clipsContent with overflow`）
- 溢出部分在子 Frame 外不可见（与 Figma 一致）
- 根 Frame 上其它简单文本/矩形仍可原生编辑

## 反例（错误实现）

- 把子节点拆成原生形状导致溢出画到幻灯片上
- 为修某一页而写死坐标
