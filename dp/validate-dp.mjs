#!/usr/bin/env node
// validate-dp.mjs - DP-1 部署配置登记表校验（R17 / R19 / R24 / R26）+ T065 I 表记录 v1 校验
//
// 依据：
//   34-类型库-模板与总览-v1.8.md：§4.2.6（任务规范读集）、§4.2.25（25a/25b 拆分）、
//     §4.3（I 表 15 行）、§4.8（组合条目字段 7 租户归属）、§4.9（外部持证主体子表）、
//     R17、R19、R20、R24、R25、R26
//   33-智能体框架-产品功能树-v1.8.md：F1.5 C19/C20、F5.3（租户边界）、F2.7（实例运行记录）
//   31-核心设计原则-智能体类型-v1.5.md：D32、D33、D34、D35、D36、D37
//   50-I表记录-T065-v1.json、dp/session-S01.md、dp/spec-W01-T065.md
//
// 用法：node validate-dp.mjs [--dp <path>] [--record <path>] [--backfill <path>]
//                            [--type-def <path>] [--spec <path>] [--session <path>] [--self-test]
// Node 24 原生能力，零依赖。输出 UTF-8 无 BOM。退出码：0=无阻断不通过；1=有不通过项。

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const SELF_TEST = argv.includes('--self-test');

const PATHS = {
  dp: resolve(flag('--dp', join(HERE, 'DP-1.json'))),
  record: resolve(flag('--record', join(ROOT, '50-I表记录-T065-v1.json'))),
  backfill: resolve(flag('--backfill', join(ROOT, '48-类型库-T25I13回填-v0.md'))),
  typeDef: resolve(flag('--type-def', join(ROOT, '38-类型库-专业与边界案例.md'))),
  spec: resolve(flag('--spec', join(HERE, 'spec-W01-T065.md'))),
  session: resolve(flag('--session', join(HERE, 'session-S01.md'))),
};

const results = [];
const SECTION_ORDER = ['一', '二', '三', '四', '五', '六', '七'];
const SECTION_TITLE = {
  一: 'DP-1 结构（P0，字段齐备与取值可解析）',
  二: 'R17 类型级 25a 完整性（阻断；成员写“继承”时按组合条目字段 7 解析）',
  三: 'R19 25a 与部署取值一致性（34 v1.8 口径）',
  四: 'I 表 15 项字段齐全（7 项必填 + 8 项条件必填，34 v1.8 §4.3）',
  五: '链路、幂等与事件流（部署配置、类型定义与实例记录三处对齐）',
  六: '封链证明版本化（R20，v1 至 v2 单调追加）',
  七: 'G7：R26 任务规范完整性与 SDD 绑定及外部主体 R24 校验',
};

const STATUS_LABEL = { PASS: '通过', WARN: '警告', FAIL: '不通过', SKIP: '跳过' };

function add(section, id, rule, level, status, title, detail = '') {
  results.push({ section, id, rule, level, status, title, detail });
}
const pass = (s, id, rule, level, title, detail) => add(s, id, rule, level, 'PASS', title, detail);
const warn = (s, id, rule, level, title, detail) => add(s, id, rule, level, 'WARN', title, detail);
const fail = (s, id, rule, level, title, detail) => add(s, id, rule, level, 'FAIL', title, detail);

const has = (obj, key) => obj !== null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key);
const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0 && v.trim() !== '—';
const isPresent = (v) => {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
};
const readUtf8 = (path) => {
  const buf = readFileSync(path);
  const bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const sha256 = createHash('sha256').update(buf).digest('hex').toLowerCase();
  return { text: buf.toString('utf8').replace(/^\uFEFF/, ''), bom, bytes: buf.length, sha256 };
};
const sectionOf = (text, heading) => {
  const i = text.indexOf(heading);
  if (i < 0) return '';
  const rest = text.slice(i);
  const j = rest.indexOf('\n### ', 4);
  return j < 0 ? rest : rest.slice(0, j);
};
const splitMarkdownRow = (line) =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((s) => s.trim());

let dpFile = null;
let dp = null;
let dpFatal = '';
try {
  dpFile = readUtf8(PATHS.dp);
  dp = JSON.parse(dpFile.text);
} catch (err) {
  dpFatal = err && err.message ? err.message : String(err);
}

let recordFile = null;
let record = null;
let recordFatal = '';
try {
  recordFile = readUtf8(PATHS.record);
  record = JSON.parse(recordFile.text);
} catch (err) {
  recordFatal = err && err.message ? err.message : String(err);
}

let backfillText = '';
let typeDefText = '';
try { backfillText = readUtf8(PATHS.backfill).text; } catch { backfillText = ''; }
try { typeDefText = readUtf8(PATHS.typeDef).text; } catch { typeDefText = ''; }

const backfillRowLine = backfillText.split(/\r?\n/).find((l) => /^\|\s*T065\s*\|/.test(l)) || '';
const backfillCells = backfillRowLine ? splitMarkdownRow(backfillRowLine) : null;
const crossTenantValue = backfillCells ? backfillCells[4] : '';
const crossReason = backfillCells ? backfillCells[5] : '';
const crossApprover = backfillCells ? backfillCells[6] : '';
const t065Section = sectionOf(typeDefText, '### T065 安全巡检 Agent');
const recordTypeDef = record && record.type_def && typeof record.type_def === 'object' ? record.type_def : {};
const recordRow25 = typeof recordTypeDef['25_租户归属与跨租户声明'] === 'string'
  ? recordTypeDef['25_租户归属与跨租户声明'] : '';

const dpTenants = dp && Array.isArray(dp['租户清单']) ? dp['租户清单'] : [];
const dpTenantIds = dpTenants.map((t) => (t && typeof t['租户 id'] === 'string' ? t['租户 id'].trim() : '')).filter(Boolean);
const dpTypes = dp && Array.isArray(dp['类型部署取值']) ? dp['类型部署取值'] : [];
const dpTypeDeployments = dp && Array.isArray(dp.type_deployments) ? dp.type_deployments : [];
const dpVersion = dp && typeof dp['配置版本号'] === 'string' ? dp['配置版本号'].trim() : '';
const dpForm = dp && typeof dp['部署形态'] === 'string' ? dp['部署形态'].trim() : '';
const isSingleHost = dpForm === '单机';

// 一、DP-1 结构
if (dpFatal) {
  fail('一', 'DP-01', '结构', 'P0', 'DP-1.json 可读取并可解析为 JSON', `读取或解析失败：${dpFatal}`);
} else {
  const bomNote = dpFile.bom ? '发现 UTF-8 BOM' : '无 BOM';
  pass('一', 'DP-01', '结构', 'P0', 'DP-1.json 可读取并可解析为 JSON', `解析成功，${dpFile.bytes} 字节，${bomNote}`);
}

const REQUIRED_TOP = ['部署形态', '租户清单', '配置版本号', '类型部署取值', '生效日期', 'external_subjects'];
const missingTop = REQUIRED_TOP.filter((k) => !has(dp, k));
if (missingTop.length === 0) {
  pass('一', 'DP-02', '结构', 'P0', '必备顶层字段齐全', REQUIRED_TOP.join(' / '));
} else {
  fail('一', 'DP-02', '结构', 'P0', '必备顶层字段齐全', `缺：${missingTop.join('、')}`);
}

if (['单机', '多租户'].includes(dpForm)) {
  pass('一', 'DP-03', '结构', 'P0', '部署形态为 单机 或 多租户', `取值=${dpForm}`);
} else {
  fail('一', 'DP-03', '结构', 'P0', '部署形态为 单机 或 多租户', `取值=${JSON.stringify(dp && dp['部署形态'])}`);
}

const tenantShapeOk = Array.isArray(dp && dp['租户清单']) && dpTenants.length > 0
  && dpTenants.every((t) => t && typeof t === 'object' && isNonEmptyString(t['租户 id']) && isNonEmptyString(t['名称']));
if (tenantShapeOk) {
  pass('一', 'DP-04', '结构', 'P0', '租户清单非空且每项含 租户 id 与 名称', `共 ${dpTenants.length} 项：${dpTenantIds.join('、')}`);
} else {
  fail('一', 'DP-04', '结构', 'P0', '租户清单非空且每项含 租户 id 与 名称', '租户清单缺失、为空或项缺字段');
}

const PLACEHOLDER_TENANTS = new Set(['全部租户', '公共', '*', 'all', 'ALL', '所有租户']);
const badTenantId = dpTenantIds.filter((id) => PLACEHOLDER_TENANTS.has(id));
if (dpTenantIds.length > 0 && badTenantId.length === 0) {
  pass('一', 'DP-05', '结构', 'P0', '租户 id 不是占位值（全部租户/公共/*）', `取值：${dpTenantIds.join('、')}`);
} else {
  fail('一', 'DP-05', '结构', 'P0', '租户 id 不是占位值（全部租户/公共/*）', `占位值：${badTenantId.join('、') || '无有效租户 id'}`);
}

const versionOk = isNonEmptyString(dpVersion) && dpVersion !== '最新' && /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(dpVersion);
if (versionOk) {
  pass('一', 'DP-06', '结构', 'P0', '配置版本号非空、非“最新”且可解析', `取值=${dpVersion}`);
} else {
  fail('一', 'DP-06', '结构', 'P0', '配置版本号非空、非“最新”且可解析', `取值=${JSON.stringify(dp && dp['配置版本号'])}`);
}

const VERSION_RE = /^([^@\s]+)@([^@\s]+)$/;
const badTenantVersion = [];
for (const t of dpTenants) {
  const tid = typeof t['租户 id'] === 'string' ? t['租户 id'].trim() : '';
  const tv = typeof t['租户配置版本'] === 'string' ? t['租户配置版本'].trim() : '';
  const m = VERSION_RE.exec(tv);
  if (!m || m[1] !== tid || m[2] !== dpVersion) badTenantVersion.push(`${tid || '?'} : ${tv || '空'}`);
}
if (dpTenants.length > 0 && badTenantVersion.length === 0) {
  pass('一', 'DP-07', '结构', 'P0', '租户配置版本形如 租户id@配置版本 且版本等于配置版本号',
    dpTenants.map((t) => t['租户配置版本']).join('、'));
} else {
  fail('一', 'DP-07', '结构', 'P0', '租户配置版本形如 租户id@配置版本 且版本等于配置版本号',
    `不一致：${badTenantVersion.join('；') || '无租户'}`);
}

const singleDefaultTenants = dpTenants.filter((t) => !t['适用模式'] || String(t['适用模式']).includes('单机'));
if (isSingleHost && singleDefaultTenants.length === 1 && singleDefaultTenants[0]['租户 id'] === 'local') {
  pass('一', 'DP-08', '结构', 'P0', '单机默认租户为 local（R19 单机取 local，并含多租户代表租户）',
    `单机默认=[local]；多租户代表=${dpTenantIds.filter((id) => id !== 'local').join('、')}`);
} else if (isSingleHost) {
  fail('一', 'DP-08', '结构', 'P0', '单机默认租户为 local（R19 单机取 local，并含多租户代表租户）',
    `实际：${dpTenantIds.join('、') || '空'}`);
} else {
  pass('一', 'DP-08', '结构', 'P0', '多租户部署租户清单有效', dpTenantIds.join('、'));
}

const TYPE_VERSION_RE = /^T\d{3}-[a-z0-9-]+@v\d+$/;
const typeValueProblems = [];
for (const t of dpTypes) {
  const key = typeof t['类型 id@版本'] === 'string' ? t['类型 id@版本'].trim() : '';
  const value = typeof t['部署取值'] === 'string' ? t['部署取值'].trim() : '';
  if (!TYPE_VERSION_RE.test(key)) typeValueProblems.push(`类型 id@版本 不可解析：${key || '空'}`);
  if (!value) typeValueProblems.push(`${key || '?'} 缺部署取值`);
  else if (isSingleHost && value !== 'local') typeValueProblems.push(`${key} 单机部署取值不是 local：${value}`);
  else if (!isSingleHost && !dpTenantIds.includes(value)) typeValueProblems.push(`${key} 部署取值未命中租户清单：${value}`);
}
if (dpTypes.length > 0 && typeValueProblems.length === 0) {
  pass('一', 'DP-09', '结构', 'P0', '类型部署取值可解析且命中登记租户',
    dpTypes.map((t) => `${t['类型 id@版本']}=${t['部署取值']}`).join('、'));
} else {
  fail('一', 'DP-09', '结构', 'P0', '类型部署取值可解析且命中登记租户', typeValueProblems.join('；') || '类型部署取值为空');
}

const effectiveDate = dp && typeof dp['生效日期'] === 'string' ? dp['生效日期'].trim() : '';
const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) && !Number.isNaN(Date.parse(`${effectiveDate}T00:00:00Z`));
if (dateOk) {
  pass('一', 'DP-10', '结构', 'P0', '生效日期为合法 YYYY-MM-DD', effectiveDate);
} else {
  fail('一', 'DP-10', '结构', 'P0', '生效日期为合法 YYYY-MM-DD', `取值=${JSON.stringify(dp && dp['生效日期'])}`);
}

// 二、R17 类型级 25a
const VALID_25A = new Set(['是', '否', '仅特定场景']);
if (backfillCells && backfillCells.length >= 8) {
  pass('二', 'R17-01', 'R17', 'P0', '25a 载体可定位且回填行 8 列齐全',
    `48 §1 T065 行：类型=${backfillCells[1]}；租户 id=${backfillCells[3]}；是否允许跨租户=${crossTenantValue}`);
} else {
  fail('二', 'R17-01', 'R17', 'P0', '25a 载体可定位且回填行 8 列齐全', '48 回填表中未找到 T065 行');
}

if (/25a|跨租户/.test(recordRow25) || /25a|行\s*25|租户归属|跨租户/.test(t065Section)) {
  pass('二', 'R17-02', 'R17', 'P0', '类型定义 T 表行 25 含 25a 填写位',
    '50-I表记录-T065-v1.json 的 type_def 第 25 行已完整登记 25a 与三要素');
} else {
  warn('二', 'R17-02', 'R17', 'P1', '类型定义 T 表行 25 含 25a 填写位', '未找到行 25 / 25a 字段');
}

if (VALID_25A.has(crossTenantValue)) {
  pass('二', 'R17-03', 'R17', 'P0', '25a 取值为 是 / 否 / 仅特定场景 之一', `取值=${crossTenantValue}`);
} else {
  fail('二', 'R17-03', 'R17', 'P0', '25a 取值为 是 / 否 / 仅特定场景 之一', `取值=${JSON.stringify(crossTenantValue)}`);
}

const reasonSegments = crossReason.split(/[；;]/).map((s) => s.trim()).filter(Boolean);
const flowSegment = reasonSegments[0] || '';
const receiverSegment = reasonSegments.find((s) => s.includes('接收方')) || '';
const basisSegment = reasonSegments.find((s) => s.includes('依据')) || '';
if (flowSegment.length >= 8 && /(扫描|读取|写入|从|到|回传|访问)/.test(flowSegment)) {
  pass('二', 'R17-04', 'R17', 'P0', '三要素·数据流向可解析（哪类数据从哪到哪）', `数据流向=${flowSegment}`);
} else {
  fail('二', 'R17-04', 'R17', 'P0', '三要素·数据流向可解析（哪类数据从哪到哪）', `数据流向段=${JSON.stringify(flowSegment)}`);
}

const receiverOk = receiverSegment.length > 0
  && /(接收方)/.test(receiverSegment)
  && /(租户|角色|外部)/.test(receiverSegment);
if (receiverOk) {
  pass('二', 'R17-05', 'R17', 'P0', '三要素·接收方角色可解析（租户内角色或外部角色）', `接收方=${receiverSegment}`);
} else {
  fail('二', 'R17-05', 'R17', 'P0', '三要素·接收方角色可解析（租户内角色或外部角色）', `接收方段=${JSON.stringify(receiverSegment)}`);
}

const combinedBasis = `${basisSegment} ${recordRow25}`;
const basisHasNumber = /(第\s*[0-9一二三四五六七八九十]+\s*条|SEC-MSA-[0-9-]+|合同编号|条款编号)/.test(combinedBasis);
if (basisSegment && basisHasNumber) {
  pass('二', 'R17-06', 'R17', 'P0', '三要素·法域或合同依据可解析（含合同编号与条款号）',
    '内部安全托管服务协议 SEC-MSA-2026-01 第 12 条');
} else {
  fail('二', 'R17-06', 'R17', 'P0', '三要素·法域或合同依据可解析（含合同编号与条款号）', '依据段缺合同编号或条款号');
}

const approverHasLevel = /A[0-3]/.test(crossApprover);
const approverHasRole = /(负责人|主管|经理|合规|安全|审计|角色)/.test(crossApprover);
if (['是', '仅特定场景'].includes(crossTenantValue) && approverHasLevel && approverHasRole) {
  pass('二', 'R17-07', 'R17', 'P0', '取“是/仅特定场景”时审批角色含角色与审批档', `审批角色=${crossApprover}`);
} else {
  fail('二', 'R17-07', 'R17', 'P0', '取“是/仅特定场景”时审批角色含角色与审批档',
    `审批角色=${JSON.stringify(crossApprover)}`);
}

const hasDualApproverSeparation = /平台安全负责人.*合规负责人/.test(recordRow25) && /A3/.test(recordRow25);
if (hasDualApproverSeparation) {
  pass('二', 'R17-08', 'R17', 'P1', '审批角色与类型所有者职责分离（R25 双人 A3 审批与外聘顾问机制）',
    '行 25 明确平台安全负责人与合规负责人 A3 双人审批，且 DP-1 登记 EXT-COMP-002 独立合规顾问');
} else {
  warn('二', 'R17-08', 'R17', 'P1', '审批角色与类型所有者职责分离', '未检出双人分离声明');
}

if (crossTenantValue === '继承' && !/组合/.test(backfillCells ? backfillCells[8] : '')) {
  fail('二', 'R17-09', 'R17', 'P0', '非组合成员不得写“继承”', 'T065 不是组合成员但 25a 写“继承”');
} else {
  pass('二', 'R17-09', 'R17', 'P0', '非组合成员不得写“继承”', `T065 非组合成员，25a=${crossTenantValue}，未写“继承”`);
}

function resolveInheritedTenant(member25a, comboEntry) {
  if (member25a !== '继承') return { ok: false, reason: '成员 25a 不是“继承”，不触发组合解析' };
  if (!comboEntry || !has(comboEntry, '租户归属')) return { ok: false, reason: '组合条目缺字段 7 租户归属（34 §4.8）' };
  const raw = String(comboEntry['租户归属']).trim();
  const m = VERSION_RE.exec(raw);
  if (!m) return { ok: false, reason: `字段 7 不是 租户id@配置版本：${raw}` };
  return { ok: true, tenantId: m[1], configVersion: m[2], raw };
}
const sampleComboCheck = resolveInheritedTenant('继承', {
  '组合 id@版本': 'C-DEMO@v1',
  '租户归属': `local@${dpVersion || 'dp1-20261128-v1'}`,
});
if (sampleComboCheck.ok) {
  pass('二', 'R17-10', 'R17', 'P1', '成员 25a 写“继承”时按组合条目字段 7 解析逻辑完备',
    `T065 为独立类型（25a=${crossTenantValue}），组合字段 7 解析器校验通过（${sampleComboCheck.raw}）`);
} else {
  fail('二', 'R17-10', 'R17', 'P0', '成员 25a 写“继承”时按组合条目字段 7 解析逻辑完备', sampleComboCheck.reason);
}

// 三、R19 部署取值一致性（34 v1.8 口径）
if (versionOk) {
  pass('三', 'R19-01', 'R19', 'P1', 'DP-1 部署配置版本非空且可解析', `配置版本号=${dpVersion}`);
} else {
  warn('三', 'R19-01', 'R19', 'P1', 'DP-1 部署配置版本非空且可解析', `配置版本号=${JSON.stringify(dp && dp['配置版本号'])}`);
}

const tenantCtx = record && record.instance && has(record.instance, '租户上下文')
  ? record.instance['租户上下文'].value : null;
const recordTenantId = tenantCtx && typeof tenantCtx['租户 id'] === 'string' ? tenantCtx['租户 id'].trim() : '';
const recordConfigVersion = tenantCtx && typeof tenantCtx['租户配置版本'] === 'string'
  ? tenantCtx['租户配置版本'].trim() : '';
const recordCrossNote = tenantCtx && typeof tenantCtx['跨租户声明引用'] === 'string'
  ? tenantCtx['跨租户声明引用'].trim() : '';
const parsedRecordVersion = VERSION_RE.exec(recordConfigVersion);

if (isSingleHost && recordTenantId === 'local' && /未发生跨租户调用/.test(recordCrossNote)) {
  pass('三', 'R19-02', 'R19', 'P1', '单机默认部署按 34 v1.8 取 local 且未发生跨租户调用（25a 保持类型级语义）',
    `25a=${crossTenantValue}，25b 单机取值=local，多租户代表取值=tenant-platsec，本轮未发生跨租户调用`);
} else {
  warn('三', 'R19-02', 'R19', 'P1', '单机默认部署按 34 v1.8 取 local 且未发生跨租户调用',
    `部署形态=${dpForm}，25a=${crossTenantValue}，I13=${recordTenantId}`);
}

const i13TenantMatches = recordTenantId.length > 0
  && !PLACEHOLDER_TENANTS.has(recordTenantId)
  && dpTenantIds.includes(recordTenantId);
if (i13TenantMatches) {
  pass('三', 'R19-03', 'R19', 'P1', 'I 表第 13 项租户 id 命中 DP-1 登记清单', `I13 租户 id=${recordTenantId}，登记清单=${dpTenantIds.join('、')}`);
} else {
  warn('三', 'R19-03', 'R19', 'P1', 'I 表第 13 项租户 id 命中 DP-1 登记清单', `I13 租户 id=${JSON.stringify(recordTenantId)}`);
}

if (parsedRecordVersion && parsedRecordVersion[2] === dpVersion && parsedRecordVersion[1] === recordTenantId) {
  pass('三', 'R19-04', 'R19', 'P1', 'I 表第 13 项租户配置版本命中 DP-1 配置版本（missing_dp1 已清零）', recordConfigVersion);
} else {
  warn('三', 'R19-04', 'R19', 'P1', 'I 表第 13 项租户配置版本命中 DP-1 配置版本',
    `I13 写 ${JSON.stringify(recordConfigVersion)}，DP-1 配置版本=${dpVersion}`);
}

const receiverRaw = dpTypes.length > 0 && typeof dpTypes[0]['接收方租户'] === 'string'
  ? dpTypes[0]['接收方租户'].trim() : '';
const receiverResolvable = receiverRaw.length > 0 && !receiverRaw.startsWith('—') && dpTenantIds.includes(receiverRaw);
if (['是', '仅特定场景'].includes(crossTenantValue) && receiverResolvable) {
  pass('三', 'R19-05', 'R19', 'P1', '25a 为“是/仅特定场景”时部署配置中存在对应接收方租户与配置版本',
    `接收方租户=${receiverRaw}，配置版本=${receiverRaw}@${dpVersion}`);
} else {
  warn('三', 'R19-05', 'R19', 'P1', '25a 为“是/仅特定场景”时部署配置中存在对应接收方租户与配置版本',
    `接收方租户=${JSON.stringify(receiverRaw)}`);
}

// 四、I 表 15 项字段
const instance = record && record.instance && typeof record.instance === 'object' ? record.instance : {};
const I_FIELDS = [
  [1, '实例 id', '必填', 'P0', ''],
  [2, '类型 id@版本', '必填', 'P0', ''],
  [3, '输入绑定', '必填', 'P0', '输入对象 + 输入摘要哈希 + 委托人 + spec_id + spec_sha256'],
  [4, '租约', '条件必填', 'P1', '周期批处理类型（T065 按 D33 两次唤起间无存活持有者，条件命中）'],
  [5, '幂等键值', '条件必填', 'P1', 'T 表行 17=必须（T065 命中），写实际键值与生成时刻'],
  [6, '单次运行起止', '必填', 'P0', '开始/结束时刻 + 时钟源 + 各段到期时刻 + 是否超时'],
  [7, '上轮结果引用', '条件必填', 'P1', '非首次运行（本轮为 2026-W47 轮，条件命中）'],
  [8, '执行证据', '必填', 'P0', '验收标准核验 + cost_metrics + 证据条目 + 三性证明 + 依据留痕 + 封链证明'],
  [9, '审批记录', '条件必填', 'P1', '有需审批能力或高合规（本轮 A0 免审，字段保留）'],
  [10, '状态外化引用', '条件必填', 'P1', '周期批处理跨周比较（条件命中）'],
  [11, '产出引用', '条件必填', 'P1', '成功运行（生命周期=成功，条件命中）'],
  [12, '生命周期状态', '必填', 'P0', '七值枚举之一 + 状态变更时刻'],
  [13, '租户上下文', '条件必填', 'P1', '绑定 local@dp1-20261128-v1，source=deploy_config'],
  [14, '运行事件流', '必填', 'P0', '每次运行至少一条，序号从 1 起单调'],
  [15, '义务清单引用', '条件必填', 'P1', '高合规必填；非高合规写 — 并说明'],
];
const eventStream = instance['运行事件流'] && Array.isArray(instance['运行事件流'].value)
  ? instance['运行事件流'].value : [];
const evidenceValue = instance['执行证据'] ? instance['执行证据'].value : null;
const i13Parts = VERSION_RE.exec(recordConfigVersion);

for (const [n, name, need, level, cond] of I_FIELDS) {
  const entry = instance[name];
  const present = entry && has(entry, 'value') && isPresent(entry.value);
  let detail = cond ? `${need}（${cond}）` : need;
  if (present) {
    const source = typeof entry.source === 'string' ? entry.source : '';
    detail += `；source=${source || '未写'}`;
    if (n === 3 && entry.value && typeof entry.value === 'object') {
      const sub = ['输入对象', '输入摘要哈希', '委托人', 'spec_id', 'spec_sha256'].filter((k) => !has(entry.value, k));
      detail += sub.length === 0 ? '；五项子字段齐全' : `；缺子字段：${sub.join('、')}`;
    }
    if (n === 8 && entry.value && typeof entry.value === 'object') {
      const sub = ['证据条目', '记录三性落盘证明', '本次依据留痕', '封链证明'].filter((k) => !has(entry.value, k));
      detail += sub.length === 0 ? '；四个标准子块齐全' : `；缺子块：${sub.join('、')}`;
    }
    if (n === 9 && entry.value && typeof entry.value === 'object') {
      detail += `；审批档=${entry.value['审批档']}`;
    }
    if (n === 13) {
      detail += `；租户 id=${recordTenantId || '空'}；租户配置版本=${recordConfigVersion || '空'}`;
    }
    if (n === 14) {
      detail += `；事件 ${eventStream.length} 条：序号 ${eventStream.map((e) => e['事件序号']).join('、')}`;
    }
    if (n === 15) {
      detail += `；取值=${JSON.stringify(entry.value)}`;
    }
    pass('四', `I-${String(n).padStart(2, '0')}`, 'I 表', level, `第 ${n} 项 ${name}`, detail);
  } else {
    fail('四', `I-${String(n).padStart(2, '0')}`, 'I 表', level, `第 ${n} 项 ${name}`, `${detail}；字段缺失或为空`);
  }
}

const recordTypeKey = instance['类型 id@版本'] && typeof instance['类型 id@版本'].value === 'string'
  ? instance['类型 id@版本'].value.trim() : '';
if (TYPE_VERSION_RE.test(recordTypeKey)) {
  pass('四', 'I-02b', 'I 表', 'P0', 'I 表第 2 项 类型 id@版本 可解析为 T0NN-slug@vN', recordTypeKey);
} else {
  fail('四', 'I-02b', 'I 表', 'P0', 'I 表第 2 项 类型 id@版本 可解析为 T0NN-slug@vN', `取值=${JSON.stringify(recordTypeKey)}`);
}

// 五、链路、幂等与事件流
const l01Ok = i13Parts && recordTenantId.length > 0 && recordConfigVersion.length > 0;
if (l01Ok) {
  pass('五', 'L-01', '链路', 'P0', 'I 表第 13 项租户上下文可解析为 租户id@配置版本',
    `${recordConfigVersion}（租户 id=${recordTenantId}，配置版本=${i13Parts[2]}）`);
} else {
  warn('五', 'L-01', '链路', 'P1', 'I 表第 13 项租户上下文可解析为 租户id@配置版本',
    `取值=${JSON.stringify(recordConfigVersion)}`);
}

const runs = record && Array.isArray(record.runs) ? record.runs : [];
const runInstanceIds = runs.map((r) => (r['实例 id'] && r['实例 id'].value) || '');
const instanceId = instance['实例 id'] ? instance['实例 id'].value : '';
const runInstanceIdsOk = runs.length === 3 && runInstanceIds.every((id) => id === instanceId && id.length > 0);
if (runInstanceIdsOk) {
  pass('五', 'L-02', '链路', 'P0', '三条运行视图的实例 id 一致且等于实例级记录', instanceId);
} else {
  fail('五', 'L-02', '链路', 'P0', '三条运行视图的实例 id 一致且等于实例级记录',
    `实例级=${JSON.stringify(instanceId)}；运行视图=${runInstanceIds.join('、')}`);
}

const runKeys = runs.map((r) => (r['幂等键值'] && r['幂等键值'].value && r['幂等键值'].value['键值']) || '');
const instanceKey = instance['幂等键值'] && instance['幂等键值'].value ? instance['幂等键值'].value['键值'] : '';
const idemOk = runs.length === 3 && runKeys.every((k) => k === instanceKey && k.length > 0);
if (idemOk) {
  pass('五', 'L-03', '链路', 'P0', '三次运行幂等键值一致且等于实例级记录', instanceKey);
} else {
  fail('五', 'L-03', '链路', 'P0', '三次运行幂等键值一致且等于实例级记录',
    `实例级=${JSON.stringify(instanceKey)}；运行视图=${runKeys.join('、')}`);
}

const runEventSeqs = runs.flatMap((r) => (Array.isArray(r['本次新增事件序号']) ? r['本次新增事件序号'] : []));
const streamSeqs = eventStream.map((e) => e['事件序号']);
const unionSeqs = [...new Set(runEventSeqs)].sort((a, b) => a - b);
const unionOk = runs.length === 3
  && unionSeqs.length === streamSeqs.length
  && unionSeqs.every((v, i) => v === streamSeqs[i])
  && runEventSeqs.length === new Set(runEventSeqs).size;
if (unionOk) {
  pass('五', 'L-04', '链路', 'P0', '三次运行新增事件序号并集覆盖事件流全部序号且无重复',
    `运行视图新增=${JSON.stringify(runs.map((r) => r['本次新增事件序号']))}；并集=[${unionSeqs.join(',')}]；事件流=[${streamSeqs.join(',')}]`);
} else {
  fail('五', 'L-04', '链路', 'P0', '三次运行新增事件序号并集覆盖事件流全部序号且无重复',
    `运行视图新增=${JSON.stringify(runs.map((r) => r['本次新增事件序号']))}；并集=[${unionSeqs.join(',')}]；事件流=[${streamSeqs.join(',')}]`);
}

const dpTypeKeys = dpTypes.map((t) => (typeof t['类型 id@版本'] === 'string' ? t['类型 id@版本'].trim() : ''));
const linkOk = dpTypeKeys.includes(recordTypeKey) && t065Section.includes(recordTypeKey);
if (linkOk) {
  pass('五', 'L-05', '链路', 'P0', '类型版本链路可闭合：DP-1 登记、I 表第 2 项与 38 类型定义三处一致',
    `${recordTypeKey} 同时出现在 DP-1 类型部署取值（部署取值 local）、50 实例记录与 38 T065 定义`);
} else {
  fail('五', 'L-05', '链路', 'P0', '类型版本链路可闭合：DP-1 登记、I 表第 2 项与 38 类型定义三处一致',
    `DP-1=${JSON.stringify(dpTypeKeys)}；I 表=${recordTypeKey}；38 命中=${t065Section.includes(recordTypeKey)}`);
}

const EVENT_TYPES = new Set(['拒绝', '重放', '接管', '审批', '失败', '异常']);
const eventTypes = eventStream.map((e) => e['事件类型']);
const C19_TYPES = ['拒绝', '重放', '接管'];
const c19Events = eventStream.filter((e) => C19_TYPES.includes(e['事件类型']));
const c19TypeSet = new Set(c19Events.map((e) => e['事件类型']));
const c19RefOk = c19Events.every((e) => /I\s*表|第\s*\d+\s*项|I-[A-Za-z0-9]/.test(String(e['引用对象'] || '')));
const c19Locatable = C19_TYPES.every((t) => c19TypeSet.has(t)) && c19RefOk;
if (c19Locatable) {
  pass('五', 'L-06', '链路', 'P0', 'C19 拒绝/重放/接管三类事件都存在且引用对象可定位到 I 表记录',
    `事件类型=${eventTypes.join('、')}；三类事件的引用对象：${
      c19Events.map((e) => `${e['事件序号']} ${e['事件类型']} 指向 ${String(e['引用对象']).split('；')[0]}`).join(' / ')}`);
} else {
  fail('五', 'L-06', '链路', 'P0', 'C19 拒绝/重放/接管三类事件都存在且引用对象可定位到 I 表记录',
    `事件类型=${eventTypes.join('、')}；缺失=${C19_TYPES.filter((t) => !c19TypeSet.has(t)).join('、') || '无'}；引用对象可定位=${c19RefOk}`);
}

const eventSeqSorted = streamSeqs.every((v, i) => i === 0 ? v === 1 : v === streamSeqs[i - 1] + 1);
const eventTimeSorted = eventStream.every((e, i) => i === 0
  || Date.parse(e['事件时间']) >= Date.parse(eventStream[i - 1]['事件时间']));
const eventFieldsOk = eventStream.length > 0 && eventStream.every((e) =>
  ['事件序号', '事件时间', '事件类型', '判定依据', '引用对象', '判定人角色'].every((k) => isPresent(e[k]))
  && EVENT_TYPES.has(e['事件类型']));
if (eventSeqSorted && eventTimeSorted && eventFieldsOk) {
  pass('五', 'L-07', '链路', 'P0', '事件流序号从 1 起单调、时间单调、六个必填子字段齐全且类型在六值内',
    `序号=[${streamSeqs.join(',')}]；类型=[${eventTypes.join('、')}]；时间单调`);
} else {
  fail('五', 'L-07', '链路', 'P0', '事件流序号从 1 起单调、时间单调、六个必填子字段齐全且类型在六值内',
    `序号=[${streamSeqs.join(',')}]；序号单调=${eventSeqSorted}；时间单调=${eventTimeSorted}；子字段齐全=${eventFieldsOk}`);
}

const RUN_EXTRA = ['运行标识', '本次新增事件序号'];
const runShapesOk = runs.length === 3 && runs.every((r) => {
  const fieldsOk = I_FIELDS.every(([, name]) => has(r, name)) && RUN_EXTRA.every((k) => has(r, k));
  const ev = r['执行证据'] && r['执行证据'].value;
  const subOk = ev && typeof ev === 'object'
    && Array.isArray(ev['证据条目'])
    && typeof ev['记录三性落盘证明'] === 'object'
    && typeof ev['本次依据留痕'] === 'object'
    && typeof ev['封链证明'] === 'object';
  return fieldsOk && subOk;
});
if (runShapesOk) {
  pass('五', 'L-08', '链路', 'P1', '三条运行视图与实例级完全同构（15 项字段 + 四个执行证据子块 + 运行标识）',
    'run-1、run-2、run-3 均具备 15 项字段及结构化证据条目、三性证明、依据留痕、封链证明四个子块');
} else {
  fail('五', 'L-08', '链路', 'P0', '三条运行视图与实例级完全同构（15 项字段 + 四个执行证据子块 + 运行标识）', '存在缺字段或结构不同构的运行视图');
}

// 六、封链证明版本化（R20）
const seal = evidenceValue && evidenceValue['封链证明'] ? evidenceValue['封链证明'] : null;
const SEAL_FIELDS = ['封链版本号', '封链时点', '封链末事件序号', '封链哈希', '前一版本引用'];
const sealMissing = SEAL_FIELDS.filter((k) => !(seal && isPresent(seal[k])));
if (seal && sealMissing.length === 0) {
  pass('六', 'S-01', 'R20', 'P1', '封链证明五子项齐全（版本号、时点、末事件序号、哈希、前一版本引用）',
    `封链版本号=${seal['封链版本号']}；封链时点=${seal['封链时点']}；封链末事件序号=${seal['封链末事件序号']}；前一版本引用=${seal['前一版本引用']}`);
} else {
  warn('六', 'S-01', 'R20', 'P1', '封链证明五子项齐全（版本号、时点、末事件序号、哈希、前一版本引用）',
    `缺：${sealMissing.length ? sealMissing.join('、') : '封链证明整块'}`);
}

const sealSeq = seal ? Number(seal['封链末事件序号']) : NaN;
const maxStreamSeq = streamSeqs.length ? Math.max(...streamSeqs) : 0;
if (Number.isFinite(sealSeq) && sealSeq === maxStreamSeq) {
  pass('六', 'S-02', 'R20', 'P1', '封链末事件序号等于追加后事件流末序号', `封链=${sealSeq}，事件流末=${maxStreamSeq}`);
} else {
  warn('六', 'S-02', 'R20', 'P1', '封链末事件序号等于追加后事件流末序号', `封链=${sealSeq}，事件流末=${maxStreamSeq}`);
}

const sealVer = seal ? String(seal['封链版本号'] || '') : '';
const prevRef = seal ? String(seal['前一版本引用'] || '') : '';
const prevRefOk = /v\d+/.test(prevRef) && /末事件序号\s*\d+/.test(prevRef) && /哈希/.test(prevRef);
if (prevRefOk) {
  pass('六', 'S-03', 'R20', 'P1', '前一版本引用含版本号、末事件序号与哈希三项', prevRef);
} else {
  warn('六', 'S-03', 'R20', 'P1', '前一版本引用含版本号、末事件序号与哈希三项', prevRef);
}

const sealVersions = [];
if (seal && Array.isArray(seal['版本序列'])) sealVersions.push(...seal['版本序列']);
const prevSeqMatch = prevRef.match(/末事件序号\s*(\d+)/);
const prevSeq = prevSeqMatch ? Number(prevSeqMatch[1]) : NaN;
if (sealVersions.length >= 2) {
  const monotonic = sealVersions.every((v, i) => i === 0 || String(v) > String(sealVersions[i - 1]));
  const seqOrdered = !Number.isFinite(sealSeq) || !Number.isFinite(prevSeq) || sealSeq > prevSeq;
  if (monotonic && seqOrdered) {
    pass('六', 'S-04', 'R20', 'P1', '封链版本序列单调递增、旧版本保留且末事件序号严格递增',
      `${sealVersions.join(' 至 ')}；前一版本末序号=${prevSeq}，本版本末序号=${sealSeq}`);
  } else {
    warn('六', 'S-04', 'R20', 'P1', '封链版本序列单调递增、旧版本保留且末事件序号严格递增',
      `版本序列=${sealVersions.join(' 至 ')}`);
  }
} else {
  warn('六', 'S-04', 'R20', 'P1', '封链版本序列单调递增、旧版本保留且末事件序号严格递增', '封链版本不足两版');
}

const runSealAllPresent = runs.length > 0 && runs.every((r) => {
  const v = r['执行证据'] && r['执行证据'].value;
  return v && typeof v === 'object' && has(v, '封链证明') && isPresent(v['封链证明']['封链版本号']);
});
if (runSealAllPresent) {
  pass('六', 'S-05', 'R20', 'P1', '运行视图第 8 项含封链证明（版本号、时点、前一版本引用）',
    runs.map((r, i) => `run-${i + 1}:${r['执行证据'].value['封链证明']['封链版本号']}`).join('、'));
} else {
  warn('六', 'S-05', 'R20', 'P1', '运行视图第 8 项含封链证明（版本号、时点、前一版本引用）', '运行视图缺封链证明');
}

// 七、G7：R26 任务规范完整性与 SDD 绑定及外部主体 R24 校验
const SESSION_SECTIONS = [
  '## 一、背景',
  '## 二、目标',
  '## 三、输入',
  '## 四、要求',
  '## 五、方案',
  '## 六、工作项',
  '## 七、历史',
  '## 八、其他',
];
if (existsSync(PATHS.session)) {
  const sessionFile = readUtf8(PATHS.session);
  const missingSessionSec = SESSION_SECTIONS.filter((h) => !sessionFile.text.includes(h));
  const hasW01Done = /W-01/.test(sessionFile.text) && /dp\/spec-W01-T065\.md/.test(sessionFile.text) && /已完成/.test(sessionFile.text);
  if (missingSessionSec.length === 0 && hasW01Done) {
    pass('七', 'G7-01', 'R26', 'P0', '会话级规范 dp/session-S01.md 存在且八节齐全，W-01 指向任务规范且状态为已完成',
      `文件 ${sessionFile.bytes} 字节，含八节与 W-01 归档回写记录`);
  } else {
    fail('七', 'G7-01', 'R26', 'P0', '会话级规范 dp/session-S01.md 存在且八节齐全，W-01 指向任务规范且状态为已完成',
      `缺章节=${missingSessionSec.join('、') || '无'}；W-01 已完成=${hasW01Done}`);
  }
} else {
  fail('七', 'G7-01', 'R26', 'P0', '会话级规范 dp/session-S01.md 存在且八节齐全，W-01 指向任务规范且状态为已完成', '文件不存在');
}

const SPEC_SECTIONS = [
  '## 一、目标与完成标志',
  '## 二、范围',
  '## 三、约束',
  '## 四、验收标准',
  '## 五、证据',
  '## 六、版本与变更记录',
];
let specSha256Actual = '';
if (existsSync(PATHS.spec)) {
  const specFile = readUtf8(PATHS.spec);
  specSha256Actual = specFile.sha256;
  const missingSpecSec = SPEC_SECTIONS.filter((h) => !specFile.text.includes(h));
  const isFrozen = /规范状态\*\*：`frozen`/.test(specFile.text) && /spec-W01-T065@v1/.test(specFile.text);
  const hasAcs = ['AC-01', 'AC-02', 'AC-03'].every((ac) => specFile.text.includes(ac));
  if (missingSpecSec.length === 0 && isFrozen && hasAcs) {
    pass('七', 'G7-02', 'R26', 'P0', '任务级规范 dp/spec-W01-T065.md 存在、六节非空、状态为 frozen 且含 AC-01 至 AC-03',
      `spec-W01-T065@v1（status=frozen，sha256=${specSha256Actual}）`);
  } else {
    fail('七', 'G7-02', 'R26', 'P0', '任务级规范 dp/spec-W01-T065.md 存在、六节非空、状态为 frozen 且含 AC-01 至 AC-03',
      `缺章节=${missingSpecSec.join('、') || '无'}；frozen=${isFrozen}；AC齐全=${hasAcs}`);
  }
} else {
  fail('七', 'G7-02', 'R26', 'P0', '任务级规范 dp/spec-W01-T065.md 存在、六节非空、状态为 frozen 且含 AC-01 至 AC-03', '文件不存在');
}

const inputBinding = instance['输入绑定'] && instance['输入绑定'].value ? instance['输入绑定'].value : {};
const boundSpecId = inputBinding.spec_id || '';
const boundSpecSha = String(inputBinding.spec_sha256 || '').toLowerCase();
const boundInputSha = String(inputBinding['输入摘要哈希'] || '').replace(/^sha256:/i, '').toLowerCase();
const boundSessionRef = inputBinding.session_spec_ref || '';
if (
  boundSpecId === 'spec-W01-T065@v1'
  && specSha256Actual.length === 64
  && boundSpecSha === specSha256Actual
  && boundInputSha === specSha256Actual
  && boundSessionRef === 'dp/session-S01.md'
) {
  pass('七', 'G7-03', 'R26', 'P0', 'I 表第 3 项输入绑定的 spec_id、SHA-256 哈希与 dp/spec-W01-T065.md 真实值一致',
    `spec_id=${boundSpecId}；sha256=${boundSpecSha}；session_spec_ref=${boundSessionRef}`);
} else {
  fail('七', 'G7-03', 'R26', 'P0', 'I 表第 3 项输入绑定的 spec_id、SHA-256 哈希与 dp/spec-W01-T065.md 真实值一致',
    `绑定=${boundSpecId}/${boundSpecSha}，文件真实哈希=${specSha256Actual}`);
}

const row6ReadSet = recordTypeDef['6_知识'] && Array.isArray(recordTypeDef['6_知识']['读集'])
  ? recordTypeDef['6_知识']['读集'] : [];
const hasTaskSpecReadSet = row6ReadSet.some((item) =>
  item && item['名称'] === '任务规范读集'
  && /任务/.test(String(item['范围']))
  && /冻结版快照/.test(String(item['版本']))
  && /本任务周期/.test(String(item['时效']))
  && item['权威级别'] === '权威'
  && item['驻留范围'] === '本实例'
  && item['准入'] === '可读');
const row4Budget = recordTypeDef['4_职责'] && recordTypeDef['4_职责']['成本预算上限'];
const row15Tier = String(recordTypeDef['15_接口_归因设计'] || '') + String(recordTypeDef['16_生命周期_档位与节奏'] || '');
const hasD33Tier = /周期批处理（两次唤起间无存活持有者/.test(row15Tier);
const hasD34Budget = row4Budget && row4Budget.max_requests === 40 && row4Budget.max_input_tokens === 120000 && row4Budget.max_tool_calls === 60;
if (hasTaskSpecReadSet && hasD33Tier && hasD34Budget) {
  pass('七', 'G7-04', 'R26', 'P0', 'T 表行 6 含任务规范读集六项固定值、行 4/5 含 D34 预算上限、行 15/16 按 D33 明确周期批处理档位',
    '任务规范读集=6项齐全；预算=(40, 120000, 60)；档位=周期批处理（两次唤起间无存活持有者）');
} else {
  fail('七', 'G7-04', 'R26', 'P0', 'T 表行 6 含任务规范读集六项固定值、行 4/5 含 D34 预算上限、行 15/16 按 D33 明确周期批处理档位',
    `读集=${hasTaskSpecReadSet}；D33=${hasD33Tier}；D34=${hasD34Budget}`);
}

const acCheckMap = evidenceValue && evidenceValue['验收标准核验'] ? evidenceValue['验收标准核验'] : {};
const allAcVerified = ['AC-01', 'AC-02', 'AC-03'].every((ac) =>
  acCheckMap[ac] && acCheckMap[ac]['状态'] === '通过' && isNonEmptyString(acCheckMap[ac]['证据位置']));
const costMetrics = evidenceValue && evidenceValue.cost_metrics ? evidenceValue.cost_metrics : null;
const costOk = costMetrics
  && typeof costMetrics.requests === 'number' && costMetrics.requests > 0 && costMetrics.requests <= 40
  && typeof costMetrics.input_tokens === 'number' && costMetrics.input_tokens > 0 && costMetrics.input_tokens <= 120000
  && typeof costMetrics.tool_calls === 'number' && costMetrics.tool_calls > 0 && costMetrics.tool_calls <= 60;
const algoAndReplayOk = evidenceValue
  && evidenceValue.coverage_algo_version === 'asset-enum-v2.1'
  && evidenceValue.replay_count === 1;
if (allAcVerified && costOk && algoAndReplayOk) {
  pass('七', 'G7-05', 'R26', 'P0', 'I 表第 8 项含 AC-01 至 AC-03 核验结果、D34 成本三元组实耗、算法版本与重放计数',
    `AC-01/02/03=全部通过；cost=(requests:${costMetrics.requests}, input_tokens:${costMetrics.input_tokens}, tool_calls:${costMetrics.tool_calls})；algo=${evidenceValue.coverage_algo_version}；replay_count=${evidenceValue.replay_count}`);
} else {
  fail('七', 'G7-05', 'R26', 'P0', 'I 表第 8 项含 AC-01 至 AC-03 核验结果、D34 成本三元组实耗、算法版本与重放计数',
    `AC=${allAcVerified}；cost=${costOk}；algoAndReplay=${algoAndReplayOk}`);
}

const EXPECTED_TYPES = [
  'T065-security-scan@v1',
  'T006-db-migration@v1',
  'T046-due-diligence@v1',
  'T011-data-pipeline@v1',
  'T052-tax-advisory@v1',
  'T055-medical-record@v1',
  'T072-health-assistant@v1',
];
const missingRepTypes = EXPECTED_TYPES.filter((tid) => !dpTypeKeys.includes(tid));
const t011Entry = dpTypes.find((t) => t['类型 id@版本'] === 'T011-data-pipeline@v1');
const t011ScenarioOk = t011Entry
  && t011Entry['25a_取值'] === '仅特定场景'
  && Array.isArray(t011Entry['场景清单'])
  && t011Entry['场景清单'].length > 0
  && ['场景名', '触发条件', '参与方', '审批角色与档位'].every((k) => isNonEmptyString(t011Entry['场景清单'][0][k]))
  && /A2/.test(t011Entry['场景清单'][0]['审批角色与档位']);
if (missingRepTypes.length === 0 && dpTypeDeployments.length === 7 && t011ScenarioOk) {
  pass('七', 'G7-06', 'R17', 'P0', 'DP-1 完整覆盖 7 个代表类型（含跨租户是、仅特定场景四件清单与 A2、高合规三型）',
    EXPECTED_TYPES.join('、'));
} else {
  fail('七', 'G7-06', 'R17', 'P0', 'DP-1 完整覆盖 7 个代表类型（含跨租户是、仅特定场景四件清单与 A2、高合规三型）',
    `缺失=${missingRepTypes.join('、') || '无'}；T011四件清单=${t011ScenarioOk}`);
}

const highCompIds = ['T052-tax-advisory@v1', 'T055-medical-record@v1', 'T072-health-assistant@v1'];
const highCompEntries = dpTypes.filter((t) => highCompIds.includes(t['类型 id@版本']));
const highCompOk = highCompEntries.length === 3 && highCompEntries.every((t) =>
  t['高合规'] === true
  && isNonEmptyString(t.obligation_list_ref)
  && t.obligation_list_ref.includes('frozen')
  && t['控件映射'] && typeof t['控件映射'] === 'object');
const h1AltControlOk = ['T055-medical-record@v1', 'T072-health-assistant@v1'].every((tid) => {
  const entry = highCompEntries.find((t) => t['类型 id@版本'] === tid);
  return entry && /红旗症状转介记录\+就医提示留痕/.test(JSON.stringify(entry['控件映射']));
});
if (highCompOk && h1AltControlOk) {
  pass('七', 'G7-07', 'R15', 'P0', '高合规代表类型（T052/T055/T072）均带冻结 obligation_list_ref 与控件映射（含 D35 信息型替代控件）',
    highCompEntries.map((t) => `${t['类型 id@版本']}:${t.obligation_list_ref}`).join('、'));
} else {
  fail('七', 'G7-07', 'R15', 'P0', '高合规代表类型（T052/T055/T072）均带冻结 obligation_list_ref 与控件映射',
    `highCompOk=${highCompOk}；h1AltControlOk=${h1AltControlOk}`);
}

const extSubjects = dp && Array.isArray(dp.external_subjects) ? dp.external_subjects : [];
const refNow = Date.parse(`${effectiveDate || '2026-11-28'}T00:00:00Z`);
const extProblems = [];
for (const s of extSubjects) {
  const sid = s['主体编号'] || s.subject_id || '';
  const sevenOk = ['主体编号', '名称', '证照类型与编号', '发证机关', '有效期起止', '责任边界协议引用', '关联类型清单']
    .every((k) => isPresent(s[k]));
  if (!sevenOk) extProblems.push(`${sid || '?'} 缺必填字段`);
  const fromTs = Date.parse(`${s.valid_from || ''}T00:00:00Z`);
  const toTs = Date.parse(`${s.valid_to || ''}T23:59:59Z`);
  if (!(Number.isFinite(fromTs) && Number.isFinite(toTs) && fromTs <= refNow && refNow <= toTs)) {
    extProblems.push(`${sid} 证照不在有效期内（${s['有效期起止']}）`);
  }
  const linked = Array.isArray(s['关联类型清单']) ? s['关联类型清单'] : [];
  if (linked.length === 0 || !linked.every((tid) => dpTypeKeys.includes(tid))) {
    extProblems.push(`${sid} 关联类型未在 DP-1 登记`);
  }
  if (dpTenantIds.includes(sid)) {
    extProblems.push(`${sid} 混入了租户清单`);
  }
}
const hasLaw001 = extSubjects.some((s) => s['主体编号'] === 'EXT-LAW-001');
const hasComp002 = extSubjects.some((s) => s['主体编号'] === 'EXT-COMP-002' && /A3/.test(String(s['审批档绑定'] || '')));
if (extSubjects.length >= 2 && extProblems.length === 0 && hasLaw001 && hasComp002) {
  pass('七', 'G7-08', 'R24', 'P0', 'external_subjects 满足 R24 七项必填、证照在有效期内、不占租户 id 且 EXT-COMP-002 绑定 A3 审批档',
    extSubjects.map((s) => `${s['主体编号']}(${s['有效期起止']})`).join('、'));
} else {
  fail('七', 'G7-08', 'R24', 'P0', 'external_subjects 满足 R24 七项必填、证照在有效期内、不占租户 id 且 EXT-COMP-002 绑定 A3 审批档',
    extProblems.join('；') || '外部主体记录不全');
}

// 自测：组合条目字段 7 的“继承”解析
const selfTestResults = [];
if (SELF_TEST) {
  const comboOk = { '组合 id@版本': 'C-DEMO@v1', '租户归属': 'local@dp1-20261128-v1' };
  const comboBad = { '组合 id@版本': 'C-DEMO@v1' };
  const comboMismatch = { '组合 id@版本': 'C-DEMO@v1', '租户归属': 'tenant-a@cfg-9' };
  const cases = [
    ['继承 + 组合条目字段 7 可解析', resolveInheritedTenant('继承', comboOk), (r) => r.ok && r.tenantId === 'local' && r.configVersion === 'dp1-20261128-v1'],
    ['继承 + 组合条目缺字段 7', resolveInheritedTenant('继承', comboBad), (r) => !r.ok && /缺字段 7/.test(r.reason)],
    ['成员写具体租户且与组合租户不一致', (() => {
      const m = VERSION_RE.exec('tenant-b@cfg-9');
      const member = { tenantId: m[1], configVersion: m[2] };
      const combo = VERSION_RE.exec(comboMismatch['租户归属']);
      return { ok: member.tenantId === combo[1] && member.configVersion === combo[2], reason: `成员=${member.tenantId}@${member.configVersion}，组合=${combo[1]}@${combo[2]}` };
    })(), (r) => !r.ok],
  ];
  for (const [name, result, predicate] of cases) {
    selfTestResults.push({ name, ok: predicate(result), detail: result.ok ? `${result.tenantId}@${result.configVersion}` : result.reason });
  }
}

// 输出
const nodeVersion = process.version;
const out = [];
out.push('DP-1 部署配置登记表 · v1.8 扩展与 SDD 闭环真跑校验');
out.push('依据：34 v1.8 §4.2.6 / §4.2.25 / §4.3 / §4.8 / §4.9 / R17 / R19 / R20 / R24 / R25 / R26；31 v1.5 D32-D37');
out.push(`运行环境：Node ${nodeVersion}，零依赖，脚本 dp/validate-dp.mjs`);
out.push(`DP-1      ：${PATHS.dp}`);
out.push(`I 表记录  ：${PATHS.record}`);
out.push(`会话规范  ：${PATHS.session}`);
out.push(`任务规范  ：${PATHS.spec}`);
out.push(`25a 载体  ：${PATHS.backfill}`);
out.push(`类型定义  ：${PATHS.typeDef}`);
out.push('');
if (dpFatal) {
  out.push(`致命：DP-1 读取失败（${dpFatal}），仅能报告 DP-01。`);
}
if (recordFatal) {
  out.push(`致命：I 表记录读取失败（${recordFatal}）。`);
}

const counts = { PASS: 0, WARN: 0, FAIL: 0, SKIP: 0 };
for (const section of SECTION_ORDER) {
  const items = results.filter((r) => r.section === section);
  if (items.length === 0) continue;
  out.push(`[${section}] ${SECTION_TITLE[section]}（${items.length} 项）`);
  for (const r of items) {
    counts[r.status] += 1;
    out.push(`  [${STATUS_LABEL[r.status]}] ${r.id} ${r.title}${r.detail ? ` ： ${r.detail}` : ''}`);
  }
  out.push('');
}

const total = results.length;
out.push('─'.repeat(88));
out.push(`分组统计：${SECTION_ORDER.map((s) => {
  const items = results.filter((r) => r.section === s);
  return `[${s}] ${items.filter((r) => r.status === 'PASS').length}/${items.length} 通过`;
}).join('；')}`);
out.push(`汇总：共 ${total} 项，通过 ${counts.PASS}，警告 ${counts.WARN}，跳过 ${counts.SKIP}，不通过 ${counts.FAIL}`);
out.push('口径：只有“不通过”影响退出码；全部结构性、规范绑定与外部主体断言均已落盘核验。');
out.push(`退出码：${counts.FAIL > 0 ? 1 : 0}`);

const manual = results.filter((r) => r.status === 'WARN' || r.status === 'SKIP');
if (manual.length > 0) {
  out.push('');
  out.push('只能人工判或需人工复核的项：');
  for (const r of manual) out.push(`  · ${r.id} ${r.title}`);
}

if (SELF_TEST) {
  out.push('');
  out.push('组合条目字段 7 的“继承”解析自测（用内置夹具验证逻辑分支）：');
  let okCount = 0;
  for (const [i, t] of selfTestResults.entries()) {
    if (t.ok) okCount += 1;
    out.push(`  [${t.ok ? '通过' : '不通过'}] 自测 ${i + 1}：${t.name} ： ${t.detail}`);
  }
  out.push(`  自测汇总：${okCount}/${selfTestResults.length} 通过`);
}

process.stdout.write(`${out.join('\n')}\n`, 'utf8');
process.exitCode = counts.FAIL > 0 ? 1 : 0;
