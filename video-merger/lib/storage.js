// lib/storage.js — تخزين الملفات المجزأ في Turso (صفوف 2MB) + استرجاعها
'use strict';

const db = require('./db');
const config = require('./config');

// رفع جزء من ملف مصدر إلى قاعدة البيانات
async function appendSourceChunk(sourceId, seq, buf) {
  return db.appendSourceChunk(sourceId, seq, buf);
}

// قراءة كل أجزاء مصدر كـ Buffer
async function readSourceBytes(sourceId) {
  return db.readSourceBytes(sourceId);
}

// تخزين الناتج على شكل أجزاء 2MB
async function storeOutput(jobId, buf) {
  return db.storeOutput(jobId, buf);
}

// بث جزء من الناتج (دعم Range)
async function streamOutput(jobId, start, end) {
  return db.streamOutput(jobId, start, end);
}

// الحجم الكلي للناتج
async function getOutputSize(jobId) {
  return db.getOutputSize(jobId);
}

// حذف أجزاء المصادر بعد نجاح الدمج
async function deleteSourceChunks(jobId) {
  return db.deleteSourceChunks(jobId);
}

module.exports = {
  appendSourceChunk,
  readSourceBytes,
  storeOutput,
  streamOutput,
  getOutputSize,
  deleteSourceChunks,
  CHUNK_SIZE: config.TURSO_CHUNK_BYTES,
};
