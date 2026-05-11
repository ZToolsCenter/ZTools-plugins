# utools-fork-codehelper

这是一个 uTools 官方插件 **编码小助手(codehelper)** 的镜像，仅做如下修改以适配 ZTools 和避免与可能存在的原生插件重名:

```diff
--- index.html
+++ index.html
@@ -6,4 +6,7 @@
 <body>
   <div id="root"></div>
+  <script>
+    window.utools = window.ztools;
+  </script>
   <script src="index.js"></script>
 </body>
```

```diff
--- plugin.json
+++ plugin.json
@@ -144,1 +144,2 @@
-    "name": "codehelper",
+    "name": "utools-fork-codehelper",
+    "title": "编码小助手",
```
