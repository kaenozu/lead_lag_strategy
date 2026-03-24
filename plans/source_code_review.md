# Full Source Code Review & Refactoring Plan

## 1. 🔍 Analysis & Context

The **Lead-Lag Strategy** project is a hybrid system comprising a Python-based reference implementation (for research/backtesting) and a Node.js-based production system (for real-time signal generation and web/API interface).

*   **Objective:** Ensure the Node.js production system allows for **numerical parity** with the Python reference, is **architecturally maintainable**, and **secure**.
*   **Core Logic:** Subspace Regularized PCA (Principal Component Analysis) to detect lead-lag relationships between US and JP sector ETFs.
*   **Key Risks:**
    *   **Numerical Divergence:** Custom JS linear algebra (`eigenSymmetricTopK`) vs Python `numpy.linalg`. Small errors here compound into incorrect trading signals.
    *   **Architectural Debt:** `src/server.js` is a monolithic file handling routing, logic, and configuration.
    *   **Data Consistency:** Multiple data providers (Yahoo, AlphaVantage, J-Quants) with complex failover logic.

## 2. 📋 Checklist

- [ ] **Phase 1: Math Core Verification (High Priority)**
    - [ ] Compare "Prior Space" ($C_0$) construction logic between Python and JS.
    - [ ] Compare Eigen decomposition results (`eigenSymmetricTopK` vs `numpy.linalg.eigh`) using identical input matrices.
    - [ ] Verify Signal Generation output for a fixed set of inputs.
- [ ] **Phase 2: Architectural Refactoring**
    - [ ] Split `src/server.js` into `routes`, `controllers`, and `middleware`.
    - [ ] Standardize API error responses and logging.
- [ ] **Phase 3: Data Layer Review**
    - [ ] Audit `lib/data/sourceRecovery.js` for race conditions or infinite loops.
    - [ ] Verify error handling for AlphaVantage/J-Quants API limits.
- [ ] **Phase 4: Security & Quality**
    - [ ] Audit `API_KEY` handling (currently in headers).
    - [ ] Review `package.json` for unused or outdated dependencies.
    - [ ] Ensure sensitive data (if any) is not logged.

## 3. 📝 Step-by-Step Implementation Details

### Phase 1: Math Core Verification

#### Step 1.1: Logical Audit of Prior Space ($C_0$)
*   **Goal:** Ensure `lib/pca.js` constructs the prior correlation matrix ($C_0$) exactly like `subspace_pca.py`.
*   **Action:**
    *   Read `lib/pca/subspace.js` (or equivalent) and `subspace_pca.py`.
    *   Check the "Global Factor", "Country Spread", and "Sector" vector definitions.
    *   **Verification:** Manual code review + Unit test with fixed dimensions ($N=4$).

#### Step 1.2: Numerical Parity Check (Eigen Decomposition)
*   **Goal:** Validate `eigenSymmetricTopK` accuracy.
*   **Action:**
    *   Create `scripts/parity/gen_matrix.py`: Generate a random symmetric matrix and save to JSON.
    *   Create `scripts/parity/check_eigen.js`: Load JSON, run `eigenSymmetricTopK`.
    *   Create `scripts/parity/check_eigen.py`: Load JSON, run `np.linalg.eigh`.
    *   Compare eigenvalues (allow $10^{-6}$ tolerance) and eigenvectors (direction agnostic).
*   **Contingency:** If JS is inaccurate, switch to `mathjs` or a WASM-based linear algebra library.

### Phase 2: Architectural Refactoring

#### Step 2.1: Modularize Server
*   **Goal:** Decompose `src/server.js`.
*   **Action:**
    *   Create `src/middleware/auth.js` (API Key).
    *   Create `src/middleware/rateLimit.js`.
    *   Create `src/routes/backtest.js`, `src/routes/signal.js`, `src/routes/config.js`.
    *   Move logic from `app.post('/api/backtest')` to `src/controllers/backtestController.js`.
*   **Verification:** `npm start` works identical to before; existing e2e tests pass.

### Phase 3: Data Layer Review

#### Step 3.1: Data Provider Robustness
*   **Goal:** Ensure system doesn't crash on API failures.
*   **Action:**
    *   Review `lib/data/fetch.js` and `providerAdapter.js`.
    *   Check `retry` logic.
    *   Verify `sourceRecovery` fallback triggers correctly without "flapping".

## 4. 🧪 Testing Strategy

*   **Unit Tests:**
    *   New test suite: `tests/math/parity.test.js` (using fixtures from Phase 1).
*   **Integration Tests:**
    *   Run `npm run test:e2e` after refactoring server.
*   **Manual Verification:**
    *   Run `npm run signal` and compare output top 3 tickers with `python backtest.py` (if data aligns).

## 5. ✅ Success Criteria

*   **Parity:** JS and Python eigenvalues match within $1e-6$.
*   **Cleanliness:** `src/server.js` < 100 lines (currently monolithic).
*   **Stability:** `npm test` passes all suites including new math checks.
