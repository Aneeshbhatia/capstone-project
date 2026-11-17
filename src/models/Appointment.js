const mongoose = require('mongoose');
const { randomUUID } = require('crypto');

const appointmentSchema = new mongoose.Schema({
  publicCode: { type: String, required: true, unique: true, default: randomUUID },
  counterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Counter', required: true, index: true },
  service: { type: String, required: true, trim: true, index: true },
  customerName: { type: String, required: true, trim: true },
  scheduledAt: { type: Date, required: true, index: true },
  status: {
    type: String,
    enum: ['booked', 'checked_in', 'completed', 'no_show', 'cancelled'],
    default: 'booked',
    index: true,
  },
  tokenId: { type: mongoose.Schema.Types.ObjectId, ref: 'Token', default: null },
}, { timestamps: true });

appointmentSchema.index({ counterId: 1, scheduledAt: 1, status: 1 });

module.exports = mongoose.model('Appointment', appointmentSchema);
