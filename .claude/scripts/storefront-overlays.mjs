import assert from 'node:assert/strict';

// Conservative vendor scopes. A changed integration needs a reviewed selector/label.
export const STOREFRONT_OVERLAYS = {
  'bounce-exchange': {root: '.bx-popup, [data-bouncex-modal]', close: '.bx-close, [aria-label="Close"], [aria-label="Close dialog"]', labels: ['Close', 'Close dialog', 'Close popup']},
  klaviyo: {root: '[role="dialog"][class*="klaviyo"], [role="dialog"]:has(form[class*="klaviyo"]), [data-klaviyo-modal]', close: 'button[aria-label="Close"], button[aria-label="Close dialog"], button[aria-label="Close form"]', labels: ['Close', 'Close dialog', 'Close form']},
  geolocation: {root: '[data-geolocation-modal], #geolocation-modal, localization-modal[open]', close: 'button[aria-label="Close"], button[aria-label="Close dialog"], [data-geolocation-close]', labels: ['Close', 'Close dialog', 'Stay here']},
  'shopify-preview-bar': {root: 'shopify-preview-bar, #ShopifyPreviewBar, iframe#preview-bar-iframe', close: 'button[aria-label="Close preview bar"], button[aria-label="Hide preview bar"]', labels: ['Close preview bar', 'Hide preview bar']},
};

export function deepQueryAll(selector, root = document) {
  const matches = new Set();
  const roots = [root];
  let inspected = 0;
  for (let i = 0; i < roots.length; i++) {
    for (const element of roots[i].querySelectorAll(selector)) matches.add(element);
    if (roots[i].shadowRoot) roots.push(roots[i].shadowRoot);
    for (const element of roots[i].querySelectorAll('*')) {
      if (++inspected > 5000) throw new Error('Open-shadow query exceeded 5000 elements');
      if (element.shadowRoot) roots.push(element.shadowRoot);
    }
  }
  return [...matches];
}

export function nativeElementPoint(element) {
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height || element.disabled || element.getAttribute('aria-disabled') === 'true') throw new Error('Native click target is not rendered or enabled');
  for (let node = element; node?.nodeType === 1; node = node.parentElement || node.getRootNode().host) {
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) throw new Error('Native click target has a hidden ancestor');
  }
  const point = {x:rect.x+rect.width/2,y:rect.y+rect.height/2};
  if (!(point.x>0 && point.x<innerWidth && point.y>0 && point.y<innerHeight)) throw new Error('Native click target is outside the viewport');
  const hosts=[];
  for(let root=element.getRootNode();root.host;root=root.host.getRootNode()) hosts.unshift(root.host);
  let hit=document.elementFromPoint(point.x,point.y);
  for(const host of hosts){
    if(hit!==host) throw new Error('Native click target is covered outside its shadow root');
    if(!host.shadowRoot?.elementFromPoint) throw new Error('Shadow-root hit-testing is unavailable');
    hit=host.shadowRoot.elementFromPoint(point.x,point.y);
  }
  if(hit!==element && !element.contains(hit)) throw new Error('Native click target is covered');
  return point;
}

export const nativeClickScript = selector => `const deepQueryAll=${deepQueryAll.toString()};const nativeElementPoint=${nativeElementPoint.toString()};const matches=deepQueryAll(${JSON.stringify(selector)});if(matches.length!==1)throw new Error('Click selector must match exactly one element');return nativeElementPoint(matches[0]);`;

export function storefrontOverlayProbe(profiles, action = 'dialogs', overlay) {
  const rendered = element => {
    const rect = element.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight)) return false;
    for (let node = element; node?.nodeType === 1; node = node.parentElement || node.getRootNode().host) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) return false;
    }
    return true;
  };
  const describe = element => {
    const r = element.getBoundingClientRect(), style = getComputedStyle(element);
    const text = (element.innerText || element.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
      .replace(/\b(password|token|secret|authorization)\b\s*[:=]\s*\S+/gi, '$1=[redacted]');
    return {tag: element.tagName.toLowerCase(), rect: {x:r.x,y:r.y,width:r.width,height:r.height}, display: style.display, text: text.slice(0,200)};
  };
  if (action === 'dialogs') {
    const selector = ['dialog[open]', '[role="dialog"]', '[aria-modal="true"]', ...Object.values(profiles).map(profile => profile.root)].join(',');
    return {dialogs: deepQueryAll(selector).filter(rendered).slice(0,12).map(describe), limits: {elements:5000,dialogs:12,text:200}, scope: 'DOM and open shadow roots; no input values, closed roots or cross-origin iframe content'};
  }
  const profile = profiles[overlay];
  if (!profile) throw new Error('Unknown storefront overlay');
  const roots = deepQueryAll(profile.root).filter(rendered);
  if (!roots.length) return {status: 'skipped', reason: 'optional overlay absent'};
  if (roots.length !== 1) throw new Error(`Ambiguous ${overlay} overlay (${roots.length})`);
  const root = roots[0];
  if (action === 'state') return {status: 'present', dialog: describe(root)};
  const buttons = deepQueryAll(profile.close, root).filter(rendered);
  if (buttons.length !== 1) throw new Error(`${overlay}: expected one scoped visible dismiss control; found ${buttons.length}. Closed roots/cross-origin frames require a separate reviewed native path.`);
  const button = buttons[0], rect = button.getBoundingClientRect();
  if (button.disabled || button.getAttribute('aria-disabled') === 'true') throw new Error(`${overlay}: dismiss control is disabled`);
  const point = nativeElementPoint(button);
  return {status: 'ready', point, dialog: describe(root), control: describe(button)};
}

export const storefrontScript = (action, overlay) => `const deepQueryAll=${deepQueryAll.toString()};const nativeElementPoint=${nativeElementPoint.toString()};return (${storefrontOverlayProbe.toString()})(${JSON.stringify(STOREFRONT_OVERLAYS)},${JSON.stringify(action)},${JSON.stringify(overlay)});`;

export async function captureStorefrontDiagnostics(script, {timeoutMs = 3000} = {}) {
  let timer;
  try {
    return await Promise.race([script(storefrontScript('dialogs')), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Dialog diagnostics exceeded deadline')), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

export async function dismissStorefrontOverlay({script, input, signal}, overlay, {timeoutMs = 3000} = {}) {
  assert.ok(Object.hasOwn(STOREFRONT_OVERLAYS, overlay), 'Unknown storefront overlay');
  assert.ok(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 10000, 'Overlay timeout must be 1 to 10000ms');
  signal?.throwIfAborted();
  const deadline = Date.now() + timeoutMs;
  const bounded = async operation => {
    let timer;
    try {
      signal?.throwIfAborted();
      return await Promise.race([operation(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${overlay}: overlay operation timed out`)), Math.max(1, deadline - Date.now()));
      })]);
    } finally { clearTimeout(timer); }
  };
  const before = await bounded(() => script(storefrontScript('point', overlay)));
  if (before.status === 'skipped') return {overlay, ...before};
  await bounded(() => input(before.point, `Dismiss ${overlay} overlay`));
  do {
    signal?.throwIfAborted();
    const after = await bounded(() => script(storefrontScript('state', overlay)));
    if (after.status === 'skipped') return {overlay, status: 'dismissed', before: before.dialog, assertion: 'Scoped overlay no longer rendered'};
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(`${overlay}: dismiss input did not remove the scoped overlay before timeout`);
}
