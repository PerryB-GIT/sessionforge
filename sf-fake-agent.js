'use strict';
const WebSocket = require('ws');

const API_KEY = process.env.API_KEY;
const BASE_WS = 'wss://sessionforge.dev/api/ws/agent';
const MACHINE_ID = process.env.MACHINE_ID || require('crypto').randomUUID();

const ws = new WebSocket(`${BASE_WS}?key=${API_KEY}`);

ws.on('open', () => {
  process.stdout.write('MACHINE_ID=' + MACHINE_ID + '\n');
  ws.send(JSON.stringify({
    type: 'register',
    machineId: MACHINE_ID,
    name: 'E2E Test Machine',
    os: 'windows',
    hostname: 'e2e-host',
    version: '0.1.12',
    cpuModel: 'Test CPU',
    ramGb: 8
  }));
  process.stdout.write('[agent] registered\n');

  setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'heartbeat', machineId: MACHINE_ID, cpu: 5, memory: 40, disk: 50, sessionCount: 0 }));
    }
  }, 10000);
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  process.stdout.write('[agent] msg: ' + msg.type + '\n');
  if (msg.type === 'start_session') {
    process.stdout.write('[agent] START_SESSION=' + msg.sessionId + '\n');
    setTimeout(() => {
      ws.send(JSON.stringify({ type: 'session_output', sessionId: msg.sessionId, data: '\r\nC:\\Users\\Jakeb> ' }));
    }, 300);
    setTimeout(() => {
      ws.send(JSON.stringify({ type: 'session_output', sessionId: msg.sessionId, data: 'echo Hello SessionForge\r\nHello SessionForge\r\nC:\\Users\\Jakeb> ' }));
    }, 1200);
  }
  if (msg.type === 'session_input') {
    process.stdout.write('[agent] INPUT: ' + JSON.stringify(msg.data) + '\n');
    ws.send(JSON.stringify({ type: 'session_output', sessionId: msg.sessionId, data: msg.data + '\r\nC:\\Users\\Jakeb> ' }));
  }
});

ws.on('error', (e) => process.stdout.write('[agent] error: ' + e.message + '\n'));
ws.on('close', () => { process.stdout.write('[agent] closed\n'); process.exit(0); });

setTimeout(() => process.exit(0), 120000);
