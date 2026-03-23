/**
 * エラーハンドリング改善エージェント
 * 
 * 役割：
 * 1. 未処理の Promise リジェクションの適切な処理
 * 2. 詳細なエラーログ出力
 * 3. 適切な終了コードの設定
 * 
 * 使用方法：
 * node agents/fix_error_handling.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createLogger } = require('../lib/logger');

const logger = createLogger('FixErrorHandlingAgent');

// ============================================
// 修正タスク定義
// ============================================

const tasks = [
  {
    id: 'ERR-001',
    title: 'backtest_real.js のエラーハンドリング改善',
    priority: 'high',
    files: ['backtest_real.js'],
    description: '詳細なエラーログ出力と適切な終了コードの設定'
  },
  {
    id: 'ERR-002',
    title: 'backtest_improved.js のエラーハンドリング改善',
    priority: 'high',
    files: ['backtest_improved.js'],
    description: '詳細なエラーログ出力と適切な終了コードの設定'
  },
  {
    id: 'ERR-003',
    title: 'generate_signal.js のエラーハンドリング改善',
    priority: 'high',
    files: ['generate_signal.js'],
    description: '詳細なエラーログ出力と適切な終了コードの設定'
  },
  {
    id: 'ERR-004',
    title: 'paper_trading.js のエラーハンドリング改善',
    priority: 'medium',
    files: ['paper_trading.js'],
    description: '詳細なエラーログ出力と適切な終了コードの設定'
  }
];

// ============================================
// 修正関数
// ============================================

/**
 * ファイルのメイン関数エラーハンドリングを改善
 */
function fixMainErrorHandler(filePath) {
  if (!fs.existsSync(filePath)) {
    logger.warn(`ファイルが見つかりません：${filePath}`);
    return false;
  }

  let content = fs.readFileSync(filePath, 'utf8');
  const fileName = path.basename(filePath);

  // パターン 1: 単純な .catch((error) => { ... process.exit(1) })
  const simpleCatchPattern = /\.catch\(\(error\)\s*=>\s*\{[\s\S]*?logger\.error\(['"](?:Backtest|Signal|Paper trading) failed['"][\s\S]*?process\.exit\(1\)[\s\S]*?\}\)/;
  
  // パターン 2: main().catch の形式
  const mainCatchPattern = /main\(\)\.catch\(\(error\)\s*=>\s*\{[\s\S]*?process\.exit\(1\)[\s\S]*?\}\)/;

  const improvedHandler = `main().catch(error => {
  logger.error('${fileName.replace('.js', '')} failed', {
    error: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
    code: error.code || 'UNKNOWN_ERROR'
  });
  
  // エラーコードに基づいて終了コードを設定
  const exitCode = getExitCode(error);
  process.exit(exitCode);
});`;

  // 既存のエラーハンドラーを検出
  if (simpleCatchPattern.test(content) || mainCatchPattern.test(content)) {
    // メイン関数の定義を検出
    const mainFunctionPattern = /async function main\(\)\s*\{[\s\S]*?\n\}/;
    
    if (!content.includes('function getExitCode')) {
      // getExitCode 関数を追加
      const exitCodeHelper = `
/**
 * エラータイプに基づいて終了コードを決定
 * @param {Error} error - エラーオブジェクト
 * @returns {number} 終了コード
 */
function getExitCode(error) {
  // ビジネスロジックエラー（データ不足など）
  if (error.code === 'INSUFFICIENT_DATA') {
    return 2;
  }
  // ネットワークエラー
  if (error.code === 'NETWORK_ERROR' || error.code === 'ENOTFOUND') {
    return 3;
  }
  // 設定エラー
  if (error.code === 'CONFIG_ERROR') {
    return 4;
  }
  // データ処理エラー
  if (error.code === 'DATA_ERROR') {
    return 5;
  }
  // デフォルト：一般エラー
  return 1;
}
`;

      // main 関数の前に getExitCode を追加
      if (mainFunctionPattern.test(content)) {
        content = content.replace(mainFunctionPattern, (match) => {
          return exitCodeHelper + match;
        });
        logger.info(`${fileName} に getExitCode 関数を追加しました`);
      } else {
        // ファイルの先頭に追加
        content = exitCodeHelper + content;
      }
    }

    // エラーハンドラーを置換
    content = content.replace(simpleCatchPattern, improvedHandler);
    content = content.replace(mainCatchPattern, improvedHandler);

    fs.writeFileSync(filePath, content, 'utf8');
    logger.info(`${fileName} のエラーハンドリングを改善しました`);
    return true;
  } else {
    logger.warn(`${fileName} に置換対象のパターンが見つかりませんでした`);
    return false;
  }
}

/**
 * グローバルな未処理リジェクションハンドラーを追加
 */
function addGlobalRejectionHandler(filePath) {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  let content = fs.readFileSync(filePath, 'utf8');
  const fileName = path.basename(filePath);

  // 既にハンドラーがあるか確認
  if (content.includes('process.on(\'unhandledRejection\')')) {
    logger.info(`${fileName} には既に unhandledRejection ハンドラーがあります`);
    return true;
  }

  const globalHandler = `
// ============================================
// グローバルエラーハンドリング
// ============================================

/**
 * 未処理の Promise リジェクションをキャッチ
 */
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', {
    promise: promise.toString(),
    reason: reason?.message || reason,
    stack: reason?.stack,
    timestamp: new Date().toISOString()
  });
  // アプリケーションは継続するが、ログに記録
});

/**
 * 未処理の例外をキャッチ
 */
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', {
    error: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString()
  });
  // 重大なエラーの場合は終了
  process.exit(1);
});
`;

  // 'use strict' の後に追加
  if (content.includes("'use strict';")) {
    content = content.replace(
      "'use strict';",
      `'use strict';${globalHandler}`
    );
    logger.info(`${fileName} にグローバルエラーハンドラーを追加しました`);
  } else {
    // ファイルの先頭に追加
    content = globalHandler + content;
  }

  fs.writeFileSync(filePath, content, 'utf8');
  return true;
}

/**
 * エラーコード付きのログ出力を強化
 */
function enhanceErrorLogging(filePath) {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  let content = fs.readFileSync(filePath, 'utf8');
  const fileName = path.basename(filePath);

  // try-catch ブロックの logger.error を強化
  // パターン：logger.error('...', { error: error.message })
  const simpleErrorLog = /logger\.error\((['"][^'"]+['"]),\s*\{[\s\S]*?error:\s*error\.message[\s\S]*?\}\)/g;

  const enhancedLog = content.match(simpleErrorLog);
  if (enhancedLog) {
    logger.info(`${fileName} に ${enhancedLog.length} 個のエラーログ強化箇所があります`);
    // 必要に応じて個別に強化
  }

  return false; // 自動置換はリスクが高いため手動レビューを推奨
}

// ============================================
// メイン処理
// ============================================

async function main() {
  logger.info('エラーハンドリング改善エージェントを開始します');
  logger.info(`対象ディレクトリ：${__dirname}/..`);

  const files = [
    'backtest_real.js',
    'backtest_improved.js',
    'generate_signal.js',
    'paper_trading.js'
  ];

  try {
    for (const file of files) {
      const filePath = path.join(__dirname, '..', file);
      logger.info(`処理中：${file}`);

      // メインのエラーハンドラーを改善
      fixMainErrorHandler(filePath);

      // グローバルハンドラーを追加
      addGlobalRejectionHandler(filePath);

      // エラーログを強化
      enhanceErrorLogging(filePath);
    }

    logger.info('すべてのエラーハンドリング改善を完了しました');
    logger.info('次に実施すること:');
    logger.info('  1. 各スクリプトの動作を確認');
    logger.info('  2. エラー発生時のログ出力を検証');
    logger.info('  3. 終了コードが適切か確認');

  } catch (error) {
    logger.error('修正中にエラーが発生しました', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

// エージェント実行
if (require.main === module) {
  main();
}

module.exports = {
  tasks,
  fixMainErrorHandler,
  addGlobalRejectionHandler,
  enhanceErrorLogging
};
