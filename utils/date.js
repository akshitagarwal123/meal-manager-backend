// Utility to get current date in Asia/Kolkata timezone as YYYY-MM-DD
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

function getISTDateString() {
    return dayjs().tz('Asia/Kolkata').format('YYYY-MM-DD');
}

module.exports = { getISTDateString };
