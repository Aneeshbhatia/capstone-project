require('dotenv').config();
const http = require('http');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const createApp = require('./app');
const { setSocketServer } = require('./services/live-board');

async function start() {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required');
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const app = createApp();
  const server = http.createServer(app);
  const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim());
  const io = new Server(server, {
    cors: { origin: allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins },
  });
  setSocketServer(io);

  const port = Number(process.env.PORT) || 5000;
  server.listen(port, () => {
    console.log(`Queue API listening on port ${port}`);
  });
}

start().catch((error) => {
  console.error('Unable to start queue API:', error);
  process.exitCode = 1;
});
