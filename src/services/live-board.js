let io;

function setSocketServer(socketServer) {
  io = socketServer;
}

function publishBoardUpdate(payload) {
  if (io) io.emit('queue:updated', payload);
}

module.exports = { setSocketServer, publishBoardUpdate };
