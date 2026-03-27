'use strict';

function buildHealthPayload() {
  return {
    status: 'ok',
    timestamp: new Date().toISOString()
  };
}

function registerSystemRoutes(app, deps) {
  const { riskPayload } = deps;

  app.get('/api/disclosure', (_req, res) => {
    res.json(riskPayload());
  });

  app.get('/api/health', (_req, res) => {
    res.json(buildHealthPayload());
  });
}

module.exports = {
  registerSystemRoutes,
  buildHealthPayload
};
