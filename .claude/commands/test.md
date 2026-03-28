# Test Writing Workflow

## Usage
`/test [file or function to test]`

## Test Types

### Unit Tests (Jest)
Location: `tests/`

```javascript
// Example: tests/lib/math/matrix.test.js
const { multiply } = require('../../../lib/math/matrix');

describe('matrix.multiply', () => {
  it('should multiply two matrices correctly', () => {
    const A = [[1, 2], [3, 4]];
    const B = [[5, 6], [7, 8]];
    const expected = [[19, 22], [43, 50]];
    
    expect(multiply(A, B)).toEqual(expected);
  });
  
  it('should throw on dimension mismatch', () => {
    const A = [[1, 2]];
    const B = [[1, 2]];
    
    expect(() => multiply(A, B)).toThrow('Dimension mismatch');
  });
});
```

### E2E Tests (Playwright)
Location: `e2e/`

```javascript
// Example: e2e/api-smoke.spec.js
import { test, expect } from '@playwright/test';

test('API returns valid signal', async ({ request }) => {
  const response = await request.post('/api/signal', {
    data: { windowLength: 60, nFactors: 3 }
  });
  
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body).toHaveProperty('signals');
  expect(body.signals).toBeInstanceOf(Array);
});
```

## Test Writing Guidelines

### 1. Arrange-Act-Assert Pattern
```javascript
it('should [expected behavior]', () => {
  // Arrange
  const input = ...;
  
  // Act
  const result = functionUnderTest(input);
  
  // Assert
  expect(result).toEqual(expected);
});
```

### 2. Test Edge Cases
- Empty inputs
- Null/undefined
- Boundary values
- Dimension mismatches
- Convergence failures
- API timeouts

### 3. Mock External Dependencies
```javascript
jest.mock('../../../lib/data/fetch', () => ({
  fetchOhlcvForTickers: jest.fn().mockResolvedValue(mockData)
}));
```

### 4. Use Descriptive Names
```javascript
// ❌ Bad
it('should work', () => {});

// ✅ Good
it('should return empty array when no data available', () => {});
```

### 5. Test Numerical Precision
```javascript
// For floating point comparisons
expect(result).toBeCloseTo(expected, 5);

// For matrix comparisons
expect(result).toEqual(expect.arrayContaining(expected));
```

## Running Tests

```bash
# All tests
npm test

# Specific file
npx jest tests/lib/pca/signal.test.js

# Watch mode
npm run test:watch

# With coverage
npx jest --coverage

# E2E tests
npm run test:e2e

# Specific E2E test
npx playwright test e2e/api-smoke.spec.js
```

## Coverage Target

- **Lines:** >80%
- **Functions:** >90%
- **Branches:** >75%

## Test File Naming

- Unit tests: `[function].test.js` or `[module].test.js`
- E2E tests: `[scenario].spec.js`
