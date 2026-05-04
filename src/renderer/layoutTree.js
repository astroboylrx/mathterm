function paneIdsInLayout(node, out = []) {
  if (!node) return out;
  if (node.type === 'pane') out.push(node.paneId);
  else for (const child of node.children || []) paneIdsInLayout(child, out);
  return out;
}

function findLeafPath(node, paneId, path = []) {
  if (!node) return null;
  if (node.type === 'pane') return node.paneId === paneId ? path : null;
  for (let i = 0; i < node.children.length; i++) {
    const found = findLeafPath(node.children[i], paneId, path.concat(i));
    if (found) return found;
  }
  return null;
}

function replaceNodeAtPath(root, path, newNode) {
  if (!path || path.length === 0) return newNode;
  const next = { ...root, children: root.children.slice() };
  let cur = next;
  for (let i = 0; i < path.length - 1; i++) {
    const idx = path[i];
    cur.children[idx] = { ...cur.children[idx], children: cur.children[idx].children.slice() };
    cur = cur.children[idx];
  }
  cur.children[path[path.length - 1]] = newNode;
  return next;
}

function getNodeAtPath(root, path) {
  let cur = root;
  for (const idx of path || []) {
    if (!cur || cur.type === 'pane') return null;
    cur = cur.children?.[idx] || null;
  }
  return cur;
}

function normalizedSizes(node) {
  const count = node?.children?.length || 0;
  if (!count) return [];
  const raw = node.sizes && node.sizes.length === count
    ? node.sizes.map(size => Math.max(0, Number(size) || 0))
    : node.children.map(() => 1 / count);
  const total = raw.reduce((sum, size) => sum + size, 0);
  return total > 0 ? raw.map(size => size / total) : node.children.map(() => 1 / count);
}

function updateSplitSizesAtPath(root, path, sizes) {
  const split = getNodeAtPath(root, path);
  if (!split || split.type === 'pane') return root;
  return replaceNodeAtPath(root, path, { ...split, sizes });
}

function firstPaneIdInLayout(root) {
  const ids = paneIdsInLayout(root);
  return ids.length ? ids[0] : null;
}

function removePaneFromLayout(root, paneId) {
  let replacementPaneId = null;
  function walk(node) {
    if (!node) return { node: null, removed: false };
    if (node.type === 'pane') {
      return node.paneId === paneId
        ? { node: null, removed: true }
        : { node, removed: false };
    }
    const originalChildren = node.children || [];
    const originalSizes = node.sizes && node.sizes.length === originalChildren.length
      ? node.sizes
      : originalChildren.map(() => 1 / Math.max(1, originalChildren.length));
    const kept = [];
    let removed = false;
    for (let i = 0; i < originalChildren.length; i++) {
      const result = walk(originalChildren[i]);
      removed = removed || result.removed;
      if (result.node) kept.push({ node: result.node, size: originalSizes[i] });
    }
    if (!removed) return { node, removed: false };
    if (kept.length === 0) return { node: null, removed: true };
    if (kept.length === 1) {
      if (replacementPaneId === null) {
        replacementPaneId = firstPaneIdInLayout(kept[0].node);
      }
      return { node: kept[0].node, removed: true };
    }
    const total = kept.reduce((sum, entry) => sum + Math.max(0, entry.size || 0), 0);
    const sizes = total > 0
      ? kept.map(entry => Math.max(0, entry.size || 0) / total)
      : kept.map(() => 1 / kept.length);
    return {
      node: {
        ...node,
        children: kept.map(entry => entry.node),
        sizes
      },
      removed: true
    };
  }
  const result = walk(root);
  return { layout: result.node, replacementPaneId };
}

module.exports = {
  paneIdsInLayout,
  findLeafPath,
  replaceNodeAtPath,
  getNodeAtPath,
  normalizedSizes,
  updateSplitSizesAtPath,
  firstPaneIdInLayout,
  removePaneFromLayout
};
