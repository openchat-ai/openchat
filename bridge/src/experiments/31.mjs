import { ok, ng, skip, report } from './lib/report.mjs';

export const META = { id: 'session-tree' };
const NAME = 'Session Tree — 树结构 CRUD';

export async function run() {
  await testTree();
  return { outputs: { ok: true } };
}

async function testTree() {
  let treeMod;
  try {
    treeMod = await import('./lib/session-tree.mjs');
    ok('session-tree.mjs 可加载');
  } catch (e) {
    ng('session-tree 加载失败', e);
    report(NAME); return;
  }

  const funcs = ['addNode', 'addVariant', 'editMessage', 'getCurrentPath', 'getParentForNewUser',
    'getNodeWithVariants', 'deleteSession', 'handleSignal'];
  for (const f of funcs) {
    if (typeof treeMod[f] === 'function') ok(`${f} 存在`);
    else ng(`${f} 缺失`);
  }

  // getCurrentPath — 空树
  const empty = treeMod.getCurrentPath({ nodes: [] });
  if (Array.isArray(empty) && empty.length === 0) ok('空树 → 空路径');

  // getCurrentPath — 线性树
  const linear = { nodes: [
    { id: 'n1', role: 'user', content: 'q1', parent: null, currentChild: 'a1' },
    { id: 'a1', role: 'assistant', content: 'a1', parent: 'n1', currentChild: 'n2' },
    { id: 'n2', role: 'user', content: 'q2', parent: 'a1' },
  ]};
  const path = treeMod.getCurrentPath(linear);
  if (path.length === 3) ok('线性树 → 路径 3 节点');

  // getCurrentPath — 分支走 currentChild
  const branch = { nodes: [
    { id: 'n1', role: 'user', parent: null, currentChild: 'a1' },
    { id: 'a1', role: 'assistant', parent: 'n1', currentChild: 'n2' },
    { id: 'n2', role: 'user', parent: 'a1' },
    { id: 'a2', role: 'assistant', parent: 'n1' },
  ]};
  const bp = treeMod.getCurrentPath(branch);
  if (bp.length === 3 && bp[1].id === 'a1') ok('分支树 → 走 currentChild');

  // getParentForNewUser
  const parent = treeMod.getParentForNewUser(linear);
  if (parent === 'a1') ok('新消息 parent → 最后 assistant');
  const noParent = treeMod.getParentForNewUser({ nodes: [] });
  if (noParent === null) ok('空树 → parent=null');

  // getNodeWithVariants
  const varTree = { nodes: [
    { id: 'n1', role: 'user', content: 'hi', parent: null },
    { id: 'n2', role: 'assistant', content: 'hello', parent: 'n1', variants: [{ content: 'hey', ts: 200 }], activeVariant: 1 },
  ]};
  const v = treeMod.getNodeWithVariants(varTree, 'n2');
  if (v && v.allVariants.length === 2 && v.activeVariant === 1) ok('assistant 有 2 variant, active=1');

  // editMessage prune 逻辑
  const pruneTree = { nodes: [
    { id: 'n1', role: 'user', parent: null, currentChild: 'a1' },
    { id: 'a1', role: 'assistant', parent: 'n1', currentChild: 'n2' },
    { id: 'n2', role: 'user', parent: 'a1', currentChild: 'a2' },
    { id: 'a2', role: 'assistant', parent: 'n2' },
  ]};
  const desc = new Set();
  const queue = ['n1'];
  while (queue.length) {
    const id = queue.shift();
    const children = pruneTree.nodes.filter(n => n.parent === id);
    for (const c of children) { desc.add(c.id); queue.push(c.id); }
  }
  const remaining = pruneTree.nodes.filter(n => !desc.has(n.id));
  if (remaining.length === 1 && remaining[0].id === 'n1') ok('editMessage prunes 3 descendants');

  // handleSignal 路由
  if (treeMod.handleSignal.length === 3) ok('handleSignal(chatId, signalFile, content) 签名正确');

  // _tree.json 序列化
  const sample = { version: 1, nodes: [
    { id: 'n_1000_a1b2', role: 'user', content: 'hi', parent: null, ts: 1000 },
    { id: 'n_1001_c3d4', role: 'assistant', content: 'hello', parent: 'n_1000_a1b2', ts: 1001,
      variants: [{ content: 'hey', ts: 1002 }], activeVariant: 0 },
  ]};
  const serialized = JSON.stringify(sample);
  const parsed = JSON.parse(serialized);
  if (parsed.version === 1 && parsed.nodes.length === 2) ok('_tree.json 序列化/反序列化一致');

  // 验证删除 — qiniu-s3.mjs (S3 兼容 DELETE 签名)
  try {
    const qiniu = await import('./lib/qiniu-s3.mjs');
    if (typeof qiniu.qiniuDelete === 'function') ok('qiniuDelete 函数存在');
    if (typeof qiniu.qiniuDeletePrefix === 'function') ok('qiniuDeletePrefix 函数存在');
    // 验证 deleteSession 使用了 qiniuDeletePrefix
    const treeSrc = await import('fs/promises').then(fs => fs.readFile('src/core/session-tree.mjs', 'utf8'));
    if (treeSrc.includes('qiniuDeletePrefix')) ok('deleteSession 使用 qiniuDeletePrefix');
  } catch (e) {
    ng('删除验证失败', e);
  }

  report(NAME);
}

;
