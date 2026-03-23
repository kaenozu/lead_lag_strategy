'use strict';

/**
 * 初心者向けリスク・免責（Web / API 共通の固定コピー）
 */
const RISK_DISCLOSURE_SHORT =
  '教育・検証用ツールです。過去のシミュレーションは将来を保証しません。実弾の前にペーパー運用を推奨します。';

const RISK_DISCLOSURE_LINES = [
  '本ツールは投資助言ではありません。',
  '表示されるシグナル・バックテスト結果は参考情報であり、利益や元本の保証はありません。',
  '初心者の方は、十分なペーパー運用と損失許容額の設定のうえでご利用ください。',
  '最終的な売買判断はご自身の責任で行ってください。'
];

function riskPayload() {
  return {
    short: RISK_DISCLOSURE_SHORT,
    lines: RISK_DISCLOSURE_LINES
  };
}

module.exports = {
  RISK_DISCLOSURE_SHORT,
  RISK_DISCLOSURE_LINES,
  riskPayload
};
