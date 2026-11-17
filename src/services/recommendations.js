const Appointment = require('../models/Appointment');
const Counter = require('../models/Counter');
const Token = require('../models/Token');
const { averageServiceMinutes, estimateWait } = require('./queue-core');

const FORECAST_URL = (process.env.FORECAST_SERVICE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

async function historicalHourlyObservations(service, targetDate) {
  const targetStart = new Date(`${targetDate}T00:00:00.000Z`);
  const since = new Date(targetStart.getTime() - 30 * 86400000);
  const rows = await Token.aggregate([
    { $match: { service, createdAt: { $gte: since, $lt: targetStart } } },
    {
      $group: {
        _id: {
          day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          hour: { $hour: '$createdAt' },
        },
        count: { $sum: 1 },
      },
    },
  ]);
  const counts = new Map();
  for (const row of rows) {
    counts.set(`${row._id.day}:${row._id.hour}`, row.count);
  }

  const history = [];
  for (let daysAgo = 1; daysAgo <= 30; daysAgo += 1) {
    const observedDate = new Date(targetStart.getTime() - daysAgo * 86400000).toISOString().slice(0, 10);
    for (let hour = 0; hour < 24; hour += 1) {
      history.push({ date: observedDate, hour, count: counts.get(`${observedDate}:${hour}`) || 0 });
    }
  }
  return history;
}

async function forecastHourlyDemand(service, targetDate) {
  const history = await historicalHourlyObservations(service, targetDate);
  let response;
  try {
    response = await fetch(`${FORECAST_URL}/forecast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service,
        targetDate,
        history,
      }),
      signal: AbortSignal.timeout(3000),
    });
  } catch (error) {
    throw Object.assign(new Error('Python forecast service is unavailable'), { status: 503, cause: error });
  }
  if (!response.ok) {
    throw Object.assign(new Error(`Python forecast service returned ${response.status}`), { status: 503 });
  }
  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw Object.assign(new Error('Python forecast service returned invalid JSON'), { status: 503, cause: error });
  }
  if (!data
    || typeof data !== 'object'
    || !Array.isArray(data.forecast)
    || data.forecast.length !== 24
    || data.forecast.some((row) => !row
      || typeof row !== 'object'
      || !Number.isInteger(row.hour)
      || row.hour < 0
      || row.hour > 23
      || !Number.isFinite(row.expectedTokens)
      || row.expectedTokens < 0)
    || new Set(data.forecast.map((row) => row.hour)).size !== 24) {
    throw Object.assign(new Error('Python forecast service returned an invalid response'), { status: 503 });
  }
  return new Map(data.forecast.map((row) => [row.hour, row.expectedTokens]));
}

async function recommendSlots(service, from = new Date(), limit = 5, options = {}) {
  if (!service || !service.trim()) throw Object.assign(new Error('service is required'), { status: 400 });
  const counters = await Counter.find({
    isActive: true,
    $or: [{ services: service }, { services: { $size: 0 } }],
  }).lean();
  if (!counters.length) return [];

  const targetDate = from.toISOString().slice(0, 10);
  const historical = await forecastHourlyDemand(service, targetDate);
  const candidates = [];
  const firstSlot = new Date(from);
  firstSlot.setUTCSeconds(0, 0);
  if (options.includeFutureSlots !== false) {
    firstSlot.setUTCMinutes(Math.ceil(firstSlot.getUTCMinutes() / 30) * 30);
  }
  const slots = options.includeFutureSlots === false
    ? [firstSlot]
    : Array.from({ length: 16 }, (_, index) => addMinutes(firstSlot, index * 30));

  for (const counter of counters) {
    const average = await averageServiceMinutes(counter, service, from);
    const current = await estimateWait(counter, service, from);
    for (const slot of slots) {
      const offsetMinutes = Math.max(0, (slot - from) / 60000);
      const hourlyDemand = historical.get(slot.getUTCHours()) || 0;
      const projectedArrivals = hourlyDemand * 0.5;
      const waitMinutes = Math.max(
        0,
        Math.ceil(current.waitMinutes - offsetMinutes + (projectedArrivals * average) / counter.capacity),
      );
      candidates.push({
        counterId: counter._id.toString(),
        counterName: counter.name,
        counterCode: counter.code,
        slotAt: slot,
        waitMinutes,
        averageServiceMinutes: average,
        estimatedCrowd: Math.ceil(projectedArrivals),
      });
    }
  }

  candidates.sort((a, b) => a.waitMinutes - b.waitMinutes || a.slotAt - b.slotAt);
  const results = [];
  for (const candidate of candidates) {
    const end = addMinutes(candidate.slotAt, 30);
    const reserved = await Appointment.countDocuments({
      counterId: candidate.counterId,
      scheduledAt: { $gte: candidate.slotAt, $lt: end },
      status: { $in: ['booked', 'checked_in'] },
    });
    const counter = counters.find((item) => item._id.toString() === candidate.counterId);
    if (reserved < counter.capacity) results.push(candidate);
    if (results.length >= limit) break;
  }
  return results;
}

module.exports = { recommendSlots };
