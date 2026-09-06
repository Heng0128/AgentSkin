# 第三方声明

AgentSkin 包含或依赖于第三方软件。这些组件保留各自的所有权与许可证。

| 组件 | 许可证 | 说明 |
| --- | --- | --- |
| `@agentskin/engine` | Apache-2.0 | 随本仓库 vendored 于 `src/engine/`，许可文本见 `licenses/Apache-2.0.txt` |
| Electron | MIT | https://github.com/electron/electron |
| React | MIT | https://github.com/facebook/react |
| React DOM | MIT | https://github.com/facebook/react |
| Scheduler | MIT | https://github.com/facebook/react |
| `@fontsource-variable/space-grotesk` | OFL-1.1 | 随渲染进程分发的可变字体；SIL Open Font License 1.1 要求分发时保留版权声明（Copyright 2021 The Space Grotesk Project Authors, https://github.com/floriankarsten/space-grotesk） |
| `@fontsource/ibm-plex-mono` | OFL-1.1 | 随渲染进程分发的等宽字体；SIL Open Font License 1.1 要求分发时保留版权声明（Copyright 2017 IBM Corp.） |
| `lightningcss` | MPL-2.0 | 仅用于构建期 CSS 编译（devDependency），不随产品分发；与 AgentSkin 自身 MPL-2.0 兼容 |

> 说明：`sharp`（依赖 libvips，Apache-2.0 AND LGPL-3.0-or-later）仅作为构建期图片生成工具使用，不随产品分发，不触发 LGPL 传染条款。若未来将 sharp 或其产物作为独立分发的库集成，需重新评估并提供 LGPL-3.0 声明与源码获取途径。

随附 Core 的 Apache-2.0 许可文本包含在 `licenses/Apache-2.0.txt` 中。分发包可能还包含各依赖项自带的许可文件。本声明仅作补充，不替代或修改任何第三方许可证。
