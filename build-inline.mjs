#!/usr/bin/env node
// 零依赖构建后处理：把 dist/index.html 中引用的模块脚本内联进 HTML，
// 使产物可以 file:// 协议（双击）直接打开，无需本地服务器。
// 用法：npx vite build && node build-inline.mjs [distDir]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const distDir = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : join(process.cwd(), 'dist');
const htmlPath = join(distDir, 'index.html');

if (!existsSync(htmlPath)) {
  console.error(`[build-inline] 未找到 ${htmlPath}，请先运行 vite build`);
  process.exit(1);
}

let html = readFileSync(htmlPath, 'utf8');
let inlined = 0;
const warnings = [];

// 1. 将外部 <script type="module" src="..."> 内联（兼容 crossorigin 带/不带属性值）
html = html.replace(/<script\s+type="module"(?:\s+crossorigin(?:="[^"]*")?)?\s+src="([^"]+)"\s*>\s*<\/script>/g, (m, src) => {
  const filePath = join(distDir, src.replace(/^\.?\//, ''));
  if (!existsSync(filePath)) {
    warnings.push(`缺失文件 ${filePath}，保留原始引用`);
    return m;
  }
  let js = readFileSync(filePath, 'utf8');
  // 防止 JS 内容中的 </script> 提前截断内联脚本标签
  js = js.replace(/<\/script/gi, '<\\/script');
  inlined++;
  return `<script type="module">\n${js}\n</script>`;
});

// 2. 移除 nomodule legacy 脚本（含 polyfills 与入口）及 legacy 探测脚本
//    目标产物仅面向支持 module 的浏览器，legacy 分支在 file:// 下无意义
html = html.replace(/<script nomodule[\s\S]*?<\/script>/g, '');
html = html.replace(
  /<script type="module">!function\(\)\{if\(window\.__vite_is_modern_browser[\s\S]*?<\/script>/g,
  ''
);
html = html.replace(/<script type="module">import\.meta\.url;[\s\S]*?<\/script>/g, '');

writeFileSync(htmlPath, html, 'utf8');

for (const w of warnings) console.warn(`[build-inline] ⚠ ${w}`);
console.log(`[build-inline] 完成：内联了 ${inlined} 个模块脚本，dist/index.html 已可 file:// 直接打开`);
