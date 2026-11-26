export function buildFiberProjection(record) {
  const build = chain => {
    let parent = null;
    for (let index = chain.length - 1; index >= 0; index--) parent = { memoizedProps: structuredClone(chain[index]), return: parent };
    return parent;
  };
  const primary = build(record.primary), alternate = build(record.alternate);
  const root = fiber => { while (fiber?.return) fiber = fiber.return; return fiber; };
  if (primary) {
    primary.alternate = alternate;
    const mainRoot = root(primary), alternateRoot = root(alternate);
    if (record.active === 'primary') mainRoot.stateNode = { current: mainRoot };
    if (record.active === 'alternate') mainRoot.stateNode = { current: alternateRoot || {} };
  }
  return primary;
}

export function restoreRecordedDOM(sample, container) {
  const nodes = new Map();
  const build = spec => {
    if (Object.hasOwn(spec, 'text')) return document.createTextNode(spec.text);
    const node = spec.ns === 'svg' ? document.createElementNS('http://www.w3.org/2000/svg', spec.tag) : document.createElement(spec.tag);
    for (const [key, value] of Object.entries(spec.attrs)) node.setAttribute(key, value);
    node.setAttribute('style', sample.styles[spec.style]);
    nodes.set(spec.key, node);
    for (const child of spec.children) node.append(build(child));
    if (spec.tag === 'textarea' && spec.draftPresent) node.value = '[脱敏草稿]';
    return node;
  };
  container.replaceChildren(build(sample.tree));
  for (const binding of sample.bindings) nodes.get(binding.nodeKey).__reactFiber$recorded = buildFiberProjection(binding.fiber);
  window.__$unstable_useRootStoreOutside = () => structuredClone(sample.store);
  return nodes;
}
