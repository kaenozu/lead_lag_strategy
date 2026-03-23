const js = require('@eslint/js');

// ESLint v9 の Flat Config（eslint.config.*）用設定。
// 既存の .eslintrc.js と同等のルールを、Node + CommonJS 前提で適用する。
module.exports = [
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'results/**',
      'public/**',
      // 補助的な自動修正エージェント（本番実行パス外）
      'agents/**',
      // 旧実験スクリプト（段階的に整備予定）
      'backtest/analysis.js',
      'backtest/improved.js'
    ]
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        // CommonJS / Node globals
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        global: 'readonly',
        // Jest globals
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        jest: 'readonly',
        fail: 'readonly',
        // Browser globals (for e2e tests and fetch polyfills)
        window: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        AbortSignal: 'readonly',
        URLSearchParams: 'readonly',
        Headers: 'readonly',
        Request: 'readonly',
        Response: 'readonly'
      }
    },
    rules: {
      indent: ['error', 2],
      'linebreak-style': ['error', 'unix'],
      quotes: ['error', 'single'],
      semi: ['error', 'always'],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      'prefer-const': 'warn',
      'comma-dangle': ['error', 'never']
    }
  }
];
