import { qiniuGet, qiniuPut, qiniuList, qiniuDeletePrefix } from '../../../apps/bridge/skeleton-qiniu.mjs';

// === invariants ===
// - _tree.json is the source of truth; .msg / -reply.json files are legacy compat
// - Each node has: id, role('user'|'assistant'), content, parent(null|nodeId), ts
// - Assistant nodes have optional: variants[{content,ts}], activeVariant(index)
// - Tree is reconstructed from _tree.json on each poll (disk-backed, not in-memory)
// - Signal files: _edit_{nodeId}, _reanswer_{nodeId} — consumed then skipped in seenKeys
// - Signal files: _delete.signal — deletes all files under chatId prefix
// - New user node is always appended to latest leaf of current path
// - _tree.json has version field for cache invalidation

const TREE_FILE = '_tree.json';
const SIGNAL_PREFIX = '_';

function _treePath(chatId) {
  return `oc/chat/${chatId}/${TREE_FILE}`;
}

async function loadTree(chatId) {
  try {
    const raw = await qiniuGet(_treePath(chatId));
    return JSON.parse(raw.toString('utf8'));
  } catch {
    return { version: 1, nodes: [] };
  }
}

async function saveTree(chatId, tree) {
  tree.version = (tree.version || 0) + 1;
  await qiniuPut(_treePath(chatId), Buffer.from(JSON.stringify(tree), 'utf8'));
}

// Get current linear path (root → latest leaf)
export function getCurrentPath(tree) {
  if (!tree.nodes.length) return [];
  const nodeMap = {};
  for (const n of tree.nodes) nodeMap[n.id] = n;
  const out = [];
  let id = tree.nodes[0].id; // root
  while (id && nodeMap[id]) {
    out.push(nodeMap[id]);
    // Follow current (preferred) child
    const children = tree.nodes.filter(c => c.parent === id);
    if (!children.length) break;
    // Pick currentChild if set, else first child
    const preferred = nodeMap[id].currentChild;
    const next = preferred ? children.find(c => c.id === preferred) : null;
    id = (next || children[children.length - 1]).id;
  }
  return out;
}

// Get parent node ID for a new user message — latest assistant leaf
export function getParentForNewUser(tree) {
  const path = getCurrentPath(tree);
  // Parent is the last assistant node (or null for first user message)
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i].role === 'assistant') return path[i].id;
  }
  return null;
}

// Add a new message node
export async function addNode(chatId, content, role, parentId, extra = {}) {
  const tree = await loadTree(chatId);
  const id = `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const node = { id, role, content, parent: parentId || null, ts: Date.now(), ...extra };
  tree.nodes.push(node);
  if (parentId) {
    const p = tree.nodes.find(n => n.id === parentId);
    if (p) p.currentChild = id;
  }
  await saveTree(chatId, tree);
  return node;
}

// Add a variant to an existing assistant node
export async function addVariant(chatId, nodeId, content) {
  const tree = await loadTree(chatId);
  const node = tree.nodes.find(n => n.id === nodeId);
  if (!node || node.role !== 'assistant') throw new Error(`node ${nodeId} not found or not assistant`);
  if (!node.variants) node.variants = [];
  node.variants.push({ content, ts: Date.now() });
  if (node.activeVariant === undefined) node.activeVariant = 0;
  // Always set active to latest variant
  node.activeVariant = node.variants.length - 1;
  node.content = content;
  node.ts = Date.now();
  await saveTree(chatId, tree);
  return node;
}

// Edit a user message — prune its children subtree, re-process will create new branch
export async function editMessage(chatId, nodeId, newContent) {
  const tree = await loadTree(chatId);
  const node = tree.nodes.find(n => n.id === nodeId);
  if (!node || node.role !== 'user') throw new Error(`node ${nodeId} not found or not user`);
  const oldContent = node.content;
  node.content = newContent;
  node.editedAt = Date.now();

  // Prune all descendants (they become orphaned, re-processing creates new branch)
  const desc = new Set();
  const queue = [nodeId];
  while (queue.length) {
    const id = queue.shift();
    const children = tree.nodes.filter(n => n.parent === id);
    for (const c of children) {
      desc.add(c.id);
      queue.push(c.id);
    }
  }
  // Remove children that will be re-created
  tree.nodes = tree.nodes.filter(n => !desc.has(n.id));

  // Reset parent's currentChild if needed
  if (node.parent) {
    const p = tree.nodes.find(n => n.id === node.parent);
    if (p && p.currentChild === nodeId) p.currentChild = null;
  }

  await saveTree(chatId, tree);
  return { oldContent, newContent, pruned: [...desc] };
}

// Get a node's content and its variants
export function getNodeWithVariants(tree, nodeId) {
  const node = tree.nodes.find(n => n.id === nodeId);
  if (!node) return null;
  if (node.role === 'assistant') {
    const all = [{ content: node.content, ts: node.ts }];
    if (node.variants) all.push(...node.variants);
    const active = node.activeVariant ?? 0;
    return { ...node, allVariants: all, activeVariant: active };
  }
  return { ...node, allVariants: [{ content: node.content, ts: node.ts }], activeVariant: 0 };
}

// Delete entire session — S3 LIST + individual DELETE
export async function deleteSession(chatId) {
  const prefix = `oc/chat/${chatId}/`;
  return await qiniuDeletePrefix(prefix);
}

// Handle signal files: _edit_{nodeId}, _reanswer_{nodeId}, _delete
export async function handleSignal(chatId, signalFile, signalContent) {
  if (signalFile.startsWith('_edit_')) {
    const nodeId = signalFile.replace('_edit_', '').replace('.json', '');
    const data = JSON.parse(signalContent.toString('utf8'));
    return await editMessage(chatId, nodeId, data.text);
  }
  if (signalFile.startsWith('_reanswer_')) {
    const nodeId = signalFile.replace('_reanswer_', '').replace('.json', '');
    // Trigger re-answer by returning the target node info
    return { action: 'reanswer', nodeId };
  }
  if (signalFile === '_delete.signal') {
    return await deleteSession(chatId);
  }
  return null;
}

// Rebuild _tree.json from scratch if needed (migration from flat files)
export async function rebuildTreeFromFiles(chatId, msgKeys, replyMap) {
  // Group msg files → their replies
  const tree = { version: 1, nodes: [] };
  const rootMsgs = msgKeys.filter(k => !k.includes('-')); // no suffix = user msg
  const seenIds = new Set();

  for (const msgKey of rootMsgs.sort()) {
    const nodeId = `n_${msgKey.split('/').pop().replace('.msg', '').replace('.enc', '')}`;
    if (seenIds.has(nodeId)) continue;
    seenIds.add(nodeId);

    const content = replyMap[msgKey]?.content || '(unknown)';
    const parent = tree.nodes.length ? tree.nodes[tree.nodes.length - 1].id : null;

    // Find last assistant node to set as parent
    let lastAssist = null;
    for (let i = tree.nodes.length - 1; i >= 0; i--) {
      if (tree.nodes[i].role === 'assistant') { lastAssist = tree.nodes[i].id; break; }
    }

    const userNode = { id: nodeId, role: 'user', content, parent: lastAssist, ts: parseInt(nodeId.slice(2)) || Date.now() };
    tree.nodes.push(userNode);

    const replyKey = msgKey.replace(/\.(msg|enc)$/, '-reply.json');
    const replyData = replyMap[replyKey];
    if (replyData) {
      const assistId = `${nodeId}_a`;
      const assistNode = {
        id: assistId, role: 'assistant', content: replyData.content,
        parent: nodeId, ts: replyData.ts || Date.now(),
      };
      tree.nodes.push(assistNode);
    }
  }

  await saveTree(chatId, tree);
  return tree;
}

// Ensure tree exists for a chatId, build if missing
export async function ensureTree(chatId, msgKeys, replyMap) {
  try {
    return await loadTree(chatId);
  } catch {
    return await rebuildTreeFromFiles(chatId, msgKeys, replyMap);
  }
}
