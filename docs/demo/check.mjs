#!/usr/bin/env node
// docs/demo 自检脚本（零依赖）：`node docs/demo/check.mjs`，任一检查失败 exit 1。
// 规则约定见 CLAUDE.md「硬性约定」：改动后必须跑通过。
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const DEMO = dirname(fileURLToPath(import.meta.url));
const errors = [];
const ok = (msg) => console.log('  ✓ ' + msg);
const fail = (msg) => { errors.push(msg); console.error('  ✗ ' + msg); };

// 加载并导出脚本内顶层 const（i18n/data/config 均无浏览器副作用，仅 localStorage 需打桩）
function loadGlobals(file, exportStmt, stubs = '') {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext('const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };' + stubs, ctx);
  vm.runInContext(readFileSync(join(DEMO, 'js', file), 'utf8') + '\n' + exportStmt, ctx);
  return ctx;
}

console.log('■ 1. CSS：括号平衡 + 锚点规则');
const cssAnchors = {
  'base.css': ':root',
  'layout.css': '.app-shell',
  'views.css': '.list-container',
  'settings.css': '.settings-layout',
  'drawer.css': '.edit-drawer'
};
for (const [name, anchor] of Object.entries(cssAnchors)) {
  const p = join(DEMO, 'css', name);
  if (!existsSync(p)) { fail(`${name} 缺失`); continue; }
  const txt = readFileSync(p, 'utf8');
  const bal = (txt.match(/{/g) || []).length - (txt.match(/}/g) || []).length;
  if (bal !== 0) fail(`${name} 括号不平衡（{ - } = ${bal}）`);
  else if (!txt.includes(anchor)) fail(`${name} 缺少锚点规则「${anchor}」`);
  else ok(`css/${name} 括号平衡且含「${anchor}」`);
}
const html = readFileSync(join(DEMO, 'index.html'), 'utf8');
if (html.includes('<style>') || html.includes('\n    <script>\n')) fail('index.html 存在内联 <style>/<script> 残留');
else ok('index.html 无内联样式/脚本');

console.log('■ 2. JS：语法检查');
const jsFiles = readdirSync(join(DEMO, 'js')).filter(f => f.endsWith('.js'));
for (const f of jsFiles) {
  const r = spawnSync(process.execPath, ['--check', join(DEMO, 'js', f)], { encoding: 'utf8' });
  if (r.status !== 0) fail(`js/${f} 语法错误: ${(r.stderr || '').trim().split('\n')[0]}`);
  else ok(`js/${f}`);
}

console.log('■ 3. MOCK_DATA 结构完整性（js/data.js）');
const dataCtx = loadGlobals('data.js', 'this.MOCK_DATA = MOCK_DATA;');
const M = dataCtx.MOCK_DATA;
const topKeys = ['agents', 'invalidPlists', 'crons', 'services', 'aiAgents', 'aiSkills', 'cronPresets', 'liveLogs', 'drawer', 'meta', 'urls'];
const topMissing = topKeys.filter(k => !(k in M));
if (topMissing.length) fail(`MOCK_DATA 缺少顶层键: ${topMissing.join(', ')}`);
else ok('MOCK_DATA 顶层 11 键齐全');
const arrKeys = topKeys.slice(0, 8);
for (const k of arrKeys) {
  if (!Array.isArray(M[k]) || M[k].length === 0) fail(`MOCK_DATA.${k} 应为非空数组`);
}
const drawerReq = ['title', 'scope', 'opsState', 'form', 'status', 'logLines', 'xml'];
if (M.drawer && drawerReq.some(k => !(k in M.drawer))) fail(`MOCK_DATA.drawer 缺少键: ${drawerReq.filter(k => !(k in M.drawer)).join(', ')}`);
const formReq = ['label', 'desc', 'program', 'args', 'env', 'triggers', 'keepAliveMode', 'keepAliveDict', 'watchPaths', 'sciEntries', 'stdout', 'stderr'];
if (M.drawer && M.drawer.form && formReq.some(k => !(k in M.drawer.form))) fail(`MOCK_DATA.drawer.form 缺少键: ${formReq.filter(k => !(k in M.drawer.form)).join(', ')}`);
if (!topMissing.length && arrKeys.every(k => Array.isArray(M[k])) && M.drawer) ok('MOCK_DATA 数组与 drawer 子结构完整');

console.log('■ 4. i18n 双语键一致（js/i18n.js）');
const i18nCtx = loadGlobals('i18n.js', 'this.I18N = I18N;');
const zh = i18nCtx.I18N['zh-CN'] || {};
const en = i18nCtx.I18N['en-US'] || {};
const zk = new Set(Object.keys(zh));
const ek = new Set(Object.keys(en));
const missEn = [...zk].filter(k => !ek.has(k));
const missZh = [...ek].filter(k => !zk.has(k));
if (missEn.length || missZh.length) fail(`i18n 双语键不一致 → 仅 zh 有: ${missEn.slice(0, 5).join(',')}${missEn.length > 5 ? '…' : ''}；仅 en 有: ${missZh.slice(0, 5).join(',')}${missZh.length > 5 ? '…' : ''}`);
else ok(`zh-CN / en-US 键集合一致（${zk.size} 键）`);

console.log('■ 5. MODULES 模块注册表一致性（js/config.js + index.html）');
const stubs = 'const t=()=>"";const fmt=()=>"";const agentData=[];const cronData=[];const svcData=[];const aiAgentData=[];const aiSkillData=[];const GITHUB_REPO_URL="";';
const cfgCtx = loadGlobals('config.js', 'this.MODULES = MODULES;', stubs);
const MODULES = cfgCtx.MODULES;
const reqKeys = ['viewId', 'icon', 'actions', 'showStatusBar'];
for (const [key, rec] of Object.entries(MODULES)) {
  const miss = reqKeys.filter(k => typeof rec[k] === 'undefined');
  if (miss.length) { fail(`MODULES.${key} 缺少必需键: ${miss.join(', ')}`); continue; }
  if (typeof rec.viewId !== 'string') fail(`MODULES.${key}.viewId 应为字符串`);
  if (typeof rec.icon !== 'string') fail(`MODULES.${key}.icon 应为字符串`);
  if (typeof rec.actions !== 'function') fail(`MODULES.${key}.actions 应为函数（顶栏操作区模板）`);
  if (typeof rec.showStatusBar !== 'boolean') fail(`MODULES.${key}.showStatusBar 应为布尔`);
  const bc = rec.breadcrumb !== undefined ? (typeof rec.breadcrumb === 'string' || typeof rec.breadcrumb === 'function')
    : typeof rec.breadcrumbKey === 'string';
  if (!bc) fail(`MODULES.${key} 需要 breadcrumb(字符串/函数) 或 breadcrumbKey(字符串)`);
  if (rec.showStatusBar && typeof rec.statusbar !== 'function') fail(`MODULES.${key} showStatusBar=true 但缺少 statusbar 函数`);
  if (rec.searchPlaceholderKey && typeof rec.searchPlaceholderKey !== 'string') fail(`MODULES.${key}.searchPlaceholderKey 应为字符串`);
  if (rec.searchHandler && typeof rec.searchHandler !== 'function') fail(`MODULES.${key}.searchHandler 应为函数`);
}
if (!Object.keys(MODULES).length) fail('MODULES 为空');
// HTML 引用 ↔ 注册表一一对应（防遗漏核心）
const navMods = [...html.matchAll(/switchModule\('(\w+)'/g)].map(m => m[1]);
const viewDivs = [...html.matchAll(/id="view-(\w+)"/g)].map(m => m[1]);
const keys = new Set(Object.keys(MODULES));
const navUnknown = [...new Set(navMods)].filter(k => !keys.has(k));
const viewUnknown = [...new Set(viewDivs)].filter(k => !keys.has(k));
const viewMissing = [...keys].filter(k => !viewDivs.includes(k));
if (navUnknown.length) fail(`index.html 中 switchModule('…') 引用了未注册模块: ${navUnknown.join(', ')}`);
else ok('index.html 全部 switchModule 引用均已注册');
if (viewUnknown.length) fail(`index.html 中存在未注册的 #view-*: ${viewUnknown.join(', ')}`);
if (viewMissing.length) fail(`MODULES 中以下模块缺少对应的 #view-* div: ${viewMissing.join(', ')}`);
if (!navUnknown.length && !viewUnknown.length && !viewMissing.length) ok('MODULES ↔ #view-* ↔ nav 引用一一对应');
// 抽屉 tab（data-tab 约定，配合 switchDrawerTab 属性匹配）
for (const tb of ['edit', 'status', 'log', 'xml']) {
  if (!html.includes(`data-tab="${tb}"`)) fail(`抽屉 tab 缺少 data-tab="${tb}"`);
}
if (['edit', 'status', 'log', 'xml'].every(tb => html.includes(`data-tab="${tb}"`))) ok('抽屉四个 tab 均带 data-tab');

// 汇总
if (errors.length) {
  console.error(`\n✗ 自检失败：${errors.length} 项问题`);
  process.exit(1);
} else {
  console.log('\n✓ 全部检查通过');
}
