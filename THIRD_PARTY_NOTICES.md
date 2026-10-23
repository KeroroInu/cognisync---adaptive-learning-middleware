# 第三方画板

draw.io 32.3.0，来源：https://github.com/jgraph/drawio/releases/tag/v32.3.0

使用官方 draw.war 中的浏览器静态资源，未修改第三方源码；构建时排除 Java 服务目录。保留各资源目录随附的许可证与版权标识。项目源码许可证及各组件适用范围以该版本上游说明为准：https://github.com/jgraph/drawio/blob/v32.3.0/LICENSE

分发包 SHA-256：f554a8d8c897b626779e96959b7a2a617c1ead9817a50e78e0facaca3fdcc044

资源通过 frontend/scripts/fetch-drawio.mjs 下载到被 Git 忽略的 public/drawio，随前端构建由本平台静态服务提供。不会把学生设计发送到 diagrams.net。嵌入接口：https://www.drawio.com/docs/reference/embed-mode/ 。
