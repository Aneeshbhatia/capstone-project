const Counter = require('../models/Counter');
const Token = require('../models/Token');
const TokenSequence = require('../models/TokenSequence');
const { publishBoardUpdate } = require('./live-board');
const { averageServiceMinutes, estimateWait } = require('./queue-core');

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

async function createToken({ service, customerName = '', counterId, appointmentId = null }) {
  const now = new Date();
  let counter;
  if (counterId) {
    counter = await Counter.findOne({ _id: counterId, isActive: true });
    if (!counter) throw Object.assign(new Error('Active counter not found'), { status: 404 });
    if (counter.services.length && !counter.services.includes(service)) {
      throw Object.assign(new Error('Counter does not support this service'), { status: 400 });
    }
  } else {
    const choices = await Counter.find({
      isActive: true,
      $or: [{ services: service }, { services: { $size: 0 } }],
    }).lean();
    if (!choices.length) throw Object.assign(new Error('No active counter supports this service'), { status: 409 });
    const queueLoads = await Promise.all(choices.map(async (candidate) => ({
      candidate,
      waitMinutes: (await estimateWait(candidate, service, now)).waitMinutes,
    })));
    queueLoads.sort((a, b) => a.waitMinutes - b.waitMinutes);
    counter = queueLoads[0].candidate;
  }

  const sequenceQuery = { counterId: counter._id, day: dayKey(now) };
  let sequence;
  try {
    sequence = await TokenSequence.findOneAndUpdate(
      sequenceQuery,
      { $inc: { value: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
    sequence = await TokenSequence.findOneAndUpdate(
      sequenceQuery,
      { $inc: { value: 1 } },
      { new: true },
    );
  }
  const token = await Token.create({
    counterId: counter._id,
    tokenNumber: sequence.value,
    service,
    customerName,
    appointmentId,
  });

  publishBoardUpdate({ type: 'token.created', counterId: counter._id.toString() });
  return token;
}

module.exports = { createToken, estimateWait };
