#!/usr/bin/env tsx
/**
 * Demo / integration test script.
 *
 * Connects a WebSocket client to the relay server and issues a simple SSH
 * command, printing the output to stdout.  Requires the relay server to be
 * running first:
 *
 *   npm run dev          # or: tsx src/server.ts
 *
 * Then in another terminal:
 *
 *   npm run demo
 *
 * Environment variables:
 *   SSH_HOST      Remote host (default: localhost)
 *   SSH_PORT      Remote SSH port (default: 22)
 *   SSH_USER      Remote username (default: current $USER)
 *   SSH_KEY_PATH  Path to private key PEM file (default: ~/.ssh/id_rsa)
 *   WS_PORT       Relay server port (default: 3005)
 *   SSH_PASSWORD  Use password auth instead of key auth (optional)
 */

import { WebSocket } from "ws";
import { readFileSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";
import type { ClientMessage, ServerMessage } from "./types.js";

const WS_URL = `ws://localhost:${process.env.WS_PORT ?? 3005}`;

const SSH_HOST = process.env.SSH_HOST ?? "localhost";
const SSH_PORT = parseInt(process.env.SSH_PORT ?? "22", 10);
const SSH_USER = process.env.SSH_USER ?? process.env.USER ?? "root";
const SSH_KEY_PATH = process.env.SSH_KEY_PATH ?? resolve(homedir(), ".ssh/id_rsa");
const SSH_PASSWORD = process.env.SSH_PASSWORD;

function loadPrivateKey(): string | undefined {
  if (SSH_PASSWORD) return undefined;
  try {
    return readFileSync(SSH_KEY_PATH, "utf8");
  } catch {
    console.warn(`[demo] Could not read private key at ${SSH_KEY_PATH}; will try password auth`);
    return undefined;
  }
}

// ─── Connect ──────────────────────────────────────────────────────────────────

console.log(`[demo] Connecting to relay at ${WS_URL}`);
const ws = new WebSocket(WS_URL);

ws.on("open", () => {
  console.log("[demo] WebSocket connected to relay");

  const connectMsg: ClientMessage = {
    type: "connect",
    host: SSH_HOST,
    port: SSH_PORT,
    username: SSH_USER,
    ...(SSH_PASSWORD
      ? { password: SSH_PASSWORD }
      : { privateKey: loadPrivateKey() }),
    cols: 120,
    rows: 30,
  };

  console.log(`[demo] Requesting SSH → ${SSH_USER}@${SSH_HOST}:${SSH_PORT}`);
  send(connectMsg);
});

let sshConnected = false;
let commandSent = false;

ws.on("message", (raw) => {
  const msg: ServerMessage = JSON.parse(raw.toString());

  switch (msg.type) {
    case "connected":
      console.log(`[demo] SSH connected to ${msg.host}`);
      sshConnected = true;
      break;

    case "output": {
      // Print raw output as-is (includes ANSI codes)
      process.stdout.write(msg.data);

      // After getting the first shell prompt, send a command then quit
      if (sshConnected && !commandSent && msg.data.includes("$")) {
        commandSent = true;
        console.log("\n[demo] Shell prompt detected — sending test command");
        setTimeout(() => {
          send({ type: "input", data: "echo 'hello from claude-code-chat relay' && uname -a\r" });
          // Give it 2 seconds then disconnect
          setTimeout(() => {
            console.log("\n[demo] Done. Disconnecting.");
            send({ type: "disconnect" });
            setTimeout(() => {
              ws.close();
              process.exit(0);
            }, 500);
          }, 2000);
        }, 200);
      }
      break;
    }

    case "error":
      console.error(`[demo] Error [${msg.code}]: ${msg.message}`);
      ws.close();
      process.exit(1);

    case "closed":
      console.log(`[demo] SSH closed: ${msg.reason ?? "(no reason)"}`);
      ws.close();
      process.exit(0);

    case "pong":
      // keepalive
      break;
  }
});

ws.on("error", (err) => {
  console.error("[demo] WebSocket error:", err.message);
  console.error("[demo] Is the relay server running? (npm run dev)");
  process.exit(1);
});

ws.on("close", () => {
  console.log("[demo] WebSocket closed");
});

// ─── Helper ───────────────────────────────────────────────────────────────────

function send(msg: ClientMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// Timeout safety net
setTimeout(() => {
  console.error("[demo] Timed out after 30s");
  process.exit(1);
}, 30_000);
