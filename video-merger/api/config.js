// api/config.js — GET: الحدود العامة + version
'use strict';

const http = require('../lib/http');
const db = require('../lib/db');

module.exports = async (req, res) => {
  if (http.handleOptions(req, res)) return;
  if (req.method !== 'GET') return http.error(res, 405, 'الطريقة غير مسموحة');
  try {
    const healthy = await db.dbHealthy();
    return http.json(res, 200, { ...http.publicConfig(), database: healthy ? 'turso-connected' : 'turso-disconnected' });
  } catch (e) {
    return http.error(res, 500, e.message);
  }
};
