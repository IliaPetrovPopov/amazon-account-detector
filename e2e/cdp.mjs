// Minimal Chrome DevTools Protocol client on Node's built-in WebSocket (Node 22+).
const COMMAND_TIMEOUT_MS = 20_000;

export async function connectCdp(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error(`Cannot connect to ${url}`)), { once: true });
  });

  let lastId = 0;
  const pending = new Map();
  const listeners = new Map();

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id === undefined) {
      for (const listener of listeners.get(message.method) ?? []) listener(message.params, message.sessionId);
      return;
    }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timer);
    if (message.error) waiter.reject(new Error(`${waiter.method}: ${message.error.message}`));
    else waiter.resolve(message.result);
  });

  /** With a sessionId the command goes to that attached target, otherwise to the browser. */
  function send(method, params = {}, sessionId = undefined) {
    lastId += 1;
    const id = lastId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method}: no answer within ${COMMAND_TIMEOUT_MS} ms`));
      }, COMMAND_TIMEOUT_MS);
      pending.set(id, { resolve, reject, method, timer });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  function on(method, listener) {
    if (!listeners.has(method)) listeners.set(method, new Set());
    listeners.get(method).add(listener);
    return () => listeners.get(method).delete(listener);
  }

  return { send, on, close: () => socket.close() };
}
