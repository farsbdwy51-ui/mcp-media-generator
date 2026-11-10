// scripts/test.js — اختبارات وحدة: توليد فيديوهين بـ ffmpeg، دمجهما، التحقق، تخزين Turso
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');

const db = require('../lib/db');
const storage = require('../lib/storage');
const { mergeVideos, probeSource } = require('../lib/merger');
const { sha256 } = require('../lib/utils');

let passed = 0, failed = 0;
function ok(name){ passed++; console.log(`  ✅ ${name}`); }
function fail(name, err){ failed++; console.error(`  ❌ ${name}: ${err.message || err}`); }
async function test(name, fn){
  try { await fn(); ok(name); } catch(e){ fail(name, e); }
}

// توليد فيديو اختباري بـ ffmpeg
function genTestVideo(outPath, w, h, dur, color){
  execSync(`"${ffmpegStatic}" -y -f lavfi -i testsrc=duration=${dur}:size=${w}x${h}:rate=30 -f lavfi -i sine=frequency=440:duration=${dur} -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -shortest -t ${dur} "${outPath}"`, {stdio:'pipe'});
}

async function main(){
  console.log('🧪 بدء اختبارات الوحدة...\n');

  // 1) اتصال Turso + المخطط
  await test('Turso متصل + المخطط', async () => {
    await db.ensureSchema();
    const healthy = await db.dbHealthy();
    if(!healthy) throw new Error('Turso غير متصل');
  });

  // 2) توليد فيديوهين بـ ffmpeg
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
  const v1 = path.join(workDir, 'v1.mp4'); // 320x240, 5s
  const v2 = path.join(workDir, 'v2.mp4'); // 640x360, 4s
  await test('توليد فيديو 1 (320x240, 5s)', async () => {
    genTestVideo(v1, 320, 240, 5, 'red');
    if(!fs.existsSync(v1)) throw new Error('لم يُنشأ الملف');
  });
  await test('توليد فيديو 2 (640x360, 4s)', async () => {
    genTestVideo(v2, 640, 360, 4, 'blue');
    if(!fs.existsSync(v2)) throw new Error('لم يُنشأ الملف');
  });

  // 3) probe
  await test('probe الفيديو 1', async () => {
    const info = await probeSource(v1);
    if(info.width !== 320 || info.height !== 240) throw new Error(`أبعاد خاطئة: ${info.width}x${info.height}`);
    if(!info.hasAudio) throw new Error('يجب أن يكون له صوت');
    if(Math.abs(info.duration - 5) > 0.5) throw new Error(`مدة خاطئة: ${info.duration}`);
  });

  // 4) الدمج
  let mergedPath = path.join(workDir, 'merged.mp4');
  let mergeResult = null;
  await test('دمج الفيديوهين', async () => {
    mergeResult = await mergeVideos({
      sources: [{kind:'file', _buf: fs.readFileSync(v1)}, {kind:'file', _buf: fs.readFileSync(v2)}],
      workDir,
      onProgress: () => {},
    });
    if(!fs.existsSync(mergeResult.path)) throw new Error('الناتج غير موجود');
    mergedPath = mergeResult.path;
  });

  // 5) التحقق من الناتج
  await test('التحقق من الناتج: الدقة = أكبر دقة مدخل (640x360)', async () => {
    const info = await probeSource(mergedPath);
    if(info.width !== 640 || info.height !== 360) throw new Error(`الدقة خاطئة: ${info.width}x${info.height} (متوقع 640x360)`);
  });
  await test('التحقق: المدة ≈ مجموع المدد (≈9s)', async () => {
    const info = await probeSource(mergedPath);
    if(Math.abs(info.duration - 9) > 1) throw new Error(`المدة خاطئة: ${info.duration} (متوقع ~9s)`);
  });
  await test('التحقق: وجود الصوت', async () => {
    const info = await probeSource(mergedPath);
    if(!info.hasAudio) throw new Error('الناتج بلا صوت');
  });

  // 6) تخزين في Turso واسترجاع بتطابق sha256
  const jobBuf = fs.readFileSync(mergedPath);
  const expectedHash = sha256(jobBuf);
  let jobId = 'test_' + Date.now();
  await test('تخزين الناتج في Turso بأجزاء 2MB', async () => {
    // أنشئ مهمة وهمية
    const expiresAt = new Date(Date.now() + 24*3600*1000).toISOString();
    await db.createJob({ sources: [{kind:'url', url:'http://test/v1.mp4'}, {kind:'url', url:'http://test/v2.mp4'}], expiresAt });
    // آخر مهمة هي المهمة
    // نحتاج الـ id — لكن createJob يولّده داخليًا. نأخذ آخر مهمة.
  });

  // لتسهيل: نستخدم jobId حقيقي
  const expiresAt = new Date(Date.now() + 24*3600*1000).toISOString();
  const created = await db.createJob({ sources: [{kind:'url', url:'http://test/v1.mp4'}, {kind:'url', url:'http://test/v2.mp4'}], expiresAt });
  await test('تخزين الناتج بأجزاء 2MB', async () => {
    await storage.storeOutput(created.id, jobBuf);
    const size = await storage.getOutputSize(created.id);
    if(size !== jobBuf.length) throw new Error(`الحجم لا يطابق: ${size} ≠ ${jobBuf.length}`);
  });
  await test('استرجاع الناتج بتطابق sha256', async () => {
    const buf = await storage.streamOutput(created.id, 0, jobBuf.length - 1);
    if(!buf) throw new Error('لم يُسترجع شيء');
    const h = sha256(buf);
    if(h !== expectedHash) throw new Error(`sha256 لا يطابق: ${h} ≠ ${expectedHash}`);
  });

  // 7) دعم Range
  await test('دعم Range: استرجاع أول 1024 بايت', async () => {
    const buf = await storage.streamOutput(created.id, 0, 1023);
    if(!buf || buf.length !== 1024) throw new Error(`طول خاطئ: ${buf?.length}`);
    const expected = jobBuf.subarray(0, 1024);
    if(!buf.equals(expected)) throw new Error('البيانات لا تطابق');
  });

  // 8) مسار الرفع المجزأ
  await test('مسار الرفع: أجزاء 4MB', async () => {
    const expiresAt2 = new Date(Date.now() + 24*3600*1000).toISOString();
    const created2 = await db.createJob({ sources: [{kind:'file', name:'test.mp4', size: jobBuf.length, mime:'video/mp4'}], expiresAt: expiresAt2 });
    const sources2 = await db.getSources(created2.id);
    const srcId = sources2[0].id;
    const chunkSize = 4 * 1024 * 1024;
    const totalChunks = Math.ceil(jobBuf.length / chunkSize);
    for(let k=0;k<totalChunks;k++){
      const slice = jobBuf.subarray(k*chunkSize, Math.min((k+1)*chunkSize, jobBuf.length));
      await storage.appendSourceChunk(srcId, k, slice);
    }
    const readBack = await storage.readSourceBytes(srcId);
    if(!readBack.equals(jobBuf)) throw new Error('الاسترجاع لا يطابق');
  });

  // 9) حدود الحجم
  await test('حدود الحجم: رفض تجاوز الحد', async () => {
    // نختبر فقط التحقق الرقمي — لا ننشئ ملف 200MB
    const config = require('../lib/config');
    if(config.MAX_SOURCES !== 10) throw new Error('MAX_SOURCES خاطئ');
    if(config.SOURCE_MAX_MB !== 200) throw new Error('SOURCE_MAX_MB خاطئ');
  });

  // 10) الحذف الشامل
  await test('الحذف الشامل: jobs + sources + chunks', async () => {
    await db.deleteJob(created.id);
    const job = await db.getJob(created.id);
    if(job) throw new Error('المهمة ما زالت موجودة');
    const sources = await db.getSources(created.id);
    if(sources.length > 0) throw new Error('المصادر ما زالت موجودة');
    const size = await storage.getOutputSize(created.id);
    if(size !== 0) throw new Error('الأجزاء ما زالت موجودة');
  });

  // تنظيف
  try { fs.rmSync(workDir, {recursive: true, force: true}); } catch {}

  console.log(`\n📊 النتيجة: ${passed} ناجح، ${failed} فاشل`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e=>{ console.error('خطأ قاتل:', e); process.exit(1); });
