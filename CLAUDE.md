# Lead-Lag Strategy Project - Claude Code Configuration

## Project Overview

**Name:** 日米業種リードラグ投資戦略 (Japan-US Sector Lead-Lag Investment Strategy)  
**Core Technology:** Subspace-Regularized PCA for quantitative trading  
**Stack:** Node.js (CommonJS), Express.js v5, Python (reference), Vanilla JS

## Quick Commands

```bash
# Development
npm start              # Start web server (port 3000)
npm run backtest       # Run backtest with real market data
npm run backtest:improved  # Parameter-optimized backtest
npm run signal         # Generate trading signals

# Testing
npm test              # Full test suite (unit + lint + e2e)
npm run test:watch    # Jest watch mode
npm run test:e2e      # Playwright e2e tests
npm run test:e2e:ui   # Playwright with UI

# Code Quality
npm run lint          # ESLint check
npm run lint:fix      # ESLint auto-fix
npm run doctor        # System health check

# Paper Trading
npm run paper         # Daily paper trading execution
npm run paper:demo    # Paper trading demo mode
npm run paper:status  # Check paper trading status
```

## Architecture

```
lead_lag_strategy/
├── src/                 # Main application source
│   ├── server/         # Express server (routes, services, bootstrap)
│   └── generate_signal.js
├── lib/                 # Shared libraries
│   ├── pca/            # PCA & subspace regularization
│   ├── math/           # Linear algebra (eigen, matrix ops)
│   ├── data/           # Data fetching (Yahoo Finance, AlphaVantage)
│   ├── portfolio/      # Portfolio construction
│   └── paper/          # Paper trading logic
├── backtest/            # Backtest implementations
├── public/              # Frontend (HTML/CSS/JS)
├── tests/               # Unit tests (Jest)
├── e2e/                 # E2E tests (Playwright)
└── scripts/             # Utility scripts
```

## Code Style Guidelines

### JavaScript (Node.js)
- **Module System:** CommonJS (`require`/`module.exports`)
- **Async:** Prefer async/await over callbacks
- **Error Handling:** Try-catch with Winston logging
- **Naming:** camelCase for variables/functions, PascalCase for classes
- **Comments:** JSDoc for public functions, minimal inline comments

### Python
- **Version:** Python 3.x
- **Style:** PEP 8 compliant
- **Naming:** snake_case for functions/variables

### Testing
- **Unit Tests:** Jest for JavaScript, pytest for Python
- **E2E:** Playwright for browser automation
- **Coverage:** Target >80% for critical paths

## Key Patterns

### 1. Subspace-Regularized PCA
```javascript
// Core formula: C_reg = (1 - λ) * C_t + λ * C_0
// Where:
// - C_t: Sample correlation matrix
// - C_0: Prior space (global + spread + cyclical factors)
// - λ: Regularization strength (0.9 optimal)
```

### 2. Signal Generation Flow
1. Fetch US sector returns (11 sectors)
2. Fetch Japan sector returns (17 sectors)
3. Compute regularized correlation matrix
4. Eigenvalue decomposition (top K factors)
5. Project US returns → reconstruct Japan predictions
6. Rank & construct long-short portfolio

### 3. Portfolio Construction
- **Quantile:** Top/bottom 40% (configurable)
- **Weights:** Equal weight long + equal weight short
- **Rebalance:** Daily (close-to-open)

## Configuration

### Environment Variables (.env)
```bash
ALPHAVANTAGE_API_KEY=your_key
JQUANTS_API_TOKEN=your_token
PORT=3000
NODE_ENV=development
```

### Runtime Config (config/runtime-data-source.json)
- Not committed to git (contains API keys)
- Auto-created on first run
- Use `npm run parity:data` to validate

## Testing Instructions

```bash
# Before committing
npm run lint && npm test

# Full CI workflow
npm run workflow:full

# Specific test file
npx jest tests/lib/pca/subspace.test.js

# E2E specific scenario
npm run test:e2e:monkey  # UI stress test
```

## Common Issues & Solutions

### Eigenvalue Convergence Failure
- **Symptom:** Warning in logs about non-convergence
- **Fix:** Increase `maxIter` in `lib/math/eigen.js` or adjust `tolerance`

### Data Fetch Errors
- **Symptom:** Yahoo Finance rate limiting
- **Fix:** Add delay between requests, use cache in `data/cache/`

### CORS Issues (Development)
- **Symptom:** Frontend can't connect to API
- **Fix:** Ensure server runs on port 3000, check `src/server/bootstrap.js`

## Directory-Specific CLAUDE.md Files

- `/src/server` - See `src/server/CLAUDE.md` for Express patterns
- `/lib/pca` - See `lib/pca/CLAUDE.md` for mathematical implementation details
- `/lib/data` - See `lib/data/CLAUDE.md` for data source patterns

## Safety Rules

1. **Never commit .env or runtime-data-source.json**
2. **Always create Git branch for new features**
3. **Run tests before committing**
4. **Log all errors with Winston, never silent failures**
5. **Validate all external API responses**

## Model Selection Guide

- **Quick questions:** Haiku
- **Code generation:** Sonnet
- **Complex refactoring:** Opus
- **Code review:** Opus or Sonnet

## External Resources

- [Project README](./README.md)
- [Strategy Documentation](./docs/)
- [Beginner Guide](./BEGINNER_GUIDE.md)
- [QWEN.md](./QWEN.md) - Project technical summary
