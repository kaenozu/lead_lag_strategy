/**
 * Skill Base Module
 * 
 * Provides base class and utilities for creating project-specific skills
 */

const fs = require('fs');
const path = require('path');
const { createLogger } = require('../lib/logger');

const logger = createLogger('Skill');

/**
 * Skill result directory
 */
const RESULTS_DIR = path.join(__dirname, '..', 'results', 'skills');
const LOGS_DIR = path.join(__dirname, '..', 'logs', 'skills');

/**
 * Ensure directories exist
 */
function ensureDirectories() {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

/**
 * Create a skill with standard structure
 * 
 * @param {Object} options - Skill options
 * @param {string} options.name - Skill name
 * @param {string} options.description - Skill description
 * @param {Function} options.run - Main skill function
 * @param {Object} [options.defaultConfig] - Default configuration
 * @returns {Object} Skill object
 */
function createSkill({ name, description, run, defaultConfig = {} }) {
  return {
    name,
    description,
    defaultConfig,
    
    /**
     * Run the skill
     * @param {Object} config - Configuration overrides
     * @returns {Promise<Object>} Skill result
     */
    async execute(config = {}) {
      const startTime = Date.now();
      const skillConfig = { ...this.defaultConfig, ...config };
      
      logger.info(`Starting skill: ${name}`, { config: skillConfig });
      ensureDirectories();
      
      try {
        const result = await run(skillConfig);
        const duration = Date.now() - startTime;
        
        const output = {
          skill: name,
          success: true,
          duration,
          timestamp: new Date().toISOString(),
          config: skillConfig,
          data: result
        };
        
        // Save result
        const resultFile = path.join(RESULTS_DIR, `${name}_${Date.now()}.json`);
        fs.writeFileSync(resultFile, JSON.stringify(output, null, 2));
        
        logger.info(`Skill completed: ${name}`, { duration, resultFile });
        
        return output;
      } catch (error) {
        const duration = Date.now() - startTime;
        
        const output = {
          skill: name,
          success: false,
          duration,
          timestamp: new Date().toISOString(),
          config: skillConfig,
          error: error.message,
          stack: error.stack
        };
        
        logger.error(`Skill failed: ${name}`, { error: error.message, duration });
        
        // Save error result
        const errorFile = path.join(LOGS_DIR, `${name}_error_${Date.now()}.json`);
        fs.writeFileSync(errorFile, JSON.stringify(output, null, 2));
        
        throw error;
      }
    }
  };
}

/**
 * Load all skills from the skills directory
 * 
 * @returns {Object} Map of skill name to skill object
 */
function loadAllSkills() {
  const skills = {};
  const files = fs.readdirSync(__dirname);
  
  for (const file of files) {
    if (file.endsWith('.js') && file !== 'skill-base.js' && file !== 'index.js') {
      try {
        const skill = require(`./${file}`);
        if (skill.name) {
          skills[skill.name] = skill;
        }
      } catch (error) {
        logger.warn(`Failed to load skill: ${file}`, { error: error.message });
      }
    }
  }
  
  return skills;
}

/**
 * Format duration in human-readable format
 * 
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration
 */
function formatDuration(ms) {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * Save skill result to file
 * 
 * @param {string} skillName - Skill name
 * @param {Object} result - Result data
 * @returns {string} File path
 */
function saveResult(skillName, result) {
  ensureDirectories();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(RESULTS_DIR, `${skillName}_${timestamp}.json`);
  fs.writeFileSync(filePath, JSON.stringify(result, null, 2));
  return filePath;
}

module.exports = {
  createSkill,
  loadAllSkills,
  formatDuration,
  saveResult,
  RESULTS_DIR,
  LOGS_DIR
};
