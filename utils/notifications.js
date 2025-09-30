

/**
 * Send a push notification to a device
 * @param {string} deviceToken - FCM device token
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @returns {Promise}
 */
/**
 * Send a push notification to a device
 * @param {string} deviceToken - FCM device token
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {string} [redirectUrl] - Optional redirect URL for deep linking
 * @returns {Promise}
 */
async function sendPushNotification(deviceToken, title, body, redirectUrl) {
  if (!deviceToken) throw new Error('Missing deviceToken');
  if (!deviceToken.startsWith('ExponentPushToken')) {
    throw new Error('Only Expo push tokens are supported. FCM logic is disabled.');
  }

  // Expo push token: use Expo push API
  const message = {
    to: deviceToken,
    sound: 'default',
    title,
    body,
    data: redirectUrl ? { redirectUrl } : undefined,
  };

  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = { raw: text };
    }

    console.log(`[NOTIFICATIONS] Expo push response status=${response.status} for token=${deviceToken}`);
    console.log('[NOTIFICATIONS] Expo response body:', JSON.stringify(data));

    // Expo returns errors in different shapes; treat non-2xx as failure
    if (!response.ok) {
      throw new Error(`Expo push failed, status=${response.status}, body=${JSON.stringify(data)}`);
    }

    // If response contains errors or tickets with errors, surface them
    if (data.errors) {
      throw new Error(`Expo push errors: ${JSON.stringify(data.errors)}`);
    }

    // Success: return parsed response for caller inspection
    return data;
  } catch (err) {
    console.error('[NOTIFICATIONS] sendPushNotification error:', err.message);
    throw err;
  }
}

module.exports = { sendPushNotification };
