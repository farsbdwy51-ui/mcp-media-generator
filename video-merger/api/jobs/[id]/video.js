// api/jobs/[id]/video.js — GET: بث الناتج بدعم Range، ?download=1 للتحميل
'use strict';

const db = require('../../../lib/db');
const http = require('../../../lib/http');
const storage = require('../../../lib/storage');

module.exports = async (req, res) => {
  if (http.handleOptions(req, res)) return;
  if (req.method !== 'GET') return http.error(res, 405, 'الطريقة غير مسموحة');

  const id = req.query.id;
  if (!id) return http.error(res, 400, 'معرف المهمة مطلوب');

  try {
    const job = await db.getJob(id);
    if (!job) return http.error(res, 404, 'المهمة غير موجودة');
    if (job.status !== 'done') {
      return http.error(res, 409, `المهمة لم تكتمل بعد (الحالة: ${job.status})`);
    }

    const totalSize = await storage.getOutputSize(id);
    if (totalSize === 0) {
      return http.error(res, 404, 'الناتج غير موجود (قد يكون حُذف أو انتهت صلاحيته)');
    }

    // معالجة Range
    const range = req.headers.range;
    let start = 0;
    let end = totalSize - 1;
    let isPartial = false;

    if (range) {
      const m = range.match(/bytes=(\d*)-(\d*)/);
      if (m) {
        const s = m[1] ? parseInt(m[1], 10) : 0;
        const e = m[2] ? parseInt(m[2], 10) : totalSize - 1;
        if (s <= e && s < totalSize) {
          start = s;
          end = Math.min(e, totalSize - 1);
          isPartial = true;
        }
      }
    }

    // اقرأ الجزء المطلوب
    const buf = await storage.streamOutput(id, start, end);
    if (!buf || buf.length === 0) {
      return http.error(res, 500, 'فشل قراءة الناتج');
    }

    http.setCors(res);
    res.statusCode = isPartial ? 206 : 200;
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', buf.length);
    if (isPartial) {
      res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
    }
    if (req.query.download === '1') {
      res.setHeader('Content-Disposition', `attachment; filename="merged-${id}.mp4"`);
    } else {
      res.setHeader('Content-Disposition', 'inline');
    }
    res.end(buf);
  } catch (e) {
    return http.error(res, 500, e.message || 'خطأ في البث');
  }
};
