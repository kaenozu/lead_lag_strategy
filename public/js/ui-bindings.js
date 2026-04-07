'use strict';

(function initUiBindings(globalObj) {
  function bindMainUiHandlers(handlers) {
    const {
      renderSignals,
      fetchAndApplySignal,
      runBacktestJob
    } = handlers;

    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        window.appState.setFilter(tab.dataset.tab);
        renderSignals(window.appState.getFilter());
      });
    });

    document.getElementById('exportCsvBtn').addEventListener('click', () => {
      const currentSignals = window.appState.getSignals();
      const currentFilter = window.appState.getFilter();
      if (!currentSignals.signals || currentSignals.signals.length === 0) return;

      const signalsToExport = currentFilter === 'buy'
        ? (currentSignals.buyCandidates || [])
        : currentFilter === 'sell'
          ? (currentSignals.sellCandidates || [])
          : currentSignals.signals;

      const csv = 'Rank,Ticker,Name,Signal,PriceRef\n' +
        signalsToExport.map((s, i) => {
          const price = s.price > 0 ? s.price : '';
          return `${i + 1},${s.ticker},${s.name},${s.signal},${price}`;
        }).join('\n');

      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `signal_${currentFilter}_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });

    document.getElementById('generateSignalBtn').addEventListener('click', () => {
      fetchAndApplySignal({
        force: true,
        preferredTab: 'all',
        busyLabel: '生成中...'
      });
    });

    document.getElementById('runBacktestBtn').addEventListener('click', () => {
      runBacktestJob({ auto: false });
    });
  }

  globalObj.uiBindings = {
    bindMainUiHandlers
  };
})(window);

