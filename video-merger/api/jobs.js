// api/jobs.js — POST: إنشاء مهمة دمج
// يقبل {"videos": [...]} أو {"sources": [...]} — يرجع 201 بمعلومات المهمة
'use strict';

const db = require('../lib/db');
const http = require('../lib/http');
const config = require('../lib/config');
const { expiresAtISO } = require('../lib/utils');

module.exports = async (req, res) => {
  if (http.handleOptions(req, res)) return;
  if (req.method !== 'POST') return http.error(res, 405, 'الطريقة غير مسموحة');

  try {
    const body = await http.readJson(req);
    // حذف المهام المنتهية (تنظيف كسول)
    await db.cleanupExpired();

    let sources = [];
    if (Array.isArray(body.videos) && body.videos.length > 0) {
      // روابط مباشرة
      for (const u of body.videos) {
        if (typeof u !== 'string' || !/^https?:\/\//i.test(u)) {
          return http.error(res, 400, `رابط غير صالح: ${u}`);
        }
        sources.push({ kind: 'url', url: u });
      }
    } else if (Array.isArray(body.sources) && body.sources.length > 0) {
      for (const s of body.sources) {
        if (s.kind === 'url') {
          if (!s.url || !/^https?:\/\//i.test(s.url)) {
            return http.error(res, 400, `رابط غير صالح: ${s.url}`);
          }
          sources.push({ kind: 'url', url: s.url });
        } else if (s.kind === 'file') {
          sources.push({ kind: 'file', name: s.name, size: s.size, mime: s.mime });
        } else {
          return http.error(res, 400, `نوع مصدر غير معروف: ${s.kind}`);
        }
      }
    } else {
      return http.error(res, 400, 'يجب تمرير videos (مصفوفة روابط) أو sources (مصفوفة مصادر)');
    }

    if (sources.length < 2) {
      return http.error(res, 400, 'الدمج يحتاج مقطعين على الأقل');
    }
    if (sources.length > config.MAX_SOURCES) {
      return http.error(res, 400, `أقصى عدد مقاطع للدمج هو ${config.MAX_SOURCES}`);
    }

    const expiresAt = expiresAtISO(config.EXPIRES_HOURS);
    const { id } = await db.createJob({ sources, expiresAt });

    // إن كان هناك ملفات مرفوعة، أرجع روابط الرفع
    const hasFiles = sources.some((s) => s.kind === 'file');
    const base = baseUrl(req);
    const resp = {
      jobId: id,
      status: hasFiles ? 'uploading' : 'queued',
      statusUrl: `${base}/api/jobs/${id}`,
      processUrl: `${base}/api/jobs/${id}/process`,
      expiresAt,
    };
    if (hasFiles) {
      resp.uploadChunkBytes = config.UPLOAD_CHUNK_BYTES;
      resp.uploads = sources
        .map((s, i) => (s.kind === 'file'
          ? { seq: i, name: s.name, uploadUrl: `${base}/api/upload?job=${id}&seq=${i}&chunk=` }
          : null))
        .filter(Boolean);
    }

    return http.json(res, 201, resp);
  } catch (e) {
    return http.error(res, 400, e.message || 'خطأ في إنشاء المهمة');
  }
};

function baseUrl(req) {
  // احصل على الأصل من headers أو default
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  const proto = req.headers['x-forwarded-proto'] || (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
