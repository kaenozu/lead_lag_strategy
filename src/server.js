/**
 * Lead-Lag Strategy - Web Backend Server
 * Modular Entry Point
 */

'use strict';

const { createApp } = require('./server/bootstrap');
const { config } = require('../lib/config');
const { createLogger } = require('../lib/logger');

const logger = createLogger('ServerMain');

const app = createApp();
const PORT = config.server.port;

app.listen(PORT, () => {
  logger.info('Server started', { port: PORT, env: config.server.env });
  logger.info('API endpoints initialized via modular routes.');
});

module.exports = app;
