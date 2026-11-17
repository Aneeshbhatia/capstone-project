const mongoose = require('mongoose');

const tokenSequenceSchema = new mongoose.Schema({
  counterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Counter', required: true },
  day: { type: String, required: true },
  value: { type: Number, default: 0 },
});

tokenSequenceSchema.index({ counterId: 1, day: 1 }, { unique: true });

module.exports = mongoose.model('TokenSequence', tokenSequenceSchema);
