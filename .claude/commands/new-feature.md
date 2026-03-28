# New Feature Development Workflow

## Usage
`/new-feature [feature description]`

## Workflow

1. **Understand Requirements**
   - Read relevant existing code
   - Identify patterns to follow
   - Check for existing similar functionality

2. **Create Implementation Plan**
   - List all files to create/modify
   - Define function signatures
   - Identify dependencies
   - Estimate complexity

3. **Create Git Branch**
   ```bash
   git checkout -b feature/[feature-name]
   ```

4. **Implement**
   - Follow existing code style (CommonJS, camelCase)
   - Add JSDoc comments
   - Write unit tests alongside implementation
   - Log errors with Winston

5. **Test**
   ```bash
   npm run lint && npm test
   ```

6. **Commit**
   - Write clear commit message
   - Reference any related issues

## Code Style Reminders
- CommonJS modules (`require`/`module.exports`)
- Async/await for async operations
- Try-catch with logging
- Equal weight to error handling and happy path
