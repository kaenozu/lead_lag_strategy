# Bug Fix Workflow

## Usage
`/fix-bug [bug description]`

## Workflow

1. **Reproduce the Bug**
   - Understand the error scenario
   - Check logs and error messages
   - Identify affected components

2. **Locate Root Cause**
   - Search related code with grep
   - Read the suspicious code section
   - Trace the execution flow

3. **Plan the Fix**
   - Identify the minimal change needed
   - Consider edge cases
   - Check for similar patterns elsewhere

4. **Implement Fix**
   ```bash
   git checkout -b fix/[bug-name]
   ```
   - Make targeted changes
   - Add error handling if missing
   - Add comments for complex logic

5. **Add Test**
   - Create regression test in `tests/`
   - Cover the specific bug scenario
   - Run full test suite

6. **Verify**
   ```bash
   npm run lint && npm test
   ```

7. **Commit**
   - Use "fix:" prefix for commit message
   - Describe the bug and solution

## Common Bug Patterns

| Pattern | Location | Fix |
|---------|----------|-----|
| Null/undefined | Data fetching | Add null checks |
| Convergence failure | lib/math/eigen.js | Increase iterations |
| Rate limiting | lib/data/fetch.js | Add delays/cache |
| Type mismatch | Signal generation | Validate dimensions |
| Memory leak | bootstrap.js | Use ring buffer |
