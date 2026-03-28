/**
 * Post-Tool-Use Hook
 *
 * Runs after Claude executes a tool command.
 * Use for: Auto-formatting, linting, validation
 */

const { execSync } = require('child_process');
const fs = require('fs');

/**
 * Main hook function
 *
 * @param {Object} context - Tool execution context
 * @returns {Object} - Modified context or additional actions
 */
function postToolUse(context) {
  const { tool, args } = context;

  // Auto-lint after file modifications
  if (tool === 'write_file' || tool === 'edit') {
    const filePath = args?.file_path || args?.path;

    if (filePath && (filePath.endsWith('.js') || filePath.endsWith('.ts'))) {
      try {
        // Run ESLint on the modified file
        execSync(`npx eslint "${filePath}" --fix`, {
          stdio: 'pipe',
          timeout: 10000
        });
        console.log(`✅ Auto-fixed: ${filePath}`);
      } catch (err) {
        // ESLint might fail, just log
        console.warn(`⚠️ ESLint warning for ${filePath}: ${err.message}`);
      }
    }
  }

  // Run type check after TypeScript file modifications
  if (tool === 'write_file' || tool === 'edit') {
    const filePath = args?.file_path || args?.path;

    if (filePath && filePath.endsWith('.ts')) {
      try {
        execSync('npx tsc --noEmit', {
          stdio: 'pipe',
          timeout: 30000
        });
        console.log('✅ Type check passed');
      } catch (e) {
        console.warn(`⚠️ Type check warning: ${e.message}`);
      }
    }
  }

  // Validate JSON after JSON file writes
  if (tool === 'write_file') {
    const filePath = args?.file_path || args?.path;

    if (filePath && filePath.endsWith('.json')) {
      try {
        JSON.parse(fs.readFileSync(filePath, 'utf8'));
        console.log(`✅ JSON valid: ${filePath}`);
      } catch (e) {
        console.error(`❌ JSON invalid: ${filePath} - ${e.message}`);
      }
    }
  }

  // Run tests after test file modifications
  if (tool === 'write_file' || tool === 'edit') {
    const filePath = args?.file_path || args?.path;

    if (filePath && (filePath.includes('/tests/') || filePath.endsWith('.test.js'))) {
      try {
        execSync(`npx jest "${filePath}"`, {
          stdio: 'inherit',
          timeout: 60000
        });
        console.log('✅ Tests passed');
      } catch {
        console.warn('⚠️ Tests failed - review required');
      }
    }
  }

  return context;
}

// Export for hook system
module.exports = { postToolUse };

// Run if called directly
if (require.main === module) {
  const context = JSON.parse(process.argv[2] || '{}');
  postToolUse(context);
}
