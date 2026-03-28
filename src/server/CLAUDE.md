# Server Module - CLAUDE.md

## Overview
Express.js v5 server handling API requests for backtest, signal generation, and paper trading.

## Architecture

```
src/server/
├── bootstrap.js      # Server initialization, middleware setup
├── routes/
│   ├── paperRoutes.js    # Paper trading endpoints
│   └── [other routes]
├── services/
│   └── strategyService.js  # Core strategy logic
└── CLAUDE.md
```

## Code Patterns

### Route Handler Pattern
```javascript
// Always use async/await with try-catch
router.post('/api/endpoint', async (req, res) => {
  try {
    const { param1, param2 } = req.body;
    
    // Validate inputs
    if (!param1) {
      return res.status(400).json({ error: 'param1 is required' });
    }
    
    // Process request
    const result = await serviceFunction(param1, param2);
    
    // Return response
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Endpoint error:', { error: error.message, stack: error.stack });
    res.status(500).json({ 
      error: error.message,
      details: error.details || [] 
    });
  }
});
```

### Service Layer Pattern
```javascript
// lib/pca/signal.js example
class SignalGenerator {
  constructor(config) {
    this.config = config;
    this.cache = new Map();
  }
  
  async generate(params) {
    // 1. Validate inputs
    this._validateInputs(params);
    
    // 2. Check cache
    const cacheKey = this._getCacheKey(params);
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    
    // 3. Process
    const result = await this._process(params);
    
    // 4. Cache and return
    this.cache.set(cacheKey, result);
    return result;
  }
  
  _validateInputs(params) {
    if (!params.data || !Array.isArray(params.data)) {
      throw new Error('Invalid data: expected array');
    }
  }
}
```

## Middleware Stack

```javascript
// Order matters!
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') })); // Restricted CORS
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({ windowMs: 60000, max: 100 })); // 100 req/min
app.use('/api', auditLogger); // Custom audit logging
```

## Error Response Schema

```javascript
// Standard error format
{
  "error": "Human-readable message",
  "details": [
    {
      "field": "windowLength",
      "message": "Must be between 20 and 252",
      "value": 10
    }
  ],
  "code": "VALIDATION_ERROR" // Optional error code
}
```

## Security Checklist

- [ ] Rate limiting on all `/api/*` routes
- [ ] Input validation before processing
- [ ] No raw user input in file paths
- [ ] CORS restricted to known origins
- [ ] API keys from environment variables only
- [ ] Error messages don't leak internals

## Testing

```javascript
// tests/src/server/routes/paperRoutes.test.js
const request = require('supertest');
const app = require('../../../src/server/bootstrap');

describe('POST /api/paper/execute', () => {
  it('should reject invalid cash amount', async () => {
    const response = await request(app)
      .post('/api/paper/execute')
      .send({ cash: -100 });
    
    expect(response.status).toBe(400);
    expect(response.body.error).toContain('cash');
  });
});
```

## Common Operations

### Start Server
```bash
npm start  # Port 3000
```

### Check Server Health
```bash
curl http://localhost:3000/api/health
```

### View Logs
```bash
tail -f server.log
```

## Known Issues

| Issue | Location | Status |
|-------|----------|--------|
| CORS too permissive | bootstrap.js:140 | TODO |
| Rate limit missing on paper routes | paperRoutes.js | TODO |
| Error response inconsistency | Multiple | TODO |
