/**
 * Skills Index
 * 
 * Exports all skills and provides CLI interface
 */

const { loadAllSkills, formatDuration } = require('./skill-base');
const { createLogger } = require('../lib/logger');

const logger = createLogger('Skills');

// Load all skills
const skills = loadAllSkills();

/**
 * Run a single skill
 * @param {string} skillName - Name of skill to run
 * @param {Object} config - Configuration overrides
 */
async function runSkill(skillName, config = {}) {
  if (!skills[skillName]) {
    const available = Object.keys(skills).join(', ');
    throw new Error(`Skill '${skillName}' not found. Available: ${available}`);
  }
  
  const skill = skills[skillName];
  logger.info(`Running skill: ${skillName}`, { config });
  
  const startTime = Date.now();
  
  try {
    const result = await skill.execute(config);
    const duration = Date.now() - startTime;
    
    console.log(`\n✅ Skill '${skillName}' completed in ${formatDuration(duration)}`);
    
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(`Skill '${skillName}' failed`, { error: error.message, duration });
    throw error;
  }
}

/**
 * Run all skills in sequence
 * @param {Object} baseConfig - Base configuration
 */
async function runAllSkills(baseConfig = {}) {
  const results = {};
  const startTime = Date.now();
  
  console.log(`\n🚀 Running all ${Object.keys(skills).length} skills...\n`);
  
  for (const [name, skill] of Object.entries(skills)) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Running: ${name} - ${skill.description}`);
    console.log('='.repeat(60));
    
    try {
      const result = await skill.execute(baseConfig);
      results[name] = {
        success: true,
        result
      };
      console.log(`✅ ${name} completed`);
    } catch (error) {
      results[name] = {
        success: false,
        error: error.message
      };
      console.error(`❌ ${name} failed: ${error.message}`);
    }
  }
  
  const totalDuration = Date.now() - startTime;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`All skills completed in ${formatDuration(totalDuration)}`);
  console.log('='.repeat(60));
  
  // Summary
  const successCount = Object.values(results).filter(r => r.success).length;
  const failCount = Object.values(results).filter(r => !r.success).length;
  console.log(`\n📊 Summary: ${successCount} succeeded, ${failCount} failed\n`);
  
  return results;
}

/**
 * List all available skills
 */
function listSkills() {
  console.log('\n📋 Available Skills:\n');
  console.log('='.repeat(60));
  
  for (const [name, skill] of Object.entries(skills)) {
    console.log(`\n${name}`);
    console.log('-'.repeat(40));
    console.log(`  Description: ${skill.description}`);
    console.log(`  Default Config: ${JSON.stringify(skill.defaultConfig, null, 2)}`);
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('\nUsage:');
  console.log('  npm run skill:<name>           # Run single skill');
  console.log('  npm run skill:full             # Run all skills');
  console.log('  npm run skill:list             # List all skills');
  console.log('\n');
}

/**
 * Get skill info
 * @param {string} skillName 
 */
function getSkillInfo(skillName) {
  if (!skills[skillName]) {
    throw new Error(`Skill '${skillName}' not found`);
  }
  
  const skill = skills[skillName];
  return {
    name: skill.name,
    description: skill.description,
    defaultConfig: skill.defaultConfig
  };
}

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];
  
  (async () => {
    try {
      switch (command) {
      case 'list':
        listSkills();
        break;
          
      case 'run':
      case 'all':
        if (command === 'all' || args[1] === 'all') {
          await runAllSkills();
        } else if (!args[1]) {
          console.error('Error: Skill name required');
          console.error('Usage: node skills/index.js run <skill-name>');
          process.exit(1);
        } else {
          await runSkill(args[1]);
        }
        break;
          
      case 'info':
        if (!args[1]) {
          console.error('Error: Skill name required');
          process.exit(1);
        }
        console.log(getSkillInfo(args[1]));
        break;
          
      default:
        listSkills();
      }
    } catch (error) {
      console.error('Error:', error.message);
      console.error(error.stack);
      process.exit(1);
    }
  })();
}

module.exports = {
  skills,
  runSkill,
  runAllSkills,
  listSkills,
  getSkillInfo
};
