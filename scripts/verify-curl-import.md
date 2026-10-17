# verify-curl-import.cjs 用法

`src/renderer/src/utils/parseCurl.ts`（设置页「添加服务商」里的「从 curl 导入」）的只读自检。
不碰网络、不写盘、不需要先把应用跑起来。

```bash
node scripts/verify-curl-import.cjs
```

退出码 0 即全过，非 0 会逐条打印期望值与实际值。

## 为什么不走 sucrase CLI

`scripts/verify-spec-static.md` 那套要先 `sucrase <目录> -d <目录>` 再把产物改成 `.cjs`
（因为包是 `"type": "module"`，且源码 import 不带扩展名）。`parseCurl.ts` 没有任何
相对 import，所以这里直接调 sucrase 的 `transform()` API（`imports` 变换负责把
`export` 转成 CJS），省掉中间目录与改名两步。

## 覆盖的边界

分词是这堆用例的重点 —— 用户粘进来的是**命令行**：行尾 `\` 续行、单引号里原样、
双引号里只有 `\"` 是转义、`-H'...'` 这种连写。其余是三条自我约束：
判不出来就说判不出来（不猜方言）、占位符密钥一律不填（`$VAR` / `{{...}}` / `xxxx`）、
丢了东西要出声（附加 header、无请求体、非 JSON 体）。

用例里的密钥一律由 `K(n)` 算出来，不写字面量。
