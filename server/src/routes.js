import { Router } from 'express';
import { RoomError } from './room.js';

export function createRoutes(controller) {
  const router = Router();

  // Wrap handlers so a RoomError becomes a JSON error with the right status.
  const handle = (fn) => (req, res) => {
    try {
      const body = fn(req) ?? { success: true };
      res.status(body.__status ?? 200).json(body.__status ? { ...body, __status: undefined } : body);
    } catch (err) {
      if (err instanceof RoomError) return res.status(err.status).json({ error: err.message });
      console.error(err);
      res.status(500).json({ error: 'Something went wrong' });
    }
  };

  router.get('/health', (req, res) => res.json({ ok: true, rooms: controller.rooms.size }));

  router.post('/mp/rooms', handle((req) => ({ ...controller.createRoom(req.body?.name), __status: 201 })));
  router.post('/mp/rooms/:code/join', handle((req) => ({ ...controller.joinRoom(req.params.code, req.body?.name), __status: 201 })));

  router.get('/mp/rooms/:code', handle((req) => {
    const room = controller.get(req.params.code);
    if (!room) throw new RoomError('Room not found', 404);
    // Public lobby info only: enough to show "join this room" without being in it.
    return { code: room.code, phase: room.phase, players: room.publicPlayers().length, full: room.players.size >= 8 };
  }));

  const act = (fn) => handle((req) => fn(req.params.code, String(req.body?.playerId ?? ''), req.body ?? {}));
  router.post('/mp/rooms/:code/leave', act((c, id) => controller.leave(c, id)));
  router.post('/mp/rooms/:code/settings', act((c, id, b) => controller.updateSettings(c, id, { count: b.count, time: b.time, books: b.books })));
  router.post('/mp/rooms/:code/start', act((c, id) => controller.start(c, id)));
  router.post('/mp/rooms/:code/next', act((c, id) => controller.skipReveal(c, id)));
  router.post('/mp/rooms/:code/rematch', act((c, id) => controller.rematch(c, id)));

  return router;
}
