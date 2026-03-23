'use strict';

(function initTimeUtils(globalObj) {
  function jstCalendarDay() {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());
  }

  function isAutoSignalWindowJst() {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Tokyo',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(new Date());
    const partMap = Object.fromEntries(parts.map(p => [p.type, p.value]));
    const weekday = partMap.weekday; // Sun ... Sat
    if (weekday === 'Sun' || weekday === 'Sat') return false;
    const hour = parseInt(partMap.hour, 10);
    const minute = parseInt(partMap.minute, 10);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;
    const minutes = hour * 60 + minute;
    return minutes >= (8 * 60 + 45) && minutes <= (8 * 60 + 55);
  }

  globalObj.timeUtils = {
    jstCalendarDay,
    isAutoSignalWindowJst
  };
})(window);

