const base = 'https://iivestro.github.io/-/';
function home(production) { return base + (production ? '' : 'balsam-demo/'); }
function action(raw, production) {
  let url;
  try { url = new URL(raw); } catch { return 'block'; }
  if (url.origin === new URL(base).origin) {
    const root = new URL(home(production)).pathname;
    const path = url.pathname;
    if (!path.startsWith(root)) return 'block';
    const page = path.slice(root.length);
    return /^([a-z0-9-]+\.html)?$/.test(page) ? 'inside' : 'block';
  }
  return ['https:', 'tel:', 'mailto:'].includes(url.protocol) ? 'external' : 'block';
}
module.exports = { home, action };
