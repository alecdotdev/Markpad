# 编辑器链接行为测试(#393 第 5 条)

在**编辑器**里对下面每一行的 URL 按 ⌘+点击(Windows 是 Ctrl+点击),
记录发生了什么。不要在预览里点——预览侧是处理过的,编辑器侧没有。

## A. http(s) —— 走 windowOpenNoOpener

https://example.com

预期之一:系统浏览器打开 / 新开一个空白 webview / 什么都没发生

## B. 非 http scheme —— 走 mainWindow.location.href

file:///Applications

这条是关键。openerService.js:109 对非 http/https 的分支是
`mainWindow.location.href = href`,在 Tauri 里「当前窗口」就是应用本身。

## C. 对照:同样的链接在预览里

[点我](https://example.com) 和 [file 链接](file:///Applications)

预览侧走 handleLinkClick,应该规规矩矩用外部打开器。
