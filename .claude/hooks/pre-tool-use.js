/**
 * Pre-Tool-Use Hook
 * 
 * Runs before Claude executes any tool command.
 * Use for: Security checks, validation, logging
 */

const fs = require('fs');
const path = require('path');

// Protected files that should never be modified
const PROTECTED_FILES = [
  '.env',
  '.env.example',
  'config/runtime-data-source.json',
  'package-lock.json',
  '.gitignore',
  '.claudeignore'
];

// Protected patterns
const PROTECTED_PATTERNS = [
  /\.env\..*$/,
  /.*\.key$/,
  /.*\.secret$/,
  /.*password.*\.json$/
];

/**
 * Check if a file path is protected
 */
function isProtected(filePath) {
  const basename = path.basename(filePath);
  const relative = path.relative(process.cwd(), filePath);
  
  // Check exact matches
  if (PROTECTED_FILES.includes(basename) || PROTECTED_FILES.includes(relative)) {
    return true;
  }
  
  // Check patterns
  for (const pattern of PROTECTED_PATTERNS) {
    if (pattern.test(basename) || pattern.test(relative)) {
      return true;
    }
  }
  
  // Protect .env files
  if (basename.startsWith('.env')) {
    return true;
  }
  
  return false;
}

/**
 * Main hook function
 * 
 * @param {Object} context - Tool execution context
 * @returns {Object} - Modified context or error
 */
function preToolUse(context) {
  const { tool, args } = context;
  
  // Log all tool uses for audit trail
  const logEntry = {
    timestamp: new Date().toISOString(),
    tool: tool,
    args: sanitizeArgs(args)
  };
  
  // Append to audit log
  const auditLogPath = path.join(process.cwd(), '.claude', 'audit.log');
  try {
    fs.appendFileSync(auditLogPath, JSON.stringify(logEntry) + '\n');
  } catch {
    // Silent fail for logging
  }
  
  // Security check for file writes
  if (tool === 'write_file' || tool === 'edit') {
    const filePath = args?.file_path || args?.path;
    if (filePath && isProtected(filePath)) {
      return {
        error: true,
        message: `⚠️ SECURITY BLOCK: Attempted to modify protected file: ${filePath}`,
        blocked: true
      };
    }
  }
  
  // Security check for shell commands
  if (tool === 'run_shell_command') {
    const command = args?.command || '';
    
    // Block dangerous commands
    const dangerousCommands = [
      'rm -rf /',
      'rm -rf /\\*',
      'sudo rm',
      'mkfs',
      'dd if=/dev/zero',
      ':\\(\\)\\{:\\|:&\\};:',
      'chmod -R 777 /',
      'wget.*\\|.*sh',
      'curl.*\\|.*sh'
    ];
    
    for (const pattern of dangerousCommands) {
      if (new RegExp(pattern).test(command)) {
        return {
          error: true,
          message: `⚠️ SECURITY BLOCK: Dangerous command detected: ${command}`,
          blocked: true
        };
      }
    }
    
    // Warn on git operations that affect main branch
    if (command.includes('git push') && command.includes('origin main')) {
      console.warn('⚠️ WARNING: About to push to main branch. Consider using a feature branch.');
    }
  }
  
  return context;
}

/**
 * Sanitize arguments for logging (remove sensitive data)
 */
function sanitizeArgs(args) {
  if (!args) return args;
  
  const sanitized = { ...args };
  
  // Remove potential secrets
  const sensitiveKeys = ['password', 'secret', 'key', 'token', 'auth'];
  for (const key of sensitiveKeys) {
    if (sanitized[key]) {
      sanitized[key] = '[REDACTED]';
    }
  }
  
  return sanitized;
}

// Export for hook system
module.exports = { preToolUse };

// Run if called directly
if (require.main === module) {
  const context = JSON.parse(process.argv[2] || '{}');
  const result = preToolUse(context);
  console.log(JSON.stringify(result));
}
