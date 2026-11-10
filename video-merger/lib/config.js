// lib/config.js — حدود الخدمة من متغيرات البيئة
'use strict';

module.exports = {
  MAX_SOURCES: parseInt(process.env.MAX_SOURCES || '10', 10),
  SOURCE_MAX_MB: parseInt(process.env.SOURCE_MAX_MB || '200', 10),
  OUTPUT_MAX_MB: parseInt(process.env.OUTPUT_MAX_MB || '150', 10),
  MAX_TOTAL_DURATION_SEC: parseInt(process.env.MAX_TOTAL_DURATION_SEC || '600', 10),
  FFMPEG_PRESET: process.env.FFMPEG_PRESET || 'medium',
  UPLOAD_CHUNK_BYTES: parseInt(process.env.UPLOAD_CHUNK_BYTES || (4 * 1024 * 1024), 10),
  TURSO_CHUNK_BYTES: 2 * 1024 * 1024, // حد صف Turso
  EXPIRES_HOURS: 24,
  VERSION: '1.0.0',
};
