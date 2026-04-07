# Claude Code Workflow Guide

## Getting Started

### 1. First-Time Setup

```bash
# Verify Claude Code configuration
ls -la CLAUDE.md .claudeignore .claude/

# Test commands
/fix-bug Test command
/review package.json
```

### 2. Understanding the Configuration

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Project memory - automatically read by Claude |
| `.claudeignore` | Files excluded from context (50-70% token reduction) |
| `.claude/commands/` | Custom slash commands for workflows |
| `.claude/hooks/` | Pre/post tool automation |

---

## Core Workflows

### Workflow 1: Plan → Execute (Recommended for All Tasks)

```
Step 1: Ask for a plan
> "Think hard about implementing [feature]. Create a detailed plan. Do not write code yet."

Step 2: Review and refine
> "The plan looks good, but [suggestion]. Also consider [edge case]."

Step 3: Green light
> "Proceed with implementation. Follow the plan and create a Git branch."

Step 4: Verify
> "Run tests and lint. Fix any issues."
```

**Why this works:** Forces Claude to understand requirements before coding, reducing rework.

---

### Workflow 2: Bug Fix

```bash
# Start with context
/fix-bug Signal generation fails with dimension error

# Claude will:
# 1. Reproduce the bug
# 2. Locate root cause
# 3. Create branch: fix/signal-dimension-error
# 4. Implement fix with test
# 5. Run: npm run lint && npm test
```

---

### Workflow 3: Code Review

```bash
# Review specific file
/review lib/pca/signal.js

# Review PR description
/review "Added new momentum factor to strategy"

# Output format:
## Review Summary
| Category | Status | Issues |
|----------|--------|--------|
| Security | ✅ | None |
| Error Handling | ❌ | Missing try-catch in line 45 |
...
```

---

### Workflow 4: Test Writing

```bash
# Generate tests for a function
/test lib/math/eigen.js eigenSymmetricTopK

# Output:
# - Unit tests in tests/lib/math/eigen.test.js
# - Edge cases covered
# - Run: npx jest tests/lib/math/eigen.test.js
```

---

## Slash Commands

| Command | File | Usage |
|---------|------|-------|
| `/new-feature` | `.claude/commands/new-feature.md` | Start feature development |
| `/fix-bug` | `.claude/commands/fix-bug.md` | Bug fix workflow |
| `/review` | `.claude/commands/review.md` | Code review checklist |
| `/test` | `.claude/commands/test.md` | Test generation |

---

## Director Mode Best Practices

### ❌ Micromanagement (Avoid)
```
> "Change variable x to y on line 10"
> "Add a parameter for timeout"
> "Wrap this in try-catch"
```

### ✅ Director Mode (Recommended)
```
> "Implement rate limiting for API endpoints. Target: 100 req/min per IP.
>  Use express-rate-limit. Add tests for rate limit exceeded scenario."
```

---

## Context Management

### When to Use `/clear`
- Switching between unrelated tasks
- After 20+ messages in a conversation
- When Claude seems confused about requirements

### Sub-Agent Usage
```
> "Use a sub-agent to perform security review of paperRoutes.js.
>  Focus on: input validation, rate limiting, error handling."
```

---

## Automation with Hooks

### Pre-Tool-Use Hook (`.claude/hooks/pre-tool-use.js`)
- **Security blocks:** Protected files, dangerous commands
- **Audit logging:** All tool uses logged
- **Warnings:** Git push to main, etc.

### Post-Tool-Use Hook (`.claude/hooks/post-tool-use.js`)
- **Auto-lint:** ESLint --fix after JS file edits
- **Auto-test:** Run tests after test file edits
- **Validation:** JSON syntax check after JSON edits

---

## Model Selection

| Task | Recommended Model |
|------|-------------------|
| Quick questions | Haiku |
| Code generation | Sonnet |
| Complex refactoring | Opus |
| Code review | Opus / Sonnet |
| Test writing | Sonnet |

---

## Prompt Enhancement Techniques

### 1. File References
```
> "Refactor this component [tab-complete: src/server/services/strategyService.js]
>  to follow the pattern in [tab-complete: lib/pca/signal.js]"
```

### 2. URL Context
```
> "Implement error handling following this guide:
>  https://github.com/your-repo/issues/123"
```

### 3. Images
```
> [Drag screenshot of design mock]
> "Implement this UI layout in public/index.html"
```

### 4. Explicit Instructions
```
> "Write a unit test for calculateReturns() covering:
>  - Normal case with valid prices
>  - Edge case with zero prices
>  - Edge case with NaN values
>  Do not use mocks."
```

---

## Git Workflow

### Branch-per-Feature (Always)
```bash
# Claude should create branch for every change
git checkout -b feature/[name]
git checkout -b fix/[name]
git checkout -b refactor/[name]
```

### Commit Messages
```bash
# Conventional Commits format
feat: add momentum factor to strategy
fix: handle dimension mismatch in signal generation
refactor: extract validation logic to separate function
test: add unit tests for eigenvalue decomposition
docs: update CLAUDE.md with PCA patterns
```

---

## Testing Workflow

### Before Committing
```bash
# Full test suite
npm test

# Or quick check
npm run lint && npm run doctor:ci
```

### Test-Specific
```bash
# Unit tests only
npx jest

# E2E tests only
npm run test:e2e

# Coverage report
npx jest --coverage
```

---

## Common Scenarios

### Scenario 1: Adding New Feature
```
1. /new-feature "Add walk-forward analysis"
2. Review implementation plan
3. Claude creates branch and implements
4. Review code with /review
5. Run: npm test
6. Commit and merge
```

### Scenario 2: Fixing Bug
```
1. /fix-bug "Eigenvalue convergence failure"
2. Claude reproduces and locates bug
3. Implements fix with test
4. Run: npm test
5. Verify fix resolves issue
```

### Scenario 3: Code Review
```
1. /review "PR: Added new data source"
2. Review security, error handling, code quality
3. Request fixes for issues
4. Re-review after fixes
```

---

## Troubleshooting

### Claude Forgets Context
**Solution:** Use `/clear` and restate requirements with file references.

### Tests Fail After Implementation
**Solution:** Run `npm test` and share error output. Ask Claude to fix.

### Lint Errors
**Solution:** Run `npm run lint:fix` for auto-fixable issues.

### Rate Limiting from Data Sources
**Solution:** Use cached data in `data/cache/` or add delays between requests.

---

## Performance Tips

### Token Reduction
1. `.claudeignore` excludes 50-70% of files
2. Use `/clear` between tasks
3. Reference specific files instead of entire codebase

### Faster Iteration
1. Use Director Mode (high-level instructions)
2. Run multiple agents in parallel for independent tasks
3. Cache intermediate results in files

---

## Security Reminders

1. **Never commit** `.env` or `config/runtime-data-source.json`
2. **Always review** before committing to main branch
3. **Check audit log** `.claude/hooks/audit.log` for unusual activity
4. **Protected files** cannot be modified (see `pre-tool-use.js`)

---

## Resources

- [Main CLAUDE.md](./CLAUDE.md) - Project overview
- [Server Module](./src/server/CLAUDE.md) - Express patterns
- [PCA Module](./lib/pca/CLAUDE.md) - Mathematical implementation
- [Data Module](./lib/data/CLAUDE.md) - Data fetching patterns
- [BEGINNER_GUIDE.md](./BEGINNER_GUIDE.md) - Getting started
