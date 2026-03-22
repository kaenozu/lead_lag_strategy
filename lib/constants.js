/**
 * 定数定義（単一ソース）
 *  티ッカーリスト、セクターラベル、ETF名称を一元管理
 */

'use strict';

const US_ETF_TICKERS = [
    'XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLRE', 'XLU', 'XLV', 'XLY',
];

const JP_ETF_TICKERS = [
    '1617.T', '1618.T', '1619.T', '1620.T', '1621.T', '1622.T', '1623.T',
    '1624.T', '1625.T', '1626.T', '1627.T', '1628.T', '1629.T', '1630.T',
    '1631.T', '1632.T', '1633.T',
];

const JP_ETF_NAMES = {
    '1617.T': '食品',
    '1618.T': 'エネルギー資源',
    '1619.T': '建設・資材',
    '1620.T': '素材・化学',
    '1621.T': '医薬品',
    '1622.T': '自動車・輸送機',
    '1623.T': '鉄鋼・非鉄',
    '1624.T': '機械',
    '1625.T': '電機・精密',
    '1626.T': '情報通信',
    '1627.T': '電力・ガス',
    '1628.T': '運輸・物流',
    '1629.T': '商社・卸売',
    '1630.T': '小売',
    '1631.T': '銀行',
    '1632.T': '証券・商品',
    '1633.T': '保険',
};

const SECTOR_LABELS = {
    'US_XLB': 'cyclical',
    'US_XLE': 'cyclical',
    'US_XLF': 'cyclical',
    'US_XLRE': 'cyclical',
    'US_XLK': 'defensive',
    'US_XLP': 'defensive',
    'US_XLU': 'defensive',
    'US_XLV': 'defensive',
    'US_XLI': 'neutral',
    'US_XLC': 'neutral',
    'US_XLY': 'neutral',
    'JP_1617.T': 'defensive',
    'JP_1618.T': 'cyclical',
    'JP_1619.T': 'neutral',
    'JP_1620.T': 'neutral',
    'JP_1621.T': 'defensive',
    'JP_1622.T': 'neutral',
    'JP_1623.T': 'neutral',
    'JP_1624.T': 'neutral',
    'JP_1625.T': 'cyclical',
    'JP_1626.T': 'neutral',
    'JP_1627.T': 'defensive',
    'JP_1628.T': 'neutral',
    'JP_1629.T': 'cyclical',
    'JP_1630.T': 'defensive',
    'JP_1631.T': 'cyclical',
    'JP_1632.T': 'neutral',
    'JP_1633.T': 'neutral',
};

module.exports = {
    US_ETF_TICKERS,
    JP_ETF_TICKERS,
    JP_ETF_NAMES,
    SECTOR_LABELS,
};
