// api/jobs/[id]/index.js — GET: الحالة + التقدم + الرابط عند الاكتمال
// DELETE: حذف فوري شامل
'use strict';

const db = require('../../../lib/db');
const http = require('../../../lib/http');

module.exports = async (req, res) => {
  if (http.handleOptions(req, res)) return;
  const id = req.query.id;
  if (!id) return http.error(res, 400, 'معرف المهمة مطلوب');

  if (req.method === 'GET') {
    try {
      const job = await db.getJob(id);
      if (!job) return http.error(res, 404, 'المهمة غير موجودة');
      return http.json(res, 200, formatJob(job));
    } catch (e) {
      return http.error(res, 500, e.message || 'خطأ في الاستعلام');
    }
  }

  if (req.method === 'DELETE') {
    try {
      const job = await db.getJob(id);
      if (!job) return http.error(res, 404, 'المهمة غير موجودة');
      await db.deleteJob(id);
      return http.json(res, 200, { ok: true, deleted: id });
    } catch (e) {
      return http.error(res, 500, e.message || 'خطأ في الحذف');
    }
  }

  return http.error(res, 405, 'الطريقة غير مسموحة');
};

function formatJob(job) {
  // انتبه: قد يرد الجسم فيه error بدون حقل status → عاملها failed فورًا
  const status = job.error && job.status === 'failed' ? 'failed' : job.status;
  return {
    jobId: job.id,
    status,
    progress: job.progress || 0,
    videoUrl: job.result_url || null,
    downloadUrl: job.download_url || null,
    size: job.size || null,
    duration: job.duration || null,
    resolution: job.resolution || null,
    error: job.error || null,
    createdAt: job.created_at,
    expiresAt: job.expires_at,
  };
}
