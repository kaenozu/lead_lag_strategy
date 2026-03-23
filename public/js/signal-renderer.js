'use strict';

(function initSignalRenderer(globalObj) {
  function renderTodaySummary(currentSignals) {
    const el = document.getElementById('todaySummary');
    if (!el || !currentSignals.buyCandidates) {
      if (el) el.style.display = 'none';
      return;
    }
    const fmt = (arr) => arr.map(s => `<strong>${s.ticker}</strong>（${s.name}）`).join('、');
    const buys = currentSignals.buyCandidates || [];
    const sells = currentSignals.sellCandidates || [];
    el.innerHTML = `
                <div class="summary-date">データの基準日: ${currentSignals.latestDate || '--'}（次に市場が開く日の朝〜始まり直後の判断に使います）</div>
                <div class="summary-row summary-buy">
                    <span class="summary-label">買い候補（強いと出ている業種のファンド）</span>
                    <p class="summary-list">${buys.length ? fmt(buys) : '—'}</p>
                </div>
                <div class="summary-row summary-sell">
                    <span class="summary-label">売り候補（弱いと出ている業種・現物なら買わないことが多い）</span>
                    <p class="summary-list">${sells.length ? fmt(sells) : '—'}</p>
                </div>
            `;
    el.style.display = 'block';
  }

  function renderSignals(currentSignals, filter) {
    const contentEl = document.getElementById('signalContent');
    if (!currentSignals.signals) {
      contentEl.innerHTML = `
                    <div class="loading">
                        <p>一覧がありません。左の「シグナル生成」で取得してください。</p>
                    </div>
                `;
      return;
    }

    renderTodaySummary(currentSignals);

    let signals = [...currentSignals.signals];
    if (filter === 'buy') {
      signals = currentSignals.buyCandidates || [];
    } else if (filter === 'sell') {
      signals = currentSignals.sellCandidates || [];
    }

    const total = currentSignals.signals.length;
    const buyCount = currentSignals.buyCandidates?.length || 0;
    const sellCount = currentSignals.sellCandidates?.length || 0;

    let html = `
                <div style="margin-bottom: 15px; font-size: 14px; color: #666;">
                    全 ${total} 銘柄 | 買い候補 ${buyCount} | 売り候補 ${sellCount} | 基準日 ${currentSignals.latestDate || '--'}
                </div>
                <table class="signal-table">
                    <thead>
                        <tr>
                            <th>ランク</th>
                            <th>ティッカー</th>
                            <th>業種</th>
                            <th>強さの目安</th>
                            <th>参考の値段</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

    signals.forEach(s => {
      const rankClass = s.rank <= buyCount ? 'top' : s.rank > total - sellCount ? 'bottom' : 'middle';
      const signalClass = s.signal > 0 ? 'positive' : 'negative';
      const signalIcon = s.signal > 0 ? '📈' : s.signal < 0 ? '📉' : '➖';
      const priceCell = s.price > 0 ? s.priceFormatted : '—';
      html += `
                    <tr>
                        <td><span class="rank-badge ${rankClass}">${s.rank}</span></td>
                        <td style="font-weight: bold;">${s.ticker}</td>
                        <td>${s.name}</td>
                        <td class="signal-value ${signalClass}">${signalIcon} ${(s.signal * 1000).toFixed(2)}</td>
                        <td style="font-size: 12px; color: #666;">${priceCell}</td>
                    </tr>
                `;
    });

    html += '</tbody></table>';
    contentEl.innerHTML = html;
  }

  globalObj.signalRenderer = {
    renderTodaySummary,
    renderSignals
  };
})(window);

