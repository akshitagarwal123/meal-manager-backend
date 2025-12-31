const dayjs = require('dayjs');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(timezone);

/**
 * Checks if a meal is over for a given date and meal type (IST timezone)
 * @param {string} mealType - breakfast, lunch, or dinner
 * @param {string} date - YYYY-MM-DD
 * @param {string} endTime - HH:mm (24-hour, IST)
 * @returns {boolean}
 */
function isMealOver(mealType, date, endTime) {
  if (!endTime) return false;
  const mealEnd = dayjs.tz(`${date} ${endTime}`, 'Asia/Kolkata');
  const now = dayjs().tz('Asia/Kolkata');
  return now.isAfter(mealEnd);
}

module.exports = { isMealOver };
