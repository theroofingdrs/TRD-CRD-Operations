// Read-only artifact check. This does NOT replace authenticated mobile UI verification.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function styles(html) {
  return [...html.matchAll(/<link\b[^>]*>/gi)].flatMap(([tag]) => {
    const attr = name => tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`, 'i'))?.[1];
    return attr('rel')?.split(/\s+/).includes('stylesheet') && attr('href') ? [attr('href')] : [];
  });
}
export async function verifyResponsiveAssets({ dist, url }) {
  const base = new URL(url);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname))) throw Error('Use HTTPS, or local HTTP for tests.');
  const localHtml = await readFile(path.join(dist, 'index.html'), 'utf8');
  const localStyles = styles(localHtml).filter(href => !/^(https?:)?\/\//.test(href));
  if (!localStyles.length) throw Error('Local production build contains no application stylesheet. Run npm run build first.');
  const expected = await Promise.all(localStyles.map(async href => {
    const pathname = decodeURIComponent(new URL(href, 'https://build.test/').pathname).replace(/^\//, '');
    const filename = path.resolve(dist, pathname), root = path.resolve(dist) + path.sep;
    if (!filename.startsWith(root)) throw Error('Invalid local asset path');
    return hash(await readFile(filename));
  }));
  async function get(target) {
    const response = await fetch(target, { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok) throw Error(`Public asset request failed: HTTP ${response.status} ${target.pathname}`);
    return response;
  }
  const html = await (await get(base)).text();
  const remoteStyles = styles(html).map(href => new URL(href.replaceAll('&amp;', '&'), base)).filter(target => target.origin === base.origin);
  if (remoteStyles.length !== expected.length) throw Error('Served application stylesheet count differs from the tested build. Deployment is unverified.');
  const served = await Promise.all(remoteStyles.map(async target => ({ path: target.pathname, sha256: hash(Buffer.from(await (await get(target)).arrayBuffer())) })));
  if (expected.toSorted().join(',') !== served.map(item => item.sha256).toSorted().join(',')) throw Error('Served CSS differs from the tested build. Check deployed revision/cache before adding layout patches.');
  return { stylesheetMatch: true, stylesheets: served, authenticatedMobileVerified: false };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), value = flag => args[args.indexOf(flag) + 1];
    if (!args.includes('--url')) throw Error('Usage: node scripts/verify-responsive-assets.mjs --url https://operations.theroofingdrs.com/ [--dist dist]');
    console.log(JSON.stringify(await verifyResponsiveAssets({ dist: args.includes('--dist') ? value('--dist') : 'dist', url: value('--url') }), null, 2));
  } catch (error) { console.error('Asset verification failed: ' + error.message + (error.cause?.message ? '; ' + error.cause.message : '')); process.exitCode = 1; }
}
