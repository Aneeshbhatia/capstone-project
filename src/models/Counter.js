const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true, uppercase: true, unique: true },
  services: { type: [String], default: [], set: (values) => values.map((value) => value.trim()) },
  capacity: { type: Number, min: 1, default: 1 },
  avgServiceMinutes: { type: Number, min: 1, default: 10 },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('Counter', counterSchema);
