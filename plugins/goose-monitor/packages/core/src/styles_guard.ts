/* 运行态外观守卫：
   - uTools 插件：铺满宿主内容区（不加 boxed）。
   - 普通浏览器预览：加 .boxed，把窗口约束成 800×600 居中窗框，方便像素级对照设计稿。
   通过 ?full=1 可强制铺满（用于把浏览器当独立窗口测试）。 */
const g = window as any;
const isNative = !!g.utools;
const params = new URLSearchParams(location.search);
const forceFull = params.get("full") === "1";
const forceBoxed = params.get("boxed") === "1";

if ((!isNative && !forceFull) || forceBoxed) {
  document.body.classList.add("boxed");
}

export {};
