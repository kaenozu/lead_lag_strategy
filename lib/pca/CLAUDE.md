# PCA Module - CLAUDE.md

## Overview
Core mathematical implementation of subspace-regularized PCA for lead-lag prediction.

## Mathematical Foundation

### Regularized Correlation Matrix
```
C_reg = (1 - λ) * C_t + λ * C_0
```

Where:
- `C_t`: Sample correlation matrix (from recent data)
- `C_0`: Prior space matrix (global + spread + cyclical factors)
- `λ`: Regularization strength (0.0 = no regularization, 1.0 = prior only)

### Prior Space Construction
```javascript
// Three orthogonal factors
v1 (Global):      [1, 1, 1, ..., 1] / sqrt(N)
v2 (Spread):      [+1, +1, ..., -1, -1] / sqrt(N)  // US +, JP -
v3 (Cyclical):    Sector-specific weights
```

### Eigenvalue Decomposition
```javascript
// Power iteration method
for (let iter = 0; iter < maxIter; iter++) {
  v_new = A * v / ||A * v||
  if (||v_new - v|| < tolerance) break
}
```

## File Structure

```
lib/pca/
├── subspace.js       # Prior space construction
├── signal.js         # Signal generation
├── CLAUDE.md
└── [test files]
```

## Key Functions

### buildPriorSpace(sectorLabels, nUs, nJp)
```javascript
// Returns: { v1, v2, v3, C0 }
// v1, v2, v3: Orthogonal factor vectors
// C0: Prior correlation matrix = V * V^T
```

### regularizeCorrelationMatrix(R, prior, lambda)
```javascript
// R: Sample correlation matrix
// prior: { C0 } from buildPriorSpace
// lambda: Regularization strength (0.9 optimal)
// Returns: Regularized matrix
```

### generateSignals(returnsUs, returnsJp, params)
```javascript
// Main entry point
// Returns: Array of { ticker, signal, rank }
```

## Numerical Stability

### Convergence Requirements
```javascript
const EIGEN_CONFIG = {
  maxIter: 1000,
  tolerance: 1e-8,
  minEigenvalue: 1e-10,  // Skip near-zero eigenvalues
};
```

### Handling Non-Convergence
```javascript
// ALWAYS check convergence
if (!converged) {
  logger.warn(`Eigenvalue ${i} did not converge`);
  throw new Error(`Eigenvalue decomposition failed: mode ${i}`);
  // NEVER continue with non-converged eigenvector
}
```

## Input Validation

```javascript
_validateInputs(returnsUs, returnsJp, returnsUsLatest) {
  // Check existence
  if (!returnsUs || !returnsJp) {
    throw new Error('Returns data is missing');
  }
  
  // Check dimensions
  const expectedUs = 11;  // US sectors
  const expectedJp = 17;  // JP sectors
  
  if (returnsUs[0]?.length !== expectedUs) {
    throw new Error(`US returns: expected ${expectedUs} columns, got ${returnsUs[0]?.length}`);
  }
  
  if (returnsJp[0]?.length !== expectedJp) {
    throw new Error(`JP returns: expected ${expectedJp} columns, got ${returnsJp[0]?.length}`);
  }
  
  // Check sufficient history
  const minHistory = 60;  // windowLength
  if (returnsUs.length < minHistory) {
    throw new Error(`Insufficient history: ${returnsUs.length} < ${minHistory}`);
  }
}
```

## Performance Optimization

### Caching Strategy
```javascript
// Cache expensive operations
const cache = {
  priorSpace: null,
  priorSpaceExpiry: null,
  eigenDecomp: new Map(),  // Keyed by matrix hash
};

// Prior space is static, compute once
if (!cache.priorSpace || Date.now() > cache.priorSpaceExpiry) {
  cache.priorSpace = buildPriorSpace(labels);
  cache.priorSpaceExpiry = Date.now() + 3600000;  // 1 hour
}
```

### Matrix Operations
```javascript
// Use efficient implementations
// ❌ Slow: Nested loops
for (let i = 0; i < n; i++) {
  for (let j = 0; j < n; j++) {
    result[i][j] = 0;
    for (let k = 0; k < m; k++) {
      result[i][j] += A[i][k] * B[k][j];
    }
  }
}

// ✅ Fast: Optimized library or vectorized
const result = multiply(A, B);  // lib/math/matrix.js
```

## Testing

```javascript
// tests/lib/pca/subspace.test.js
describe('buildPriorSpace', () => {
  it('should create orthogonal factors', () => {
    const { v1, v2, v3 } = buildPriorSpace(labels, 11, 17);
    
    // Check orthogonality
    expect(dot(v1, v2)).toBeCloseTo(0, 10);
    expect(dot(v1, v3)).toBeCloseTo(0, 10);
    expect(dot(v2, v3)).toBeCloseTo(0, 10);
    
    // Check normalization
    expect(norm(v1)).toBeCloseTo(1, 10);
    expect(norm(v2)).toBeCloseTo(1, 10);
    expect(norm(v3)).toBeCloseTo(1, 10);
  });
});
```

## Debugging

### Check Matrix Properties
```javascript
// Symmetry
function isSymmetric(M) {
  for (let i = 0; i < M.length; i++) {
    for (let j = i + 1; j < M[i].length; j++) {
      if (Math.abs(M[i][j] - M[j][i]) > 1e-10) return false;
    }
  }
  return true;
}

// Positive semi-definite (all eigenvalues >= 0)
function isPSD(M) {
  const { eigenvalues } = eigenSymmetric(M);
  return eigenvalues.every(e => e >= -1e-10);
}
```

### Log Intermediate Results
```javascript
logger.debug('Correlation matrix stats:', {
  min: Math.min(...R.flat()),
  max: Math.max(...R.flat()),
  mean: R.flat().reduce((a, b) => a + b, 0) / R.flat().length,
  isSymmetric: isSymmetric(R),
  isPSD: isPSD(R),
});
```

## Known Issues

| Issue | Location | Status |
|-------|----------|--------|
| Convergence check missing | eigen.js:220-240 | CRITICAL |
| Dimension validation incomplete | signal.js:45-55 | CRITICAL |
| Sector label handling | subspace.js:95-110 | HIGH |
