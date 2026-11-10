// api/upload.js — POST: رفع جزء من ملف مصدر (ثنائي ≤4MB)
// ?job=<id>&seq=<n>&chunk=<k> — يلحق الجزء بمصدر المهمة
'use strict';

const db = require('../lib/db');
const http = require('../lib/http');
const config = require('../lib/config');

module.exports = async (req, res) => {
  if (http.handleOptions(req, res)) return;
  if (req.method !== 'POST') return http.error(res, 405, 'الطريقة غير مسموحة');

  try {
    const { job, seq, chunk } = req.query;
    if (!job || seq === undefined || chunk === undefined) {
      return http.error(res, 400, 'يجب تمرير job و seq و chunk في الاستعلام');
    }
    const seqN = parseInt(seq, 10);
    const chunkN = parseInt(chunk, 10);
    if (Number.isNaN(seqN) || Number.isNaN(chunkN)) {
      return http.error(res, 400, 'seq و chunk يجب أن يكونا أرقام');
    }

    // تحقق من وجود المهمة
    const jobRow = await db.getJob(job);
    if (!jobRow) return http.error(res, 404, 'المهمة غير موجودة');

    // اقرأ الجسم الثنائي
    const buf = await http.readRaw(req, config.UPLOAD_CHUNK_BYTES + 1024);
    if (buf.length > config.UPLOAD_CHUNK_BYTES) {
      return http.error(res, 413, `الجزء يتجاوز الحد (${config.UPLOAD_CHUNK_BYTES} بايت)`);
    }

    // ابحث عن المصدر بالـ seq
    const sources = await db.getSources(job);
    const src = sources.find((s) => s.seq === seqN);
    if (!src) return http.error(res, 404, `المصدر رقم ${seqN} غير موجود`);
    if (src.kind !== 'file') {
      return http.error(res, 400, `المصدر رقم ${seqN} ليس ملف مرفوع`);
    }

    // ألحق الجزء
    await db.appendSourceChunk(src.id, chunkN, buf);

    // حدّث حجم المصدر التراكمي
    const newSize = (src.size || 0) + buf.length;
    await db.updateSource(src.id, { size: newSize, status: 'uploading' });

    return http.json(res, 200, { ok: true, seq: seqN, chunk: chunkN, received: buf.length, totalSize: newSize });
  } catch (e) {
    return http.error(res, 400, e.message || 'خطأ في الرفع');
  }
};
