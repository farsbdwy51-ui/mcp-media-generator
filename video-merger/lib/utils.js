// lib/utils.js — أدوات مساعدة
'use strict';

const crypto = require('crypto');

// تحويل ms إلى ISO string
function nowISO() {
  return new Date().toISOString();
}

function expiresAtISO(hours = 24) {
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}

// توليد معرف عشوائي
function randomId(len = 12) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// تحويل ثواني إلى mm:ss
function fmtDuration(sec) {
  if (!sec || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// sha256 لـ Buffer
function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// تنسيق البايتات
function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

// تنزيل رابط إلى ملف بمعدل بايتات وتحقق من الحد
async function downloadToFile(url, destPath, maxBytes) {
  const fs = require('fs');
  const https = require('https');
  const http = require('http');
  const proto = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    let received = 0;
    const req = proto.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(destPath);
        return downloadToFile(res.headers.location, destPath, maxBytes).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(destPath); } catch {}
        return reject(new Error(`فشل تحميل الرابط (HTTP ${res.statusCode})`));
      }
      res.on('data', (chunk) => {
        received += chunk.length;
        if (received > maxBytes) {
          req.destroy();
          file.close();
          try { fs.unlinkSync(destPath); } catch {}
          reject(new Error(`حجم المصدر يتجاوز الحد المسموح (${maxBytes / 1024 / 1024}MB)`));
        }
      });
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve({ size: received })));
    });
    req.on('error', (e) => {
      file.close();
      try { fs.unlinkSync(destPath); } catch {}
      reject(e);
    });
    req.setTimeout(120000, () => {
      req.destroy();
      file.close();
      try { fs.unlinkSync(destPath); } catch {}
      reject(new Error('انتهت مهلة تحميل الرابط'));
    });
  });
}

module.exports = { nowISO, expiresAtISO, randomId, fmtDuration, sha256, fmtBytes, downloadToFile };
