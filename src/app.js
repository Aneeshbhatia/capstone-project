const cors = require('cors');
const express = require('express');
const apiRoutes = require('./routes');

function createApp() {
  const app = express();
  const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim());

  app.use(cors({
    origin: allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins,
  }));
  app.use(express.json({ limit: '1mb' }));
  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/api', apiRoutes);
  app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status
      || (error.name === 'ValidationError' ? 400 : error.code === 11000 ? 409 : 500);
    res.status(status).json({ error: status === 500 ? 'Internal server error' : error.message });
  });

  return app;
}

module.exports = createApp;
