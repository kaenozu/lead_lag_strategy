/**
 * Main application entry point
 * Re-exports server and signal generation modules
 */

const server = require('./server');
const generateSignal = require('./generate_signal');

module.exports = {
  server,
  generateSignal
};
