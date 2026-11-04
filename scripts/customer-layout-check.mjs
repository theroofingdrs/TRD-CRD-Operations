// Serialized into the browser: inspect real boxes and painted text, not CSS strings.
export function measureCustomerLayout(requestedWidth) {
  const detail = document.querySelector('.customer-detail-sections');
  const service = detail?.querySelector('.customer-service-history');
  if (!detail || !service) return { missing: true };
  const rect = element => {
    const r = element.getBoundingClientRect();
    return { left: r.left, right: r.right, width: r.width };
  };
  const content = element => {
    const r = rect(element), s = getComputedStyle(element);
    return { left: r.left + parseFloat(s.borderLeftWidth) + parseFloat(s.paddingLeft), right: r.right - parseFloat(s.borderRightWidth) - parseFloat(s.paddingRight) };
  };
  const card = detail.closest('.panel'), cardContent = content(card), section = rect(service);
  const inside = (r, bounds) => r.left >= bounds.left - 1 && r.right <= bounds.right + 1;
  const visible = element => element.getClientRects().length && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
  const localTableContent = element => element !== service && !!element.parentElement?.closest('.table-wrap');
  const violations = [];
  for (const element of detail.children) if (visible(element) && !inside(rect(element), cardContent)) violations.push({ kind: 'customer-section', class: element.className, ...rect(element) });
  for (const element of [service, ...service.querySelectorAll('*')]) {
    if (!visible(element) || localTableContent(element)) continue;
    if (!inside(rect(element), section)) violations.push({ kind: 'element', tag: element.tagName, class: element.className, ...rect(element) });
    // A text node can paint beyond an otherwise correctly sized paragraph/button.
    for (const node of element.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      const ownContent = content(element);
      for (const r of range.getClientRects()) if (r.width && r.height && (!inside(r, section) || !inside(r, ownContent))) violations.push({ kind: 'text', tag: element.tagName, left: r.left, right: r.right });
    }
  }
  const margins = { left: section.left - cardContent.left, right: cardContent.right - section.right };
  const heading = service.querySelector('h3'), description = service.querySelector('.panel-heading .muted');
  const empty = [...service.children].find(element => element.matches('p.muted'));
  const action = service.querySelector('.panel-heading button');
  const clippedAncestors = [];
  const hierarchy = [];
  for (let element = service; element; element = element.parentElement) {
    const style = getComputedStyle(element);
    hierarchy.push({ tag: element.tagName, class: element.className, ...rect(element), display: style.display, minWidth: style.minWidth, gridTracks: style.gridTemplateColumns, overflowX: style.overflowX });
    if (['hidden', 'clip'].includes(style.overflowX)) clippedAncestors.push(element.className || element.tagName);
  }
  return {
    missing: false, requestedWidth, documentWidth: document.documentElement.scrollWidth,
    layoutWidth: innerWidth, cardContent, section, margins, violations, clippedAncestors, hierarchy,
    heading: !!heading && visible(heading), description: !!description && visible(description),
    action: !!action && visible(action), empty: !!empty && visible(empty),
  };
}

export function customerLayoutErrors(data, { empty = false, action = false } = {}) {
  if (data.missing) return ['Customer detail/service section missing'];
  const errors = [];
  if (data.documentWidth > data.requestedWidth + 1 || data.layoutWidth > data.requestedWidth + 1) errors.push('Document/layout viewport expanded');
  if (Math.abs(data.margins.left) > 1 || Math.abs(data.margins.right) > 1 || Math.abs(data.margins.left - data.margins.right) > 1) errors.push('Service section does not align with the customer card content margins');
  if (data.violations.length) errors.push('Service descendants or painted text exceed the section bounds');
  if (data.clippedAncestors.length) errors.push('A section ancestor clips horizontal content');
  if (!data.heading || !data.description || (action && !data.action) || (empty && !data.empty)) errors.push('Required service history content/control is not rendered');
  return errors;
}
