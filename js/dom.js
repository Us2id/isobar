// Small helpers for building page elements. Text always goes in through textContent, so words
// from outside services can never become markup.
function apply(node, props) {
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.setAttribute('class', value);
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== false && value != null) node.setAttribute(key, value === true ? '' : value);
  }
  return node;
}

export function el(tag, props = {}, ...children) {
  const node = apply(document.createElement(tag), props);
  node.append(...children.filter((child) => child != null));
  return node;
}

export function svg(tag, props = {}, ...children) {
  const node = apply(document.createElementNS('http://www.w3.org/2000/svg', tag), props);
  node.append(...children.filter((child) => child != null));
  return node;
}
