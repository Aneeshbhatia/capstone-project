const express = require('express');
const mongoose = require('mongoose');
const Appointment = require('../models/Appointment');
const Counter = require('../models/Counter');
const Token = require('../models/Token');
const { createToken, estimateWait } = require('../services/queue');
const { recommendSlots } = require('../services/recommendations');
const { publishBoardUpdate } = require('../services/live-board');

const router = express.Router();
const validId = (id) => mongoose.Types.ObjectId.isValid(id);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const activeAppointmentStatuses = ['booked', 'checked_in'];

router.post('/counters', async (req, res, next) => {
  try {
    const { name, code, services, capacity, avgServiceMinutes } = req.body;
    if (!name || !code) throw fail('name and code are required');
    const counter = await Counter.create({ name, code, services, capacity, avgServiceMinutes });
    res.status(201).json(counter);
  } catch (error) {
    next(error);
  }
});

router.get('/counters', async (req, res, next) => {
  try {
    res.json(await Counter.find().sort({ name: 1 }).lean());
  } catch (error) {
    next(error);
  }
});

router.patch('/counters/:id', async (req, res, next) => {
  try {
    if (!validId(req.params.id)) throw fail('Invalid counter id');
    const allowed = ['name', 'code', 'services', 'capacity', 'avgServiceMinutes', 'isActive'];
    const updates = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
    if (!Object.keys(updates).length) throw fail('No counter fields to update');
    const counter = await Counter.findByIdAndUpdate(req.params.id, updates, {
      new: true, runValidators: true,
    });
    if (!counter) throw fail('Counter not found', 404);
    res.json(counter);
  } catch (error) {
    next(error);
  }
});

router.get('/recommendations', async (req, res, next) => {
  try {
    const from = req.query.from ? new Date(req.query.from) : new Date();
    const limit = Number(req.query.limit) || 5;
    if (!req.query.service) throw fail('service query parameter is required');
    if (Number.isNaN(from.getTime())) throw fail('from must be a valid date');
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw fail('limit must be between 1 and 50');
    res.json(await recommendSlots(req.query.service, from, limit));
  } catch (error) {
    next(error);
  }
});

router.post('/tokens', async (req, res, next) => {
  try {
    const { service, customerName, counterId } = req.body;
    if (!service || !service.trim()) throw fail('service is required');
    const token = await createToken({ service: service.trim(), customerName, counterId });
    const estimate = await estimateWait(
      await Counter.findById(token.counterId).lean(),
      token.service,
    );
    res.status(201).json({ ...token.toObject(), ...estimate });
  } catch (error) {
    next(error);
  }
});

router.get('/public/tickets/:code', async (req, res, next) => {
  try {
    const token = await Token.findOne({ publicCode: req.params.code })
      .populate('counterId', 'name code capacity')
      .lean();
    if (token) {
      const estimate = ['waiting', 'serving'].includes(token.status)
        ? await estimateWait(token.counterId, token.service)
        : null;
      res.json({
        type: 'token',
        publicCode: token.publicCode,
        tokenNumber: token.tokenNumber,
        service: token.service,
        status: token.status,
        createdAt: token.createdAt,
        counter: { name: token.counterId.name, code: token.counterId.code },
        waitMinutes: estimate ? estimate.waitMinutes : null,
      });
      return;
    }

    const appointment = await Appointment.findOne({ publicCode: req.params.code })
      .populate('counterId', 'name code')
      .lean();
    if (!appointment) throw fail('Ticket not found', 404);
    res.json({
      type: 'appointment',
      publicCode: appointment.publicCode,
      service: appointment.service,
      scheduledAt: appointment.scheduledAt,
      status: appointment.status,
      counter: { name: appointment.counterId.name, code: appointment.counterId.code },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/board', async (req, res, next) => {
  try {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const filter = {
      createdAt: { $gte: start },
      status: { $in: ['waiting', 'serving'] },
    };
    if (req.query.counterId) {
      if (!validId(req.query.counterId)) throw fail('Invalid counterId');
      filter.counterId = req.query.counterId;
    }
    const tokens = await Token.find(filter).populate('counterId', 'name code capacity')
      .sort({ createdAt: 1 }).lean();
    const board = new Map();
    for (const token of tokens) {
      const counter = token.counterId;
      if (!counter) continue;
      const key = counter._id.toString();
      if (!board.has(key)) {
        board.set(key, { counter, serving: [], waiting: [] });
      }
      board.get(key)[token.status].push(token);
    }
    res.json([...board.values()]);
  } catch (error) {
    next(error);
  }
});

router.patch('/tokens/:id/status', async (req, res, next) => {
  try {
    if (!validId(req.params.id)) throw fail('Invalid token id');
    const { status } = req.body;
    if (!['serving', 'completed', 'no_show', 'cancelled'].includes(status)) {
      throw fail('status must be serving, completed, no_show, or cancelled');
    }
    const token = await Token.findById(req.params.id);
    if (!token) throw fail('Token not found', 404);
    const transitions = {
      waiting: ['serving', 'no_show', 'cancelled'],
      serving: ['completed', 'cancelled'],
    };
    if (!transitions[token.status] || !transitions[token.status].includes(status)) {
      throw fail(`Cannot change token from ${token.status} to ${status}`, 409);
    }
    token.status = status;
    if (status === 'serving') token.startedAt = new Date();
    if (status === 'completed') token.completedAt = new Date();
    await token.save();
    if (token.appointmentId) {
      const appointmentStatus = {
        serving: 'checked_in',
        completed: 'completed',
        no_show: 'no_show',
        cancelled: 'cancelled',
      }[status];
      await Appointment.findByIdAndUpdate(token.appointmentId, {
        status: appointmentStatus,
      });
    }
    publishBoardUpdate({ type: 'token.updated', counterId: token.counterId.toString() });
    res.json(token);
  } catch (error) {
    next(error);
  }
});

router.get('/appointments', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.status) {
      if (!['booked', 'checked_in', 'completed', 'no_show', 'cancelled'].includes(req.query.status)) {
        throw fail('Invalid appointment status');
      }
      filter.status = req.query.status;
    } else {
      filter.status = { $in: activeAppointmentStatuses };
    }
    if (req.query.from || !req.query.status || req.query.status === 'booked') {
      const from = req.query.from ? new Date(req.query.from) : new Date();
      if (Number.isNaN(from.getTime())) throw fail('from must be a valid date');
      filter.scheduledAt = { $gte: from };
    }
    if (req.query.to) {
      const to = new Date(req.query.to);
      if (Number.isNaN(to.getTime())) throw fail('to must be a valid date');
      filter.scheduledAt = { ...filter.scheduledAt, $lt: to };
    }
    const limit = Number(req.query.limit) || 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw fail('limit must be between 1 and 100');
    }
    const appointments = await Appointment.find(filter)
      .populate('counterId', 'name code')
      .sort({ scheduledAt: 1 })
      .limit(limit)
      .lean();
    res.json(appointments);
  } catch (error) {
    next(error);
  }
});

router.post('/appointments', async (req, res, next) => {
  try {
    const { service, customerName, scheduledAt, counterId } = req.body;
    const date = new Date(scheduledAt);
    if (!service || !customerName || Number.isNaN(date.getTime())) {
      throw fail('service, customerName, and a valid scheduledAt are required');
    }
    if (date <= new Date()) throw fail('scheduledAt must be in the future');

    let suggestion;
    if (counterId) {
      if (!validId(counterId)) throw fail('Invalid counterId');
      const counter = await Counter.findOne({ _id: counterId, isActive: true });
      if (!counter) throw fail('Active counter not found', 404);
      if (counter.services.length && !counter.services.includes(service)) {
        throw fail('Counter does not support this service');
      }
      suggestion = { counterId: counter._id.toString(), slotAt: date };
    } else {
      const choices = await recommendSlots(service, date, 1);
      suggestion = choices[0];
      if (!suggestion) throw fail('No available counter or slot found', 409);
    }

    const selectedDate = new Date(suggestion.slotAt);
    const counter = await Counter.findById(suggestion.counterId);
    const slotEnd = new Date(selectedDate.getTime() + 30 * 60000);
    const reserved = await Appointment.countDocuments({
      counterId: counter._id,
      scheduledAt: { $gte: selectedDate, $lt: slotEnd },
      status: { $in: activeAppointmentStatuses },
    });
    if (reserved >= counter.capacity) throw fail('Selected slot is fully booked', 409);
    const appointment = await Appointment.create({
      counterId: counter._id,
      service,
      customerName,
      scheduledAt: selectedDate,
    });
    res.status(201).json(appointment);
  } catch (error) {
    next(error);
  }
});

router.post('/appointments/:id/check-in', async (req, res, next) => {
  try {
    if (!validId(req.params.id)) throw fail('Invalid appointment id');
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) throw fail('Appointment not found', 404);
    if (appointment.status !== 'booked') throw fail(`Appointment is ${appointment.status}`, 409);
    const token = await createToken({
      service: appointment.service,
      customerName: appointment.customerName,
      counterId: appointment.counterId,
      appointmentId: appointment._id,
    });
    appointment.status = 'checked_in';
    appointment.tokenId = token._id;
    await appointment.save();
    res.status(201).json({ appointment, token });
  } catch (error) {
    next(error);
  }
});

router.post('/appointments/:id/no-show', async (req, res, next) => {
  try {
    if (!validId(req.params.id)) throw fail('Invalid appointment id');
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) throw fail('Appointment not found', 404);
    if (appointment.status !== 'booked') {
      throw fail(`Appointment is ${appointment.status}`, 409);
    }
    if (appointment.scheduledAt > new Date()) {
      throw fail('An appointment cannot be marked no-show before its scheduled time', 409);
    }
    appointment.status = 'no_show';
    await appointment.save();
    if (appointment.tokenId) {
      await Token.findOneAndUpdate(
        { _id: appointment.tokenId, status: 'waiting' },
        { status: 'no_show' },
      );
    }
    publishBoardUpdate({ type: 'appointment.no_show', counterId: appointment.counterId.toString() });
    res.json(appointment);
  } catch (error) {
    next(error);
  }
});

router.get('/analytics', async (req, res, next) => {
  try {
    const to = req.query.to ? new Date(req.query.to) : new Date();
    const from = req.query.from ? new Date(req.query.from) : new Date(to.getTime() - 7 * 86400000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
      throw fail('from and to must be valid dates with from before to');
    }
    const [totals] = await Token.aggregate([
      { $match: { createdAt: { $gte: from, $lt: to } } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          noShows: { $sum: { $cond: [{ $eq: ['$status', 'no_show'] }, 1, 0] } },
          averageServiceMs: {
            $avg: {
              $cond: [
                { $and: [{ $eq: ['$status', 'completed'] }, { $ne: ['$startedAt', null] }] },
                { $subtract: ['$completedAt', '$startedAt'] },
                null,
              ],
            },
          },
        },
      },
    ]);
    const byCounter = await Token.aggregate([
      { $match: { createdAt: { $gte: from, $lt: to } } },
      {
        $group: {
          _id: '$counterId',
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          noShows: { $sum: { $cond: [{ $eq: ['$status', 'no_show'] }, 1, 0] } },
        },
      },
      { $lookup: { from: 'counters', localField: '_id', foreignField: '_id', as: 'counter' } },
      { $unwind: { path: '$counter', preserveNullAndEmptyArrays: true } },
      { $project: { counterId: '$_id', counterName: '$counter.name', total: 1, completed: 1, noShows: 1 } },
    ]);
    const hourly = await Token.aggregate([
      { $match: { createdAt: { $gte: from, $lt: to } } },
      { $group: { _id: { $hour: '$createdAt' }, tokens: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    const total = totals ? totals.total : 0;
    res.json({
      from,
      to,
      totalTokens: total,
      completedTokens: totals ? totals.completed : 0,
      noShows: totals ? totals.noShows : 0,
      noShowRate: total ? totals.noShows / total : 0,
      averageServiceMinutes: totals && totals.averageServiceMs
        ? totals.averageServiceMs / 60000
        : 0,
      byCounter,
      hourly,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
