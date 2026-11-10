// api/cron.js — GET: حذف المهام المنتهية (Cron يومي)
'use strict';

const http = require('../lib/http');
const db = require('../lib/db');

module.exports = async (req, res) => {
  if (http.handleOptions(req, res)) return;
  try {
    const n = await db.cleanupExpired();
    return http.json(res, 200, { ok: true, deleted: n, at: new Date().toISOString() });
  } catch (e) {
    return http.error(res, 500, e.message);
  }
};
