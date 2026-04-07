'use strict';

const { registerStrategyRoutes, formatStrategyError } = require('../../src/server/routes/strategyRoutes');

function createAppStub() {
  const routes = {};
  return {
    routes,
    post(path, handler) {
      routes[path] = handler;
    }
  };
}

function createResStub() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
  return res;
}

describe('strategy routes', () => {
  test('registers backtest and signal handlers', () => {
    const app = createAppStub();
    registerStrategyRoutes(app, {
      strategyService: {
        runBacktest: jest.fn(),
        generateSignal: jest.fn()
      },
      logger: { error: jest.fn() },
      config: { server: { isDevelopment: true } }
    });

    expect(typeof app.routes['/api/backtest']).toBe('function');
    expect(typeof app.routes['/api/signal']).toBe('function');
  });

  test('/api/backtest returns service response', async () => {
    const app = createAppStub();
    const runBacktest = jest.fn().mockResolvedValue({ status: 202, data: { ok: true } });
    registerStrategyRoutes(app, {
      strategyService: { runBacktest, generateSignal: jest.fn() },
      logger: { error: jest.fn() },
      config: { server: { isDevelopment: true } }
    });

    const res = createResStub();
    await app.routes['/api/backtest']({ body: { foo: 'bar' } }, res);

    expect(runBacktest).toHaveBeenCalledWith({ foo: 'bar' });
    expect(res.statusCode).toBe(202);
    expect(res.body).toEqual({ ok: true });
  });

  test('/api/signal returns service response', async () => {
    const app = createAppStub();
    const generateSignal = jest.fn().mockResolvedValue({ status: 200, data: { signals: [] } });
    registerStrategyRoutes(app, {
      strategyService: { runBacktest: jest.fn(), generateSignal },
      logger: { error: jest.fn() },
      config: { server: { isDevelopment: true } }
    });

    const res = createResStub();
    await app.routes['/api/signal']({ body: { windowLength: 70 } }, res);

    expect(generateSignal).toHaveBeenCalledWith({ windowLength: 70 });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ signals: [] });
  });

  test('errors are formatted based on environment', async () => {
    const app = createAppStub();
    const error = new Error('boom');
    const logger = { error: jest.fn() };
    registerStrategyRoutes(app, {
      strategyService: {
        runBacktest: jest.fn().mockRejectedValue(error),
        generateSignal: jest.fn().mockRejectedValue(error)
      },
      logger,
      config: { server: { isDevelopment: false } }
    });

    const res = createResStub();
    await app.routes['/api/backtest']({ body: {} }, res);

    expect(logger.error).toHaveBeenCalledWith('Backtest failed', {
      error: 'boom',
      path: '/api/backtest'
    });
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Backtest failed' });
  });

  test('formatStrategyError exposes message in development', () => {
    expect(formatStrategyError({ server: { isDevelopment: true } }, 'fallback', new Error('details'))).toEqual({
      error: 'details'
    });
    expect(formatStrategyError({ server: { isDevelopment: false } }, 'fallback', new Error('details'))).toEqual({
      error: 'fallback'
    });
  });
});
