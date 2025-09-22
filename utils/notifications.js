

/**
 * Send a push notification to a device
 * @param {string} deviceToken - FCM device token
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @returns {Promise}
 */
async function sendPushNotification(deviceToken, title, body) {
  if (deviceToken.startsWith('ExponentPushToken')) {
    // Expo push token: use Expo push API
    const message = {
      to: deviceToken,
      sound: 'default',
      title,
      body,
    };
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
    const data = await response.json();
    if (data.data && data.data.status === 'ok') {
      return;
    } else {
      throw new Error(data.errors ? JSON.stringify(data.errors) : 'Expo push failed');
    }
  } else {
    throw new Error('Only Expo push tokens are supported. FCM logic is disabled.');
  }
}

module.exports = { sendPushNotification };
