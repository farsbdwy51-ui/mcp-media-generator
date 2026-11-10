// lib/http.js — أدوات HTTP مشتركة بين نقاط النهاية
'use strict';

const config = require('./config');

// CORS مفتوح + headers مشتركة
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Range, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length, Content-Disposition');
  return res;
}

// رد JSON
function json(res, code, body) {
  setCors(res);
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
  return res;
}

// رد خطأ بصيغة {"error":"..."}
function error(res, code, message) {
  return json(res, code, { error: message });
}

// قراءة جسم الطلب خام (Buffer) — للرفع الثنائي
function readRaw(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (maxBytes && size > maxBytes) {
        reject(new Error('حجم الجسم يتجاوز الحد'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// قراءة جسم JSON
async function readJson(req, maxBytes = 2 * 1024 * 1024) {
  const buf = await readRaw(req, maxBytes);
  if (buf.length === 0) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw new Error('JSON غير صالح');
  }
}

// معالج خيارات CORS قبل الفعلي
function handleOptions(req, res) {
  if (req.method === 'OPTIONS') {
    setCors(res);
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}

// حدود config للعرض العام
function publicConfig() {
  return {
    version: config.VERSION,
    maxSources: config.MAX_SOURCES,
    sourceMaxMb: config.SOURCE_MAX_MB,
    outputMaxMb: config.OUTPUT_MAX_MB,
    maxTotalDurationSec: config.MAX_TOTAL_DURATION_SEC,
    uploadChunkBytes: config.UPLOAD_CHUNK_BYTES,
    expiresHours: config.EXPIRES_HOURS,
    output: { codec: 'h264', audio: 'aac', container: 'mp4', crf: 18, preset: config.FFMPEG_PRESET },
  };
}

module.exports = { setCors, json, error, readRaw, readJson, handleOptions, publicConfig };
