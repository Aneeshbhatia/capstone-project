const mongoose = require('mongoose');
const { randomUUID } = require('crypto');

const tokenSchema = new mongoose.Schema({
  publicCode: { type: String, required: true, unique: true, default: randomUUID },
  counterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Counter', required: true, index: true },
  tokenNumber: { type: Number, required: true },
  service: { type: String, required: true, trim: true, index: true },
  customerName: { type: String, trim: true, default: '' },
  appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', default: null },
  status: {
    type: String,
    enum: ['waiting', 'serving', 'completed', 'no_show', 'cancelled'],
    default: 'waiting',
    index: true,
  },
  createdAt: { type: Date, default: Date.now, index: true },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
}, { timestamps: true });

tokenSchema.index({ counterId:  1, createdAt: 1, tokenNumber: 1 });
tokenSchema.index({ status: 1, counterId: 1, createdAt: 1 });

module.exports = mongoose.model('Token', tokenSchema);
