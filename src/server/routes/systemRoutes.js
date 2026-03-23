'use strict';

function registerSystemRoutes(app, deps) {
  const { riskPayload } = deps;

  app.get('/api/disclosure', (req, res) => {
    res.json(riskPayload());
  });

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });
}

module.exports = {
  registerSystemRoutes
};

