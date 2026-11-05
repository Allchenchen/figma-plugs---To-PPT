# 最小样例：嵌套 Group + 旋转

## 结构

1. 根 Frame
2. Group A → Group B → RECTANGLE，对 B 或矩形设置非零 Rotation

## 期望

- 旋转节点（或含旋转的不可分解组合）→ 局部 PNG
- 位置相对根 Frame 的 absolute 盒正确，无局部 x/y 累加误差

## 自动化

见 `test/regression-scenarios.test.ts`（rotation → image）与 `test/matrix.test.ts`。
