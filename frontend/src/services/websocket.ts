import type { WsMessage } from '../lib/types';
import { uuid } from '../lib/uuid';

type Handler = (msg: WsMessage) => void;

class WS {
  private socket: WebSocket | null = null;
  private handlers = new Map<string, Handler[]>();
  private queue: string[] = [];
  private retries = 0;
  private dead = false;
  private kernelName = 'python3';
  private _notebookPath?: string;

  connect(kernelName?: string, notebookPath?: string) {
    if (kernelName) this.kernelName = kernelName;
    if (notebookPath !== undefined) this._notebookPath = notebookPath;
    if (this.socket?.readyState === WebSocket.OPEN) return;

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let url = `${proto}://${location.host}/api/ws?kernel=${encodeURIComponent(this.kernelName)}`;
    if (this._notebookPath) url += `&notebook=${encodeURIComponent(this._notebookPath)}`;

    this.dead = false;
    this.socket = new WebSocket(url);

    this.socket.onopen = () => {
      this.retries = 0;
      for (const msg of this.queue) this.socket!.send(msg);
      this.queue = [];
    };

    this.socket.onmessage = (ev) => {
      let msg: WsMessage;
      try { msg = JSON.parse(ev.data); } catch { return; }

      for (const fn of this.handlers.get(msg.type) ?? []) fn(msg);
      for (const fn of this.handlers.get('*') ?? []) fn(msg);
    };

    this.socket.onclose = () => {
      if (this.dead) return;
      const delay = Math.min(1000 * 2 ** this.retries, 5000);
      this.retries++;
      setTimeout(() => this.connect(), delay);
    };

    this.socket.onerror = () => {};
  }

  /// Disconnect and reconnect with a different kernel.
  reconnect(kernelName: string, notebookPath?: string) {
    this.dead = true;
    this.socket?.close();
    this.socket = null;
    this.retries = 0;
    if (notebookPath !== undefined) this._notebookPath = notebookPath;
    // small delay to let the old connection clean up
    setTimeout(() => this.connect(kernelName, this._notebookPath), 200);
  }

  send(type: string, payload: Record<string, unknown> = {}, sessionId?: string) {
    const msg: WsMessage = {
      type,
      id: uuid(),
      session_id: sessionId,
      payload,
    };
    const json = JSON.stringify(msg);

    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(json);
    } else {
      this.queue.push(json);
    }

    return msg.id;
  }

  on(type: string, fn: Handler) {
    const arr = this.handlers.get(type) ?? [];
    arr.push(fn);
    this.handlers.set(type, arr);
  }

  off(type: string, fn: Handler) {
    const arr = this.handlers.get(type);
    if (!arr) return;
    this.handlers.set(type, arr.filter(f => f !== fn));
  }

  disconnect() {
    this.dead = true;
    this.socket?.close();
  }
}

export const ws = new WS();
