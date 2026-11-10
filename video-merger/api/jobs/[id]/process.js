// api/jobs/[id]/process.js — POST: تنفيذ الدمج كاملًا (متزامن)
// ينزّل/يسحب المصادر ← يرمّز بـ ffmpeg ← يحفظ الناتج في قاعدة البيانات
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const db = require('../../../lib/db');
const http = require('../../../lib/http');
const storage = require('../../../lib/storage');
const { mergeVideos } = require('../../../lib/merger');
const config = require('../../../lib/config');

// قفل في الذاكرة لمنع تزامن process مع get_task
const processingJobs = new Set();

module.exports = async (req, res) => {
  if (http.handleOptions(req, res)) return;
  if (req.method !== 'POST') return http.error(res, 405, 'الطريقة غير مسموحة');

  const id = req.query.id;
  if (!id) return http.error(res, 400, 'معرف المهمة مطلوب');

  try {
    const job = await db.getJob(id);
    if (!job) return http.error(res, 404, 'المهمة غير موجودة');

    // إذا كانت قيد المعالجة فعلاً
    if (job.status === 'processing') {
      return http.json(res, 202, { status: 'processing', progress: job.progress || 0, message: 'جاري المعالجة بالفعل' });
    }
    if (job.status === 'done') {
      return http.json(res, 200, formatDone(job, req));
    }
    if (job.status === 'failed') {
      return http.error(res, 409, `المهمة فشلت سابقًا: ${job.error || ''}`);
    }

    // قفل
    if (processingJobs.has(id)) {
      return http.json(res, 202, { status: 'processing', progress: job.progress || 0, message: 'جاري المعالجة بالفعل' });
    }
    processingJobs.add(id);

    // حدّد الحالة إلى processing
    await db.updateJob(id, { status: 'processing', progress: 0, error: null });

    // حذف المهام المنتهية (تنظيف كسول)
    await db.cleanupExpired();

    // شغل الدمج في الخلفية لكن ننتظره
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `merge-${id}-`));
    try {
      // اجمع المصادر
      const sourceRows = await db.getSources(id);
      const sources = [];
      for (const s of sourceRows) {
        if (s.kind === 'url') {
          sources.push({ kind: 'url', url: s.url });
        } else {
          // اقرأ من source_chunks
          const buf = await storage.readSourceBytes(s.id);
          if (!buf || buf.length === 0) {
            throw new Error(`المصدر رقم ${s.seq}: لم يتم رفع أي بيانات`);
          }
          sources.push({ kind: 'file', _buf: buf });
        }
      }

      const result = await mergeVideos({
        sources,
        workDir,
        onProgress: async (pct, msg) => {
          try { await db.updateJob(id, { progress: pct }); } catch {}
        },
      });

      // اقرأ الناتج وحفظه في قاعدة البيانات بأجزاء 2MB
      const outBuf = fs.readFileSync(result.path);
      await storage.storeOutput(id, outBuf);

      // حدّد المهمة إلى done
      const base = baseUrl(req);
      const videoUrl = `${base}/api/jobs/${id}/video`;
      const downloadUrl = `${videoUrl}?download=1`;
      await db.updateJob(id, {
        status: 'done',
        progress: 100,
        result_url: videoUrl,
        download_url: downloadUrl,
        size: result.size,
        duration: result.duration,
        resolution: result.resolution,
      });

      // احذف source_chunks (الناتج فقط هو المطلوب)
      await storage.deleteSourceChunks(id);

      return http.json(res, 200, {
        status: 'done',
        videoUrl,
        downloadUrl,
        size: result.size,
        duration: result.duration,
        resolution: result.resolution,
        expiresAt: job.expires_at,
      });
    } finally {
      // تنظيف /tmp
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {}
      processingJobs.delete(id);
    }
  } catch (e) {
    // حدّد المهمة إلى failed
    try {
      await db.updateJob(req.query.id, { status: 'failed', error: e.message || 'خطأ غير معروف' });
    } catch {}
    return http.error(res, 500, e.message || 'فشل الدمج');
  }
};

function baseUrl(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  const proto = req.headers['x-forwarded-proto'] || (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

function formatDone(job, req) {
  return {
    status: 'done',
    videoUrl: job.result_url,
    downloadUrl: job.download_url,
    size: job.size,
    duration: job.duration,
    resolution: job.resolution,
    expiresAt: job.expires_at,
  };
}
