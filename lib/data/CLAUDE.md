# Data Module - CLAUDE.md

## Overview
Data fetching layer for market data from multiple sources (Yahoo Finance, AlphaVantage, J-Quants, Stooq).

## Architecture

```
lib/data/
├── fetch.js          # Main fetching logic
├── returns.js        # Return calculation
├── alphavantage.js   # AlphaVantage API
├── jquants.js        # J-Quants API (Japan)
├── stooq.js          # Stooq API
├── sourceRecovery.js # Fallback logic
└── CLAUDE.md
```

## Data Sources

| Source | Coverage | Rate Limit | Reliability |
|--------|----------|------------|-------------|
| Yahoo Finance | US + JP | ~2000 req/hour | High |
| AlphaVantage | US | 5 req/min, 500/day | Medium |
| J-Quants | JP | Token-based | High |
| Stooq | JP | Unknown | Medium |

## Fetching Pattern

```javascript
// Always use Promise.allSettled for parallel fetching
async function fetchMultipleTickers(tickers) {
  const results = await Promise.allSettled(
    tickers.map(t => fetchOhlcv(t, start, end))
  );
  
  const data = {};
  const errors = {};
  
  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i];
    const result = results[i];
    
    if (result.status === 'fulfilled') {
      data[ticker] = result.value;
    } else {
      errors[ticker] = result.reason instanceof Error 
        ? result.reason.message 
        : String(result.reason ?? 'Unknown error');
      data[ticker] = [];  // Empty array for missing data
    }
  }
  
  return { data, errors };
}
```

## Error Handling

```javascript
// Comprehensive error handling
async function fetchWithRetry(ticker, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const data = await yahooFinance.chart(ticker, {
        period1: startDate,
        period2: endDate,
        interval: '1d',
      });
      
      if (!data.quotes || data.quotes.length === 0) {
        throw new Error('Empty response');
      }
      
      return data.quotes;
    } catch (error) {
      lastError = error;
      logger.warn(`Fetch attempt ${attempt} failed for ${ticker}:`, error.message);
      
      // Exponential backoff
      if (attempt < maxRetries) {
        await sleep(1000 * Math.pow(2, attempt));
      }
    }
  }
  
  throw lastError;
}
```

## Rate Limiting

```javascript
// Request queue with rate limiting
class RateLimitedFetcher {
  constructor(requestsPerSecond = 2) {
    this.queue = [];
    this.interval = 1000 / requestsPerSecond;
    this.processing = false;
  }
  
  async fetch(ticker) {
    return new Promise((resolve, reject) => {
      this.queue.push({ ticker, resolve, reject });
      this._process();
    });
  }
  
  async _process() {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    
    while (this.queue.length > 0) {
      const { ticker, resolve, reject } = this.queue.shift();
      
      try {
        const data = await this._doFetch(ticker);
        resolve(data);
      } catch (error) {
        reject(error);
      }
      
      await sleep(this.interval);
    }
    
    this.processing = false;
  }
}
```

## Data Validation

```javascript
function validateOhlcv(data, ticker) {
  const required = ['date', 'open', 'high', 'low', 'close', 'volume'];
  
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`${ticker}: Empty data`);
  }
  
  for (const field of required) {
    if (!(field in data[0])) {
      throw new Error(`${ticker}: Missing field ${field}`);
    }
  }
  
  // Check for NaN values
  for (const row of data) {
    for (const field of ['open', 'high', 'low', 'close', 'volume']) {
      if (typeof row[field] !== 'number' || isNaN(row[field])) {
        throw new Error(`${ticker}: Invalid ${field} value`);
      }
    }
  }
  
  // Check OHLC logic
  for (const row of data) {
    if (row.high < row.low) {
      throw new Error(`${ticker}: High < Low`);
    }
    if (row.close < row.open && row.high < row.open) {
      // Suspicious but not necessarily wrong
      logger.warn(`${ticker}: Unusual OHLC pattern`);
    }
  }
  
  return true;
}
```

## Return Calculation

```javascript
// Simple returns
function calculateReturns(prices) {
  const returns = [];
  
  for (let i = 1; i < prices.length; i++) {
    const ret = (prices[i] - prices[i - 1]) / prices[i - 1];
    
    // Handle zero/negative prices
    if (!isFinite(ret)) {
      returns.push(null);
    } else {
      returns.push(ret);
    }
  }
  
  return returns;  // First element is null (no previous)
}

// Log returns (for PCA)
function calculateLogReturns(prices) {
  return prices.slice(1).map((p, i) => {
    const prev = prices[i];
    if (prev <= 0 || p <= 0) return null;
    return Math.log(p / prev);
  });
}
```

## Caching

```javascript
// File-based cache
const CACHE_DIR = path.join(__dirname, '../../data/cache');

async function fetchWithCache(ticker, start, end, maxAge = 3600000) {
  const cacheKey = `${ticker}_${start}_${end}`;
  const cacheFile = path.join(CACHE_DIR, `${cacheKey}.json`);
  
  // Check cache
  try {
    const stat = fs.statSync(cacheFile);
    if (Date.now() - stat.mtimeMs < maxAge) {
      logger.debug(`Cache hit: ${ticker}`);
      return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    }
  } catch (e) {
    // Cache miss or expired
  }
  
  // Fetch fresh data
  const data = await fetchOhlcv(ticker, start, end);
  
  // Save to cache
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(data));
  } catch (e) {
    logger.warn(`Cache write failed: ${e.message}`);
  }
  
  return data;
}
```

## Testing

```javascript
// tests/lib/data/fetch.test.js
describe('fetchOhlcv', () => {
  it('should return OHLCV data for valid ticker', async () => {
    const data = await fetchOhlcv('XLK', '2024-01-01', '2024-01-31');
    
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data[0]).toHaveProperty('date');
    expect(data[0]).toHaveProperty('close');
  });
  
  it('should handle invalid ticker gracefully', async () => {
    await expect(fetchOhlcv('INVALID', '2024-01-01', '2024-01-31'))
      .rejects.toThrow();
  });
  
  it('should use cache on second request', async () => {
    const start = Date.now();
    await fetchOhlcv('XLK', '2024-01-01', '2024-01-31');
    const firstDuration = Date.now() - start;
    
    const start2 = Date.now();
    await fetchOhlcv('XLK', '2024-01-01', '2024-01-31');
    const secondDuration = Date.now() - start2;
    
    expect(secondDuration).toBeLessThan(firstDuration);
  });
});
```

## Known Issues

| Issue | Location | Status |
|-------|----------|--------|
| Promise rejection handling | fetch.js:280-300 | CRITICAL |
| NaN propagation in returns | returns.js | HIGH |
| No connection pooling | fetch.js | MEDIUM |
