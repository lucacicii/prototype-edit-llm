# verify-spec-static.cjs 用法

Spec 静态解析 + 契约校验的只读验证（不调模型、不写盘）。

```bash
# 1. 用 sucrase 编译 src 到 .work/sv（CJS）
mkdir -p .work/sv/src/shared .work/sv/src/main/agent
./node_modules/.bin/sucrase ./src/shared -d .work/sv/src/shared --transforms typescript,imports -q
./node_modules/.bin/sucrase ./src/main/agent -d .work/sv/src/main/agent --transforms typescript,imports -q
cd .work/sv/src && find . -name "*.js" | while read f; do mv "$f" "${f%.js}.cjs"; done
sed -i '' "s|require('./topology')|require('./topology.cjs')|; s|require('../../shared/topology')|require('../../shared/topology.cjs')|" shared/spec.cjs main/agent/topology.cjs
cd ../../..

# 2. 跑验证
node scripts/verify-spec-static.cjs proto-mv4kdema
```

为什么绕这一圈：包是 `"type": "module"`，编译产物必须 `.cjs` 才不会当 ESM；
源码 import 不带扩展名，裸 node 解析不了，所以先用 sucrase 转成 CJS。
