【俄语云端学习工具箱 · 部署与扩展说明】

文件夹内包含的文件：
1. index.html              —— 合一版学习工作台主页（已内置「俄语背诵室」与「单词挖空练习」+ 云同步面板）
2. Russian_Recitation.html —— 你原来的「俄语背诵室」独立页面（已接入 sync.js 云同步与 PWA 离线支持）
3. Russian_WordCloze.html  —— 你原来的「俄语单词挖空练习」独立页面（已接入 sync.js 云同步与 PWA 离线支持）
4. sync.js                 —— 通用离线优先云端同步插件（所有 HTML 页面共用）
5. sw.js + manifest.json   —— PWA 离线缓存脚本与手机桌面图标配置（支持断网打开）

【以后如何添加你的第 3、第 4 个 HTML 工具？】
1. 把你新写的 HTML 文件放到这个文件夹里。
2. 在新 HTML 文件的 </body> 标签前加一行：
   <script src="sync.js"></script>
3. 重新拖拽上传到 Cloudflare Pages 或推送到 GitHub Pages 即可！
