'use strict';

const fs = require('fs');
const path = require('path');
const { fetch: undiciFetch } = require('undici');
const { createLogger } = require('../logger');

const logger = createLogger('Notifier');

function appendNotificationLog(payload, outputDir = './results') {
  const dir = path.resolve(outputDir);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'notifications.log');
  fs.appendFileSync(p, `${JSON.stringify(payload)}\n`, 'utf8');
}

async function sendNotification({ channel = 'log', message, level = 'info', context = {}, config }) {
  const payload = {
    at: new Date().toISOString(),
    channel,
    level,
    message,
    context
  };

  if (channel === 'log') {
    appendNotificationLog(payload, config?.data?.outputDir);
    logger.info('Notification logged', payload);
    return { ok: true, channel };
  }

  if (channel === 'webhook') {
    const url = String(config?.operations?.notificationWebhookUrl || '').trim();
    if (!url) {
      appendNotificationLog({ ...payload, note: 'webhook url missing -> logged fallback' }, config?.data?.outputDir);
      return { ok: true, channel: 'log_fallback' };
    }
    try {
      const res = await undiciFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(`Webhook HTTP ${res.status}`);
      return { ok: true, channel: 'webhook' };
    } catch (error) {
      appendNotificationLog({ ...payload, error: error.message }, config?.data?.outputDir);
      logger.warn('Webhook notification failed; logged fallback', { error: error.message });
      return { ok: true, channel: 'log_fallback' };
    }
  }

  appendNotificationLog({ ...payload, note: 'unknown channel -> logged fallback' }, config?.data?.outputDir);
  return { ok: true, channel: 'log_fallback' };
}

module.exports = {
  sendNotification
};
