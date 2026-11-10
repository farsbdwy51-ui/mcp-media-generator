// scripts/http-test.js — اختبار HTTP كامل ضد خادم التطوير
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');

const BASE = process.env.BASE || 'http://localhost:3000';
let passed = 0, failed = 0;
function ok(name){ passed++; console.log(`  ✅ ${name}`); }
function fail(name, err){ failed++; console.error(`  ❌ ${name}: ${err.message || err}`); }

function req(method, pathStr, { body, headers, raw } = {}) {
  return new Promise((resolve, reject) => {
    const fullUrl = pathStr.startsWith('http') ? pathStr : BASE + pathStr;
    const u = new URL(fullUrl);
    const opts = {
      method,
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      headers: headers || {},
    };
    if (body && !raw) {
      opts.headers['Content-Type'] = 'application/json';
    }
    const r = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let parsed = null;
        try { parsed = JSON.parse(buf.toString('utf8')); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: buf, json: parsed });
      });
    });
    r.on('error', reject);
    r.setTimeout(120000, () => { r.destroy(new Error('timeout')); });
    if (body) r.write(raw ? body : JSON.stringify(body));
    r.end();
  });
}

async function test(name, fn){
  try { await fn(); ok(name); } catch(e){ fail(name, e); }
}

async function waitForServer(maxRetries = 30) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await req('GET', '/api/config');
      return;
    } catch {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  throw new Error('الخادم لا يستجيب');
}

async function main(){
  console.log('🌐 اختبار HTTP ضد', BASE, '...\n');
  await waitForServer();
  console.log('الخادم يعمل. بدء الاختبارات...\n');

  // 1) GET /api/config
  await test('GET /api/config يرجع الحدود', async () => {
    const r = await req('GET', '/api/config');
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    if (!r.json.version) throw new Error('لا يوجد version');
    if (r.json.maxSources !== 10) throw new Error('maxSources خاطئ');
  });

  // 2) POST /api/jobs بـ JSON تالف
  await test('POST /api/jobs يرفض JSON تالف', async () => {
    const r = await req('POST', '/api/jobs', { body: 'not json', raw: true, headers: {'Content-Type':'application/json'} });
    if (r.status !== 400) throw new Error(`status ${r.status}`);
    if (!r.json.error) throw new Error('لا توجد رسالة خطأ');
  });

  // 3) POST /api/jobs بقائمة فارغة
  await test('POST /api/jobs يرفض قائمة فارغة', async () => {
    const r = await req('POST', '/api/jobs', { body: { videos: [] } });
    if (r.status !== 400) throw new Error(`status ${r.status}`);
  });

  // 4) POST /api/jobs بمقطع واحد
  await test('POST /api/jobs يرفض مقطع واحد', async () => {
    const r = await req('POST', '/api/jobs', { body: { videos: ['https://example.com/a.mp4'] } });
    if (r.status !== 400) throw new Error(`status ${r.status}`);
  });

  // 5) POST /api/jobs بأكثر من 10 مقاطع
  await test('POST /api/jobs يرفض >10 مقاطع', async () => {
    const vids = Array.from({length: 11}, (_, i) => `https://example.com/${i}.mp4`);
    const r = await req('POST', '/api/jobs', { body: { videos: vids } });
    if (r.status !== 400) throw new Error(`status ${r.status}`);
    if (!r.json.error.includes('10')) throw new Error('رسالة الخطأ لا تذكر 10');
  });

  // 6) دمج رابطين حقيقيين
  const testVids = [
    'https://www.w3schools.com/html/mov_bbb.mp4',
    'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4',
  ];
  let jobId = null;
  await test('POST /api/jobs بروابط حقيقية', async () => {
    const r = await req('POST', '/api/jobs', { body: { videos: testVids } });
    if (r.status !== 201) throw new Error(`status ${r.status}: ${r.body.toString()}`);
    if (!r.json.jobId) throw new Error('لا يوجد jobId');
    if (r.json.status !== 'queued') throw new Error(`status خاطئ: ${r.json.status}`);
    jobId = r.json.jobId;
  });

  // 7) تنفيذ الدمج
  let mergeResult = null;
  await test('POST /api/jobs/{id}/process — دمج رابطين', async () => {
    const r = await req('POST', `/api/jobs/${jobId}/process`);
    if (r.status !== 200 && r.status !== 202) throw new Error(`status ${r.status}: ${r.body.toString()}`);
    if (r.status === 202) {
      // استعلم حتى الاكتمال
      for (let i = 0; i < 60; i++) {
        await new Promise(rr => setTimeout(rr, 2000));
        const s = await req('GET', `/api/jobs/${jobId}`);
        if (s.json.status === 'done') { mergeResult = s.json; return; }
        if (s.json.status === 'failed') throw new Error(`فشل: ${s.json.error}`);
      }
      throw new Error('انتهت المهلة');
    } else {
      mergeResult = r.json;
    }
  });

  // 8) GET الحالة = done
  await test('GET /api/jobs/{id} الحالة = done', async () => {
    const r = await req('GET', `/api/jobs/${jobId}`);
    if (r.json.status !== 'done') throw new Error(`status: ${r.json.status}`);
    if (!r.json.videoUrl) throw new Error('لا يوجد videoUrl');
  });

  // 9) بث الفيديو (Range 206)
  await test('GET /api/jobs/{id}/video — بث كامل (200)', async () => {
    const r = await req('GET', `/api/jobs/${jobId}/video`);
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    if (r.headers['content-type'] !== 'video/mp4') throw new Error('content-type خاطئ');
    if (r.body.length === 0) throw new Error('جسم فارغ');
  });

  await test('GET /api/jobs/{id}/video — Range 206', async () => {
    const r = await req('GET', `/api/jobs/${jobId}/video`, { headers: { Range: 'bytes=0-1023' } });
    if (r.status !== 206) throw new Error(`status ${r.status} (متوقع 206)`);
    if (!r.headers['content-range']) throw new Error('لا يوجد Content-Range');
    if (r.body.length !== 1024) throw new Error(`طول خاطئ: ${r.body.length}`);
  });

  // 10) DELETE
  await test('DELETE /api/jobs/{id} — حذف', async () => {
    const r = await req('DELETE', `/api/jobs/${jobId}`);
    if (r.status !== 200) throw new Error(`status ${r.status}`);
  });

  // 11) GET بعد الحذف = 404
  await test('GET /api/jobs/{id} بعد الحذف = 404', async () => {
    const r = await req('GET', `/api/jobs/${jobId}`);
    if (r.status !== 404) throw new Error(`status ${r.status}`);
  });

  // 12) دمج مختلط: رابط + ملف مرفوع
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'http-test-'));
  const localVid = path.join(workDir, 'local.mp4');
  execSync(`"${ffmpegStatic}" -y -f lavfi -i testsrc=duration=3:size=320x240:rate=30 -c:v libx264 -preset ultrafast -pix_fmt yuv420p "${localVid}"`, {stdio:'pipe'});

  await test('دمج مختلط: رابط + ملف مرفوع', async () => {
    const buf = fs.readFileSync(localVid);
    // إنشاء مهمة بمصدرين
    const r1 = await req('POST', '/api/jobs', {
      body: { sources: [
        { kind: 'url', url: 'https://www.w3schools.com/html/mov_bbb.mp4' },
        { kind: 'file', name: 'local.mp4', size: buf.length, mime: 'video/mp4' },
      ] },
    });
    if (r1.status !== 201) throw new Error(`create status ${r1.status}: ${r1.body.toString()}`);
    if (r1.json.status !== 'uploading') throw new Error(`status: ${r1.json.status}`);
    if (!r1.json.uploads || r1.json.uploads.length !== 1) throw new Error('لا يوجد روابط رفع');

    // رفع الملف بأجزاء 4MB
    const chunkBytes = r1.json.uploadChunkBytes || (4 * 1024 * 1024);
    const upUrlBase = r1.json.uploads[0].uploadUrl.replace(/[&]?chunk=$/, '');
    const totalChunks = Math.ceil(buf.length / chunkBytes);
    for (let k = 0; k < totalChunks; k++) {
      const slice = buf.subarray(k * chunkBytes, Math.min((k + 1) * chunkBytes, buf.length));
      const rr = await req('POST', `${upUrlBase}&chunk=${k}`, { body: slice, raw: true, headers: {'Content-Type': 'application/octet-stream'} });
      if (rr.status !== 200) throw new Error(`upload chunk ${k} status ${rr.status}`);
    }

    // تنفيذ الدمج
    const r2 = await req('POST', `/api/jobs/${r1.json.jobId}/process`);
    if (r2.status === 202) {
      for (let i = 0; i < 60; i++) {
        await new Promise(rr => setTimeout(rr, 2000));
        const s = await req('GET', `/api/jobs/${r1.json.jobId}`);
        if (s.json.status === 'done') return;
        if (s.json.status === 'failed') throw new Error(`فشل: ${s.json.error}`);
      }
      throw new Error('انتهت المهلة');
    } else if (r2.status !== 200) {
      throw new Error(`process status ${r2.status}: ${r2.body.toString()}`);
    }

    // تنظيف
    await req('DELETE', `/api/jobs/${r1.json.jobId}`);
  });

  // تنظيف
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}

  console.log(`\n📊 النتيجة: ${passed} ناجح، ${failed} فاشل`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('خطأ قاتل:', e); process.exit(1); });
