// lib/merger.js — محرك الدمج عالي الجودة بـ ffmpeg
// يوحّد كل المصادر (scale+pad إلى أكبر دقة، fps=30، yuv420p) ثم يدمجها بـ concat
// يضيف مسار صوت صامت للمصادر بلا صوت. الترميز: libx264 CRF 18 + AAC 192k + faststart
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');
const config = require('./config');
const { downloadToFile } = require('./utils');

// ضمان أن ffmpeg قابل للتنفيذ (ينسخه إلى /tmp بصلاحية 755 عند الحاجة)
let _ffmpegPath = null;
async function ensureExecutable() {
  if (_ffmpegPath && fs.existsSync(_ffmpegPath)) return _ffmpegPath;
  const src = ffmpegStatic;
  // تحقق من الصلاحية
  try {
    fs.accessSync(src, fs.constants.X_OK);
    _ffmpegPath = src;
    return src;
  } catch {
    // انسخ إلى /tmp بصلاحية 755
    const dest = path.join(os.tmpdir(), `ffmpeg-${process.pid || 'static'}`);
    fs.copyFileSync(src, dest);
    fs.chmodSync(dest, 0o755);
    _ffmpegPath = dest;
    return dest;
  }
}

function ffprobePath() {
  return ffprobeStatic.path;
}

// تشغيل ffmpeg/ffprobe مع Promise
function runProcess(cmd, args, { onProgress, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    if (onProgress && proc.stdout) {
      proc.stdout.on('data', (d) => onProgress(d.toString()));
    }
    const timer = timeoutMs ? setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, timeoutMs) : null;
    proc.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) return reject(new Error('انتهت مهلة العملية'));
      if (code !== 0) {
        const err = new Error(`فشل الأمر (code ${code}): ${stderr.slice(-2000)}`);
        err.stderr = stderr;
        err.stdout = stdout;
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
    proc.on('error', (e) => {
      if (timer) clearTimeout(timer);
      reject(e);
    });
  });
}

// ffprobe لمصدر: الدقة، fps، المدة، الصوت
async function probeSource(filePath) {
  const args = [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate,duration:format=duration',
    '-of', 'json',
    filePath,
  ];
  // تحقق من الصوت
  const audioArgs = [
    '-v', 'error',
    '-select_streams', 'a:0',
    '-show_entries', 'stream=codec_type',
    '-of', 'json',
    filePath,
  ];
  const [{ stdout }, { stdout: audioOut }] = await Promise.all([
    runProcess(ffprobePath(), args),
    runProcess(ffprobePath(), audioArgs),
  ]);
  const data = JSON.parse(stdout);
  const audioData = JSON.parse(audioOut);
  const stream = data.streams?.[0] || {};
  const format = data.format || {};
  let duration = parseFloat(stream.duration || format.duration || '0');
  let fps = 30;
  if (stream.r_frame_rate && stream.r_frame_rate.includes('/')) {
    const [num, den] = stream.r_frame_rate.split('/').map(Number);
    if (den) fps = num / den;
  }
  const hasAudio = (audioData.streams?.length || 0) > 0;
  return {
    width: parseInt(stream.width || '0', 10),
    height: parseInt(stream.height || '0', 10),
    fps,
    duration,
    hasAudio,
  };
}

// تحضير المصادر: تنزيل الروابط وقراءة الملفات المرفوعة + probe لكل واحد
async function prepareSources(sources, workDir, onProgress) {
  const prepared = [];
  const maxBytes = config.SOURCE_MAX_MB * 1024 * 1024;
  let totalDuration = 0;
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    const outPath = path.join(workDir, `src_${i}.mp4`);
    if (s.kind === 'url') {
      onProgress?.(`تنزيل المصدر ${i + 1}...`);
      await downloadToFile(s.url, outPath, maxBytes);
      const stat = fs.statSync(outPath);
      if (stat.size > maxBytes) {
        throw new Error(`حجم المصدر ${i + 1} (${(stat.size / 1024 / 1024).toFixed(1)}MB) يتجاوز الحد (${config.SOURCE_MAX_MB}MB)`);
      }
    } else {
      // ملف مرفوع — بياناته في s._buf أو تم تخزينه في قاعدة البيانات
      // نُمرر المسار مباشرة إذا وُجد
      if (s._buf) {
        fs.writeFileSync(outPath, s._buf);
      } else if (s._storedPath && fs.existsSync(s._storedPath)) {
        fs.copyFileSync(s._storedPath, outPath);
      } else {
        throw new Error(`المصدر ${i + 1}: لا توجد بيانات`);
      }
    }
    const info = await probeSource(outPath);
    if (info.duration > 0) totalDuration += info.duration;
    if (totalDuration > config.MAX_TOTAL_DURATION_SEC) {
      throw new Error(`إجمالي مدد المقاطع (${totalDuration.toFixed(0)}ث) يتجاوز الحد (${config.MAX_TOTAL_DURATION_SEC}ث)`);
    }
    prepared.push({ ...s, path: outPath, ...info });
  }
  return prepared;
}

// بناء filter_complex لتوحيد كل المصادر ثم concat
// نحدد أكبر دقة (حد أقصى 1920×1080) ونحدّد الأبعاد لزوجية
function buildFilterGraph(prepared) {
  let maxW = 0, maxH = 0;
  for (const p of prepared) {
    if (p.width > maxW) maxW = p.width;
    if (p.height > maxH) maxH = p.height;
  }
  // حد أقصى 1920×1080
  if (maxW > 1920) maxW = 1920;
  if (maxH > 1080) maxH = 1080;
  // أبعاد زوجية
  if (maxW % 2) maxW--;
  if (maxH % 2) maxH--;
  const parts = [];
  const labels = [];
  for (let i = 0; i < prepared.length; i++) {
    const p = prepared[i];
    // لكل مصدر: scale + pad + setsar + fps + format
    let filter = `[${i}:v]scale=${maxW}:${maxH}:force_original_aspect_ratio=decrease,pad=${maxW}:${maxH}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30,format=yuv420p[v${i}]`;
    parts.push(filter);
    let aLabel;
    if (p.hasAudio) {
      // نوحد مسار الصوت — aresample لـ 44100
      parts.push(`[${i}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
      aLabel = `a${i}`;
    } else {
      // صامت بنفس مدة الفيديو
      parts.push(`anullsrc=channel_layout=stereo:sample_rate=44100:d=${(p.duration || 1).toFixed(3)}[a${i}]`);
      aLabel = `a${i}`;
    }
    labels.push(`[v${i}][${aLabel}]`);
  }
  const concat = `${labels.join('')}concat=n=${prepared.length}:v=1:a=1[outv][outa]`;
  parts.push(concat);
  return { filterGraph: parts.join(';'), outW: maxW, outH: maxH };
}

// الدمج الكامل: المصادر → ملف موحد → الحقول
// onProgress(progressPercent, message)
async function mergeVideos({ sources, workDir, onProgress }) {
  const ffmpeg = await ensureExecutable();
  // 1) تحضير المصادر (0–40%)
  const prepared = await prepareSources(sources, workDir, (msg) => onProgress?.(5, msg));
  onProgress?.(20, 'تحليل المصادر...');

  // 2) بناء filter graph
  const { filterGraph, outW, outH } = buildFilterGraph(prepared);
  const outPath = path.join(workDir, 'output.mp4');

  // 3) ترميز بـ ffmpeg (40–90%)
  const inputs = [];
  for (const p of prepared) {
    inputs.push('-i', p.path);
  }
  const totalDuration = prepared.reduce((s, p) => s + (p.duration || 0), 0);
  const args = [
    '-y',
    ...inputs,
    '-filter_complex', filterGraph,
    '-map', '[outv]',
    '-map', '[outa]',
    '-c:v', 'libx264',
    '-preset', config.FFMPEG_PRESET,
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ar', '44100',
    '-movflags', '+faststart',
    '-progress', 'pipe:1',
    '-nostats',
    outPath,
  ];

  await new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    let lastUs = 0;
    proc.stdout.on('data', (d) => {
      const txt = d.toString();
      const m = txt.match(/out_time_us=(\d+)/);
      if (m) {
        const us = parseInt(m[1], 10);
        if (totalDuration > 0 && us > lastUs) {
          lastUs = us;
          const pct = Math.min(90, 40 + Math.floor((us / 1e6 / totalDuration) * 50));
          onProgress?.(pct, 'جاري الترميز...');
        }
      }
    });
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`فشل الترميز (code ${code}): ${stderr.slice(-2000)}`));
      } else {
        resolve();
      }
    });
    proc.on('error', reject);
  });

  // 4) التحقق من حجم الناتج
  const stat = fs.statSync(outPath);
  const maxOut = config.OUTPUT_MAX_MB * 1024 * 1024;
  if (stat.size > maxOut) {
    throw new Error(`حجم الناتج (${(stat.size / 1024 / 1024).toFixed(1)}MB) يتجاوز الحد (${config.OUTPUT_MAX_MB}MB)`);
  }

  // 5) probe الناتج
  const outInfo = await probeSource(outPath);
  onProgress?.(95, 'الحفظ...');
  onProgress?.(100, 'اكتمل');

  return {
    path: outPath,
    size: stat.size,
    duration: outInfo.duration,
    width: outInfo.width,
    height: outInfo.height,
    resolution: `${outInfo.width}x${outInfo.height}`,
  };
}

module.exports = {
  ensureExecutable,
  probeSource,
  mergeVideos,
  runProcess,
};
