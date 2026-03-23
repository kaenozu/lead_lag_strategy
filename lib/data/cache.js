/**
 * インメモリデータキャッシュ層
 * In-Memory Data Cache Layer
 * 
 * プロセス内での重複データ取得を防ぐためのキャッシュ
 * TTL（Time-To-Live）付きでメモリ使用量を制御
 */

'use strict';

const { createLogger } = require('../logger');

const logger = createLogger('DataCache');

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 500;

const cache = new Map();
let stats = { hits: 0, misses: 0 };

function now() {
  return Date.now();
}

function generateKey(ticker, startStr, endStr, mode) {
  return `${ticker}:${startStr}:${endStr}:${mode || 'default'}`;
}

function get(ticker, startStr, endStr, mode) {
  const key = generateKey(ticker, startStr, endStr, mode);
  const entry = cache.get(key);
  
  if (!entry) {
    stats.misses++;
    return null;
  }
  
  if (entry.expiresAt < now()) {
    cache.delete(key);
    stats.misses++;
    return null;
  }
  
  stats.hits++;
  return entry.data;
}

function set(ticker, startStr, endStr, data, mode, ttlMs) {
  const key = generateKey(ticker, startStr, endStr, mode);
  const ttl = ttlMs || DEFAULT_TTL_MS;
  
  if (cache.size >= MAX_ENTRIES) {
    evictOldest();
  }
  
  cache.set(key, {
    data,
    expiresAt: now() + ttl,
    createdAt: now()
  });
  
  logger.debug('Cache set', { ticker, startStr, endStr, ttlMs: ttl });
}

function evictOldest() {
  let oldestKey = null;
  let oldestTime = Infinity;
  
  for (const [key, entry] of cache.entries()) {
    if (entry.createdAt < oldestTime) {
      oldestTime = entry.createdAt;
      oldestKey = key;
    }
  }
  
  if (oldestKey) {
    cache.delete(oldestKey);
    logger.debug('Cache evicted oldest entry');
  }
}

function invalidate(ticker) {
  let count = 0;
  for (const key of cache.keys()) {
    if (key.startsWith(`${ticker}:`)) {
      cache.delete(key);
      count++;
    }
  }
  if (count > 0) {
    logger.debug('Cache invalidated', { ticker, entriesRemoved: count });
  }
  return count;
}

function clear() {
  const size = cache.size;
  cache.clear();
  stats = { hits: 0, misses: 0 };
  logger.debug('Cache cleared', { entriesRemoved: size });
}

function getStats() {
  return {
    ...stats,
    hitRate: stats.hits + stats.misses > 0 
      ? stats.hits / (stats.hits + stats.misses) 
      : 0,
    entries: cache.size,
    maxEntries: MAX_ENTRIES
  };
}

function setMaxEntries(max) {
  if (Number.isFinite(max) && max > 0) {
    const newMax = Math.floor(max);
    let evictCount = 0;
    while (cache.size > newMax && cache.size > 0) {
      evictOldest();
      evictCount++;
    }
    logger.debug('Max entries updated', { oldMax: MAX_ENTRIES, newMax, evicted: evictCount });
    Object.defineProperty(module.exports, 'MAX_ENTRIES', { value: newMax, writable: false });
  }
}

module.exports = {
  get,
  set,
  invalidate,
  clear,
  getStats,
  setMaxEntries,
  DEFAULT_TTL_MS
};