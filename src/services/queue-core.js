const Token = require('../models/Token');

async function averageServiceMinutes(counter, service, at = new Date()) {
  const since = new Date(at);
  since.setDate(since.getDate() - 30);
  const [history] = await Token.aggregate([
    {
      $match: {
        counterId: counter._id,
        service,
        status: 'completed',
        startedAt: { $gte: since, $ne: null },
        completedAt: { $ne: null },
      },
    },
    { $project: { duration: { $subtract: ['$completedAt', '$startedAt'] } } },
    { $group: { _id: null, averageMs: { $avg: '$duration' } } },
  ]);
  return history && history.averageMs > 0
    ? Math.max(1, history.averageMs / 60000)
    : counter.avgServiceMinutes;
}

function calculateWait(activeTokens, average, capacity, at = new Date()) {
  const inServiceWork = activeTokens
    .filter((token) => token.status === 'serving')
    .reduce((total, token) => {
      const elapsed = token.startedAt ? (at - token.startedAt) / 60000 : 0;
      return total + Math.max(0, average - elapsed);
    }, 0);
  const waitingCount = activeTokens.filter((token) => token.status === 'waiting').length;
  return {
    waitMinutes: Math.ceil((inServiceWork + waitingCount * average) / capacity),
    waitingCount,
    servingCount: activeTokens.length - waitingCount,
  };
}

async function estimateWait(counter, service, at = new Date()) {
  const average = await averageServiceMinutes(counter, service, at);
  const startOfDay = new Date(at);
  startOfDay.setHours(0, 0, 0, 0);
  const active = await Token.find({
    counterId: counter._id,
    service,
    status: { $in: ['waiting', 'serving'] },
    createdAt: { $gte: startOfDay },
  }).select('status startedAt').lean();
  return {
    ...calculateWait(active, average, counter.capacity, at),
    averageServiceMinutes: average,
  };
}

module.exports = { averageServiceMinutes, calculateWait, estimateWait };
