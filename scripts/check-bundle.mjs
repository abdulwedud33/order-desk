// Fails the build if anything that looks like a secret ships in the static output (docs/security.md section 3)
// and enforces bundle-size budgets (docs/02-technical-requirements.md section 6).
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const walk = (dir) => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
};

const problems = [];
for (const file of walk('out').filter((f) => /\.(js|html|json|map|txt|css|webmanifest)$/.test(f))) {
  const text = readFileSync(file, 'utf8');
  if (/service_role/.test(text)) problems.push(`${file}: contains "service_role"`);
  if (/sk-ant-[A-Za-z0-9_-]{10,}/.test(text)) problems.push(`${file}: looks like an Anthropic key`);
  if (/ANTHROPIC_API_KEY/.test(text)) problems.push(`${file}: mentions ANTHROPIC_API_KEY`);
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{15,}\.([A-Za-z0-9_-]{15,})\.[A-Za-z0-9_-]{10,}/g)) {
    try {
      const payload = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
      if (payload.role && payload.role !== 'anon') problems.push(`${file}: JWT with role "${payload.role}"`);
    } catch { /* not a JWT */ }
  }
}

// Milestone M8: Bundle size budget check for tracking page (<= 25 KB gzip)
const trackChunks = walk('out/_next/static/chunks/app/track').filter((f) => f.endsWith('.js'));
let totalTrackGzipBytes = 0;
for (const chunk of trackChunks) {
  const content = readFileSync(chunk);
  const gz = gzipSync(content);
  totalTrackGzipBytes += gz.length;
}

const MAX_TRACK_GZIP_BYTES = 25 * 1024; // 25 KB
console.log(`Tracking route JS size (gzip): ${totalTrackGzipBytes} bytes (budget: ${MAX_TRACK_GZIP_BYTES} bytes)`);

if (totalTrackGzipBytes > MAX_TRACK_GZIP_BYTES) {
  problems.push(`Tracking page JS exceeds 25 KB gzip budget: ${totalTrackGzipBytes} bytes > ${MAX_TRACK_GZIP_BYTES} bytes`);
}

// Tracking page HTML verification: no third-party scripts, noindex, no-referrer
if (existsSync('out/track/index.html')) {
  const trackHtml = readFileSync('out/track/index.html', 'utf8');
  if (/src=["']https?:\/\//.test(trackHtml)) {
    problems.push('Tracking page contains third-party script references');
  }
  if (!/noindex/.test(trackHtml)) {
    problems.push('Tracking page missing noindex robots meta tag');
  }
  if (!/no-referrer/.test(trackHtml)) {
    problems.push('Tracking page missing no-referrer meta tag');
  }
}

if (problems.length) {
  console.error('Security/Budget scan failed:\n' + problems.join('\n'));
  process.exit(1);
}
console.log('Bundle secret and budget scan passed.');
