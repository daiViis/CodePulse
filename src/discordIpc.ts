import net from "node:net";
import { randomUUID } from "node:crypto";
import { PresenceState } from "./types";
import { truncate } from "./utils";

const DISCORD_PIPE_COUNT = 10;
const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;

export class DiscordIpcClient {
  private socket: net.Socket | null = null;
  private receiveBuffer = Buffer.alloc(0);
  private connectPromise: Promise<boolean> | null = null;
  private lastConnectAttemptAt = 0;
  private lastSentPayload: string | null = null;
  private readyResolver: ((value: boolean) => void) | null = null;
  private readyTimer: NodeJS.Timeout | null = null;
  private lastUnavailableLogAt = 0;

  constructor(private readonly clientId: string) {}

  async setPresence(presence: PresenceState): Promise<boolean> {
    const renderedPayload = JSON.stringify(presence);
    const connected = await this.ensureConnected();
    if (!connected) {
      return false;
    }

    if (this.lastSentPayload === renderedPayload) {
      return true;
    }

    const message = {
      cmd: "SET_ACTIVITY",
      args: {
        pid: process.pid,
        activity: {
          details: truncate(presence.details, 128),
          state: truncate(presence.state, 128),
          timestamps: presence.startTimestamp
            ? { start: Math.floor(presence.startTimestamp / 1000) }
            : undefined,
          instance: false
        }
      },
      nonce: randomUUID()
    };

    try {
      await this.writeFrame(OP_FRAME, message);
      this.lastSentPayload = renderedPayload;
      return true;
    } catch {
      this.resetConnection();
      return false;
    }
  }

  close(): void {
    this.resetConnection();
  }

  private async ensureConnected(): Promise<boolean> {
    if (this.socket && !this.socket.destroyed) {
      return true;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    const now = Date.now();
    if (now - this.lastConnectAttemptAt < 5000) {
      return false;
    }

    this.lastConnectAttemptAt = now;
    this.connectPromise = this.connect();

    try {
      return await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private async connect(): Promise<boolean> {
    for (let index = 0; index < DISCORD_PIPE_COUNT; index += 1) {
      const pipePath = `\\\\?\\pipe\\discord-ipc-${index}`;
      const socket = await this.connectToPipe(pipePath);
      if (!socket) {
        continue;
      }

      const ready = await this.performHandshake(socket);
      if (ready) {
        this.socket = socket;
        this.lastSentPayload = null;
        return true;
      }

      socket.destroy();
    }

    this.maybeLogUnavailable();
    return false;
  }

  private connectToPipe(pipePath: string): Promise<net.Socket | null> {
    return new Promise((resolve) => {
      const socket = net.createConnection(pipePath);
      let settled = false;

      const finalize = (value: net.Socket | null): void => {
        if (settled) {
          return;
        }

        settled = true;
        socket.removeAllListeners("connect");
        socket.removeAllListeners("error");
        resolve(value);
      };

      socket.once("connect", () => finalize(socket));
      socket.once("error", () => {
        socket.destroy();
        finalize(null);
      });

      socket.setTimeout(1500, () => {
        socket.destroy();
        finalize(null);
      });
    });
  }

  private async performHandshake(socket: net.Socket): Promise<boolean> {
    this.attachSocketHandlers(socket);

    const ready = new Promise<boolean>((resolve) => {
      this.readyResolver = resolve;
      this.readyTimer = setTimeout(() => {
        this.readyResolver = null;
        resolve(false);
      }, 3000);
    });

    try {
      await this.writeFrame(
        OP_HANDSHAKE,
        {
          v: 1,
          client_id: this.clientId
        },
        socket
      );
    } catch {
      this.cleanupReadyState();
      return false;
    }

    return ready;
  }

  private attachSocketHandlers(socket: net.Socket): void {
    socket.removeAllListeners();
    socket.setTimeout(0);

    socket.on("data", (chunk: Buffer) => {
      this.receiveBuffer = Buffer.concat([this.receiveBuffer, chunk]);
      this.flushMessages(socket);
    });

    socket.on("close", () => {
      if (this.socket === socket) {
        this.resetConnection();
      }
    });

    socket.on("error", () => {
      if (this.socket === socket) {
        this.resetConnection();
      }
    });
  }

  private flushMessages(socket: net.Socket): void {
    while (this.receiveBuffer.length >= 8) {
      const opcode = this.receiveBuffer.readInt32LE(0);
      const payloadLength = this.receiveBuffer.readInt32LE(4);

      if (this.receiveBuffer.length < 8 + payloadLength) {
        return;
      }

      const payloadBuffer = this.receiveBuffer.subarray(8, 8 + payloadLength);
      this.receiveBuffer = this.receiveBuffer.subarray(8 + payloadLength);

      let payload: unknown = null;
      if (payloadLength > 0) {
        try {
          payload = JSON.parse(payloadBuffer.toString("utf8"));
        } catch {
          payload = null;
        }
      }

      if (opcode === OP_PING) {
        void this.writeFrame(OP_PONG, payload ?? {}, socket).catch(() => {
          this.resetConnection();
        });
        continue;
      }

      if (opcode === OP_CLOSE) {
        this.resetConnection();
        return;
      }

      if (this.readyResolver) {
        if (isReadyPayload(payload)) {
          this.cleanupReadyState(true);
        } else if (isErrorPayload(payload)) {
          this.cleanupReadyState(false);
        }
      }
    }
  }

  private cleanupReadyState(value?: boolean): void {
    if (this.readyTimer) {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }

    if (this.readyResolver) {
      const resolver = this.readyResolver;
      this.readyResolver = null;
      resolver(value ?? false);
    }
  }

  private writeFrame(opcode: number, body: unknown, socketOverride?: net.Socket): Promise<void> {
    const socket = socketOverride ?? this.socket;
    if (!socket || socket.destroyed) {
      return Promise.reject(new Error("Discord IPC socket is not connected."));
    }

    const jsonPayload = JSON.stringify(body);
    const payloadBuffer = Buffer.from(jsonPayload, "utf8");
    const frame = Buffer.alloc(8 + payloadBuffer.length);
    frame.writeInt32LE(opcode, 0);
    frame.writeInt32LE(payloadBuffer.length, 4);
    payloadBuffer.copy(frame, 8);

    return new Promise((resolve, reject) => {
      socket.write(frame, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  private maybeLogUnavailable(): void {
    const now = Date.now();
    if (now - this.lastUnavailableLogAt < 60000) {
      return;
    }

    this.lastUnavailableLogAt = now;
    console.log("[discord] Discord IPC unavailable. The watcher will retry automatically.");
  }

  private resetConnection(): void {
    this.cleanupReadyState();
    this.lastSentPayload = null;
    this.receiveBuffer = Buffer.alloc(0);

    if (this.socket) {
      this.socket.removeAllListeners();
      if (!this.socket.destroyed) {
        this.socket.destroy();
      }
    }

    this.socket = null;
  }
}

function isReadyPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const maybePayload = payload as { evt?: unknown };
  return maybePayload.evt === "READY";
}

function isErrorPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const maybePayload = payload as { evt?: unknown };
  return maybePayload.evt === "ERROR";
}
