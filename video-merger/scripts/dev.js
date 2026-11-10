// scripts/dev.js — خادم تطوير محلي يحاكي بيئة Vercel
// يحلّل المسارات الديناميكية ويضعها في req.query
// يشغل: /api/jobs, /api/upload, /api/jobs/[id], /api/jobs/[id]/process, /api/jobs/[id]/video, /api/config, /api/cron, /
'use strict';

require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const ROOT = path.resolve(__dirname, '..');

const ROUTES = [
  { pattern: '/api/jobs', exact: true, file: 'api/jobs.js' },
  { pattern: '/api/upload', exact: true, file: 'api/upload.js' },
  { pattern: '/api/config', exact: true, file: 'api/config.js' },
  { pattern: '/api/cron', exact: true, file: 'api/cron.js' },
  // ترتيب مهم: الأطول أولًا
  { pattern: '/api/jobs/[id]/process', match: (p) => p.match(/^\/api\/jobs\/([^/]+)\/process$/), file: 'api/jobs/[id]/process.js', idFromMatch: (m) => ({ id: m[1] }) },
  { pattern: '/api/jobs/[id]/video', match: (p) => p.match(/^\/api\/jobs\/([^/]+)\/video$/), file: 'api/jobs/[id]/video.js', idFromMatch: (m) => ({ id: m[1] }) },
  { pattern: '/api/jobs/[id]', match: (p) => p.match(/^\/api\/jobs\/([^/]+)$/), file: 'api/jobs/[id]/index.js', idFromMatch: (m) => ({ id: m[1] }) },
];

function resolveRoute(pathname) {
  for (const r of ROUTES) {
    if (r.exact && r.pattern === pathname) return r;
    if (r.match) {
      const m = r.match(pathname);
      if (m) return { ...r, _match: m };
    }
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  req.query = { ...parsed.query };

  // ملفات ثابتة في public/
  if (pathname === '/' || pathname === '/index.html') {
    try {
      const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(html);
      return;
    } catch (e) {
      res.statusCode = 500;
      res.end('خطأ في تحميل الصفحة: ' + e.message);
      return;
    }
  }

  // نقاط API
  const route = resolveRoute(pathname);
  if (route) {
    if (route.idFromMatch) {
      const extra = route.idFromMatch(route._match);
      req.query = { ...req.query, ...extra };
    }
    try {
      const handler = require(path.join(ROOT, route.file));
      await handler(req, res);
    } catch (e) {
      console.error(`خطأ في ${route.file}:`, e);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: e.message }));
      }
    }
    return;
  }

  res.statusCode = 404;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error: 'المسار غير موجود' }));
});

server.listen(PORT, () => {
  console.log(`خادم التطوير يعمل على http://localhost:${PORT}`);
  console.log(`نقاط API: /api/jobs, /api/upload, /api/jobs/[id], /api/jobs/[id]/process, /api/jobs/[id]/video, /api/config, /api/cron`);
});

// إغلاق نظيف
process.on('SIGINT', () => { server.close(); process.exit(0); });
process.on('SIGTERM', () => { server.close(); process.exit(0); });
