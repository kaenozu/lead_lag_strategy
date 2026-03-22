/**
 * lib/logger.js のテスト
 */

'use strict';

const { logger, createLogger } = require('../../lib/logger');

describe('lib/logger', () => {
  describe('logger インスタンス', () => {
    test('logger が存在する', () => {
      expect(logger).toBeDefined();
    });

    test('logger に info/warn/error/debug メソッドがある', () => {
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.debug).toBe('function');
    });

    test('logger.info は例外をスローしない', () => {
      expect(() => logger.info('test message')).not.toThrow();
    });

    test('logger.warn は例外をスローしない', () => {
      expect(() => logger.warn('test warning')).not.toThrow();
    });

    test('logger.error は例外をスローしない', () => {
      expect(() => logger.error('test error')).not.toThrow();
    });

    test('logger.debug は例外をスローしない', () => {
      expect(() => logger.debug('test debug')).not.toThrow();
    });
  });

  describe('createLogger', () => {
    test('コンテキスト付きロガーを返す', () => {
      const ctxLogger = createLogger('TestContext');
      expect(ctxLogger).toBeDefined();
      expect(typeof ctxLogger.info).toBe('function');
      expect(typeof ctxLogger.warn).toBe('function');
      expect(typeof ctxLogger.error).toBe('function');
      expect(typeof ctxLogger.debug).toBe('function');
    });

    test('info ログを例外なく呼び出せる', () => {
      const ctxLogger = createLogger('UnitTest');
      expect(() => ctxLogger.info('hello info')).not.toThrow();
    });

    test('warn ログを例外なく呼び出せる', () => {
      const ctxLogger = createLogger('UnitTest');
      expect(() => ctxLogger.warn('hello warn')).not.toThrow();
    });

    test('error ログを例外なく呼び出せる', () => {
      const ctxLogger = createLogger('UnitTest');
      expect(() => ctxLogger.error('hello error')).not.toThrow();
    });

    test('debug ログを例外なく呼び出せる', () => {
      const ctxLogger = createLogger('UnitTest');
      expect(() => ctxLogger.debug('hello debug')).not.toThrow();
    });

    test('メタデータ付きでログを呼び出せる', () => {
      const ctxLogger = createLogger('UnitTest');
      expect(() => ctxLogger.info('with meta', { key: 'value', num: 42 })).not.toThrow();
    });

    test('profile: 成功する非同期関数を計測する', async () => {
      const ctxLogger = createLogger('Profile');
      const result = await ctxLogger.profile('asyncOp', async () => {
        return 'done';
      });
      expect(result).toBe('done');
    });

    test('profile: 例外をスローする非同期関数は例外を再スロー', async () => {
      const ctxLogger = createLogger('Profile');
      await expect(
        ctxLogger.profile('failingOp', async () => {
          throw new Error('async fail');
        })
      ).rejects.toThrow('async fail');
    });

    test('profileSync: 成功する同期関数を計測する', () => {
      const ctxLogger = createLogger('ProfileSync');
      const result = ctxLogger.profileSync('syncOp', () => {
        return 42;
      });
      expect(result).toBe(42);
    });

    test('profileSync: 例外をスローする同期関数は例外を再スロー', () => {
      const ctxLogger = createLogger('ProfileSync');
      expect(() =>
        ctxLogger.profileSync('failingSyncOp', () => {
          throw new Error('sync fail');
        })
      ).toThrow('sync fail');
    });
  });
});
