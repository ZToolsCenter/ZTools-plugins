import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
const packages = ['vue', '@vue/runtime-core', '@vue/runtime-dom', '@vue/reactivity', '@vue/shared', 'lucide-vue-next'];
let notices = '# Third-party notices\n\n';
for (const name of packages) {
  const base = `node_modules/${name}`;
  const license = ['LICENSE', 'LICENSE.md', 'LICENSE.txt'].find(f => existsSync(`${base}/${f}`));
  if (!license) throw new Error(`Missing license: ${name}`);
  notices += `\n## ${name}\n\n${readFileSync(`${base}/${license}`, 'utf8')}\n`;
}
writeFileSync('dist/THIRD-PARTY-NOTICES.txt', notices);
copyFileSync('LICENSE', 'dist/LICENSE');
