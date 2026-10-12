import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import { loadQuestions } from './questions.js';
import { createController } from './controller.js';
import { createRoutes } from './routes.js';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '4kb' }));

  const httpServer = createServer(app);
  const io = new Server(httpServer, { cors: { origin: '*' } });
  const controller = createController(io, loadQuestions());

  app.use('/api', createRoutes(controller));

  io.on('connection', (socket) => {
    socket.on('join_room', ({ code, playerId } = {}, ack) => {
      const res = controller.attach(socket, code, playerId);
      if (typeof ack === 'function') ack(res);
    });
    socket.on('answer', ({ choice } = {}, ack) => {
      const res = controller.answer(socket, choice);
      if (typeof ack === 'function') ack(res);
    });
    socket.on('disconnect', () => controller.detach(socket));
  });

  // In production the client is built into dist/ and served from this same service
  // (one origin, no CORS needed), like Dinner Tinder.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dist = path.join(here, '..', '..', 'dist');
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  const sweeper = setInterval(() => controller.sweep(), 10 * 60 * 1000);
  sweeper.unref();
  return { app, httpServer, io, controller };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { httpServer } = createApp();
  const PORT = process.env.PORT || 4000;
  httpServer.listen(PORT, () => console.log(`Trivia server listening on http://localhost:${PORT}`));
}
