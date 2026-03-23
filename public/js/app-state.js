'use strict';

(function initAppState(globalObj) {
  let currentSignals = {};
  let currentFilter = 'all';

  function getSignals() {
    return currentSignals;
  }

  function setSignals(next) {
    currentSignals = next || {};
  }

  function getFilter() {
    return currentFilter;
  }

  function setFilter(next) {
    currentFilter = next || 'all';
  }

  globalObj.appState = {
    getSignals,
    setSignals,
    getFilter,
    setFilter
  };
})(window);

