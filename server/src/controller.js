import { Room, RoomError, generateCode, REVEAL_MS } from './room.js';

const MAX_ROOMS = 500;
const IDLE_MS = 2 * 60 * 60 * 1000;

/**
 * Owns every live room: creates them, runs the per-question and reveal timers,
 * and broadcasts the Room's state changes over Socket.IO.
 */
export function createController(io, questions, { now = Date.now } = {}) {
  const rooms = new Map();
  const timers = new Map(); // code -> timeout handle

  const emit = (code, event, payload) => io.to(code).emit(event, payload);
  const clearTimer = (code) => {
    clearTimeout(timers.get(code));
    timers.delete(code);
  };
  const schedule = (code, ms, fn) => {
    clearTimer(code);
    timers.set(code, setTimeout(fn, Math.max(0, ms)));
  };

  function lobbyUpdate(room) {
    emit(room.code, 'lobby_update', { players: room.publicPlayers(), hostId: room.hostId, settings: room.settings, phase: room.phase });
  }

  function openQuestion(room) {
    if (room.phase === 'finished') {
      clearTimer(room.code);
      emit(room.code, 'finished', room.finalPayload());
      return;
    }
    emit(room.code, 'question', room.questionPayload());
    emit(room.code, 'answer_progress', { count: 0, total: room.connectedCount });
    schedule(room.code, room.deadline - now(), () => closeQuestion(room));
  }

  function closeQuestion(room) {
    if (room.phase !== 'question') return;
    const reveal = room.endQuestion();
    emit(room.code, 'reveal', reveal);
    schedule(room.code, REVEAL_MS, () => advance(room));
  }

  function advance(room) {
    if (room.phase !== 'reveal') return;
    room.nextQuestion();
    openQuestion(room);
  }

  const get = (code) => rooms.get(String(code ?? '').toUpperCase());
  const need = (code) => {
    const room = get(code);
    if (!room) throw new RoomError('Room not found', 404);
    return room;
  };

  return {
    rooms,
    get,

    createRoom(name) {
      if (rooms.size >= MAX_ROOMS) throw new RoomError('The server is busy, try again soon', 503);
      let code;
      for (let i = 0; i < 20; i++) {
        const c = generateCode();
        if (!rooms.has(c)) {
          code = c;
          break;
        }
      }
      if (!code) throw new RoomError('Could not create a room, try again', 503);
      const room = new Room(code, questions, { now });
      const player = room.addPlayer(name);
      rooms.set(code, room);
      return { code, playerId: player.id, name: player.name };
    },

    joinRoom(code, name) {
      const room = need(code);
      const player = room.addPlayer(name);
      lobbyUpdate(room);
      return { code: room.code, playerId: player.id, name: player.name };
    },

    /** Socket attached: mark connected and send the full state to that socket. */
    attach(socket, code, playerId) {
      const room = get(code);
      const player = room?.getPlayer(playerId);
      if (!room || !player) return { ok: false, error: 'Room not found' };
      socket.join(room.code);
      socket.data.code = room.code;
      socket.data.playerId = playerId;
      room.setConnected(playerId, true);
      lobbyUpdate(room);
      socket.emit('snapshot', room.snapshot(playerId));
      if (room.phase === 'question') emit(room.code, 'answer_progress', { count: room.answeredCount, total: room.connectedCount });
      return { ok: true };
    },

    detach(socket) {
      const { code, playerId } = socket.data;
      const room = get(code);
      if (!room || !playerId) return;
      // A refresh opens the new socket before the old one closes; only drop presence if no other socket remains.
      const others = [...(io.sockets.adapter.rooms.get(room.code) ?? [])].filter((id) => id !== socket.id && io.sockets.sockets.get(id)?.data.playerId === playerId);
      if (others.length) return;
      room.setConnected(playerId, false);
      lobbyUpdate(room);
      if (room.phase === 'question') {
        emit(room.code, 'answer_progress', { count: room.answeredCount, total: room.connectedCount });
        if (room.everyoneAnswered()) closeQuestion(room);
      }
    },

    leave(code, playerId) {
      const room = need(code);
      room.removePlayer(playerId);
      if (room.players.size === 0) {
        clearTimer(room.code);
        rooms.delete(room.code);
        return;
      }
      lobbyUpdate(room);
    },

    updateSettings(code, playerId, patch) {
      const room = need(code);
      room.updateSettings(playerId, patch);
      lobbyUpdate(room);
    },

    start(code, playerId) {
      const room = need(code);
      room.start(playerId);
      emit(room.code, 'game_started', {});
      openQuestion(room);
    },

    answer(socket, choice) {
      const room = get(socket.data.code);
      if (!room) return { ok: false };
      const res = room.submitAnswer(socket.data.playerId, choice);
      if (!res.accepted) return { ok: false };
      emit(room.code, 'answer_progress', { count: room.answeredCount, total: room.connectedCount });
      if (res.everyoneAnswered) closeQuestion(room);
      return { ok: true };
    },

    /** Host skips the reveal pause. */
    skipReveal(code, playerId) {
      const room = need(code);
      room.requireHost(playerId);
      advance(room);
    },

    rematch(code, playerId) {
      const room = need(code);
      room.rematch(playerId);
      clearTimer(room.code);
      emit(room.code, 'lobby_reset', {});
      lobbyUpdate(room);
    },

    sweep() {
      for (const [code, room] of rooms) {
        if (now() - room.touched > IDLE_MS && room.connectedCount === 0) {
          clearTimer(code);
          rooms.delete(code);
        }
      }
    },
  };
}
