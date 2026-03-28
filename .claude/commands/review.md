# Code Review Checklist

## Usage
`/review [file or PR description]`

## Security Review

- [ ] No prototype pollution (`__proto__`, `constructor`, `prototype`)
- [ ] Input validation on all external data
- [ ] No hardcoded secrets or API keys
- [ ] CORS configured properly (not `app.use(cors())` in production)
- [ ] Rate limiting on API endpoints
- [ ] No SQL injection or path traversal risks
- [ ] XSS prevention (use `textContent` not `innerHTML`)

## Error Handling

- [ ] All async operations have try-catch
- [ ] Errors logged with Winston
- [ ] No silent failures
- [ ] Proper error responses to clients
- [ ] Convergence checks for numerical methods

## Code Quality

- [ ] Follows CommonJS pattern
- [ ] camelCase naming (snake_case for Python)
- [ ] JSDoc on public functions
- [ ] No magic numbers (use constants or config)
- [ ] Functions < 50 lines (extract if longer)
- [ ] No code duplication (DRY)

## Performance

- [ ] No unnecessary array copies
- [ ] Caching for expensive operations
- [ ] Efficient sorting (quickselect for top-K)
- [ ] No memory leaks (bounded arrays)
- [ ] Connection pooling for external APIs

## Testing

- [ ] Unit tests for new functions
- [ ] Edge cases covered
- [ ] E2E tests for critical paths
- [ ] Tests pass: `npm test`

## Documentation

- [ ] README updated if needed
- [ ] Inline comments for complex logic
- [ ] API docs for new endpoints

## Pre-Commit Checklist

```bash
# Run all checks
npm run lint && npm test

# Check for type errors (if TypeScript)
npm run typecheck

# Verify e2e tests
npm run test:e2e
```

## Review Output Format

```markdown
## Review Summary

| Category | Status | Issues |
|----------|--------|--------|
| Security | ✅/❌ | List any issues |
| Error Handling | ✅/❌ | ... |
| Code Quality | ✅/❌ | ... |
| Performance | ✅/❌ | ... |
| Testing | ✅/❌ | ... |

## Critical Issues
1. [File:Line] Description + Fix suggestion

## Suggestions
1. [File:Line] Improvement idea
```
