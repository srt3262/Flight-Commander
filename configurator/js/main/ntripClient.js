import net from 'node:net';
import tls from 'node:tls';

const MAX_HEADER_BYTES = 64 * 1024;
const MAX_SOURCETABLE_BYTES = 4 * 1024 * 1024;
const CONNECT_TIMEOUT_MS = 10000;

function normalizeCasterSettings(settings = {}) {
  const host = String(settings.host ?? '').trim();
  const port = Number(settings.port ?? (settings.tls ? 443 : 2101));
  if (!host || /^[a-z][a-z0-9+.-]*:\/\//i.test(host) || /[\/\s]/.test(host)) {
    throw new Error('Enter an NTRIP caster host name without http:// or https://.');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('NTRIP caster port must be from 1 through 65535.');
  }
  return {
    host,
    port,
    tls: settings.tls === true,
    username: String(settings.username ?? ''),
    password: String(settings.password ?? ''),
  };
}

function normalizeSettings(settings = {}) {
  const config = normalizeCasterSettings(settings);
  const mountpoint = String(settings.mountpoint ?? '').trim().replace(/^\/+/, '');
  if (!mountpoint) throw new Error('Enter an NTRIP mountpoint.');
  return { ...config, mountpoint };
}

function authorizationHeader(config) {
  return config.username || config.password
    ? `Authorization: Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}\r\n`
    : '';
}

function buildRequest(config, requestPath) {
  const hostHeader = net.isIP(config.host) === 6 ? `[${config.host}]` : config.host;
  return Buffer.from(
    `GET ${requestPath} HTTP/1.1\r\n` +
    `Host: ${hostHeader}:${config.port}\r\n` +
    'Ntrip-Version: Ntrip/2.0\r\n' +
    'User-Agent: NTRIP FlightCommander/4.1.7\r\n' +
    'Accept: */*\r\n' +
    'Cache-Control: no-cache\r\n' +
    authorizationHeader(config) +
    'Connection: close\r\n\r\n',
    'ascii',
  );
}

export function buildNtripRequest(settings = {}) {
  const config = normalizeSettings(settings);
  return buildRequest(config, `/${encodeURI(config.mountpoint)}`);
}

export function buildNtripSourcetableRequest(settings = {}) {
  return buildRequest(normalizeCasterSettings(settings), '/');
}

export class NtripResponseDecoder {
  constructor(options = {}) {
    this.onHeaders = options.onHeaders ?? (() => {});
    this.onData = options.onData ?? (() => {});
    this.allowSourcetable = options.allowSourcetable === true;
    this.buffer = Buffer.alloc(0);
    this.headersComplete = false;
    this.chunked = false;
    this.chunkBytesRemaining = null;
  }

  push(value) {
    const incoming = Buffer.from(value);
    this.buffer = Buffer.concat([this.buffer, incoming]);
    if (!this.headersComplete) {
      if (this.buffer.length > MAX_HEADER_BYTES) {
        throw new Error('NTRIP response headers exceed 64 KiB.');
      }
      const boundary = this.buffer.indexOf('\r\n\r\n');
      if (boundary < 0) return;
      const headerText = this.buffer.subarray(0, boundary).toString('latin1');
      this.buffer = this.buffer.subarray(boundary + 4);
      const lines = headerText.split('\r\n');
      const statusLine = lines.shift() ?? '';
      const match = statusLine.match(/^(?:HTTP\/\d(?:\.\d)?|ICY|SOURCETABLE)\s+(\d{3})\b/i);
      if (!match) {
        throw new Error(`NTRIP caster returned an invalid status line: ${statusLine || '(empty)'}.`);
      }
      const statusCode = Number(match[1]);
      if (statusCode !== 200) {
        throw new Error(`NTRIP caster rejected the mountpoint with status ${statusCode}.`);
      }
      const headers = new Map();
      for (const line of lines) {
        const separator = line.indexOf(':');
        if (separator <= 0) continue;
        headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
      }
      if (!this.allowSourcetable && (
        /sourcetable/i.test(headers.get('content-type') ?? '') ||
        /^SOURCETABLE/i.test(statusLine)
      )) {
        throw new Error('NTRIP caster returned a sourcetable instead of the selected RTCM stream.');
      }
      this.chunked = /chunked/i.test(headers.get('transfer-encoding') ?? '');
      this.headersComplete = true;
      this.onHeaders({ statusCode, statusLine, headers, chunked: this.chunked });
    }
    this.flushBody();
  }

  flushBody() {
    if (!this.headersComplete) return;
    if (!this.chunked) {
      if (this.buffer.length) {
        const data = this.buffer;
        this.buffer = Buffer.alloc(0);
        this.onData(data);
      }
      return;
    }
    while (this.buffer.length) {
      if (this.chunkBytesRemaining == null) {
        const lineEnd = this.buffer.indexOf('\r\n');
        if (lineEnd < 0) return;
        const line = this.buffer.subarray(0, lineEnd).toString('ascii').split(';', 1)[0].trim();
        if (!/^[0-9a-f]+$/i.test(line)) throw new Error('NTRIP caster sent an invalid HTTP chunk size.');
        this.chunkBytesRemaining = Number.parseInt(line, 16);
        this.buffer = this.buffer.subarray(lineEnd + 2);
        if (this.chunkBytesRemaining === 0) {
          this.buffer = Buffer.alloc(0);
          return;
        }
      }
      if (this.buffer.length < this.chunkBytesRemaining + 2) return;
      const data = this.buffer.subarray(0, this.chunkBytesRemaining);
      const terminator = this.buffer.subarray(this.chunkBytesRemaining, this.chunkBytesRemaining + 2);
      if (terminator[0] !== 13 || terminator[1] !== 10) {
        throw new Error('NTRIP HTTP chunk is missing its CRLF terminator.');
      }
      this.buffer = this.buffer.subarray(this.chunkBytesRemaining + 2);
      this.chunkBytesRemaining = null;
      if (data.length) this.onData(data);
    }
  }
}

function socketOptions(config) {
  const connectionOptions = { host: config.host, port: config.port };
  if (!config.tls) return connectionOptions;
  return net.isIP(config.host)
    ? { ...connectionOptions, rejectUnauthorized: true }
    : { ...connectionOptions, servername: config.host, rejectUnauthorized: true };
}

export function fetchNtripSourcetable(settings = {}) {
  const config = normalizeCasterSettings(settings);
  return new Promise((resolve, reject) => {
    let settled = false;
    let headersSeen = false;
    let body = Buffer.alloc(0);
    let socket;
    let timeout;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (socket && !socket.destroyed) socket.destroy();
      if (error) reject(error);
      else resolve(body.toString('utf8'));
    };
    const decoder = new NtripResponseDecoder({
      allowSourcetable: true,
      onHeaders: () => { headersSeen = true; },
      onData: (data) => {
        body = Buffer.concat([body, data]);
        if (body.length > MAX_SOURCETABLE_BYTES) {
          finish(new Error('NTRIP sourcetable exceeds the 4 MiB safety limit.'));
          return;
        }
        if (body.includes('ENDSOURCETABLE')) finish(null);
      },
    });
    socket = config.tls
      ? tls.connect(socketOptions(config))
      : net.connect(socketOptions(config));
    timeout = setTimeout(() => {
      finish(new Error(`NTRIP sourcetable request timed out after ${CONNECT_TIMEOUT_MS} ms.`));
    }, CONNECT_TIMEOUT_MS);
    const onConnected = () => socket.write(buildNtripSourcetableRequest(config));
    if (config.tls) socket.once('secureConnect', onConnected);
    else socket.once('connect', onConnected);
    socket.on('data', (data) => {
      try {
        decoder.push(data);
      } catch (error) {
        finish(error);
      }
    });
    socket.on('error', (error) => finish(error));
    socket.on('close', () => {
      if (headersSeen && body.length) finish(null);
      else finish(new Error('NTRIP caster closed before returning a sourcetable.'));
    });
  });
}

export class NtripClient {
  constructor(options = {}) {
    this.emit = options.emit ?? (() => {});
    this.socket = null;
    this.generation = 0;
    this.connected = false;
    this.config = null;
  }

  async connect(settings = {}) {
    await this.close();
    const config = normalizeSettings(settings);
    const generation = ++this.generation;
    this.config = config;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve(value);
      };
      const decoder = new NtripResponseDecoder({
        onHeaders: (headers) => {
          if (generation !== this.generation) return;
          this.connected = true;
          this.emit('status', { connected: true, ...headers });
          finish(null, { error: false, ...headers });
        },
        onData: (data) => {
          if (generation === this.generation) this.emit('data', data);
        },
      });
      const socket = config.tls
        ? tls.connect(socketOptions(config))
        : net.connect(socketOptions(config));
      this.socket = socket;
      const timeout = setTimeout(() => {
        const error = new Error(`NTRIP connection timed out after ${CONNECT_TIMEOUT_MS} ms.`);
        socket.destroy(error);
        finish(error);
      }, CONNECT_TIMEOUT_MS);
      const onConnected = () => {
        if (generation !== this.generation) return;
        socket.write(buildNtripRequest(config));
      };
      if (config.tls) socket.once('secureConnect', onConnected);
      else socket.once('connect', onConnected);
      socket.on('data', (data) => {
        try {
          decoder.push(data);
        } catch (error) {
          this.emit('error', { error: error.message });
          socket.destroy(error);
          finish(error);
        }
      });
      socket.on('error', (error) => {
        if (generation !== this.generation) return;
        this.emit('error', { error: error.message });
        finish(error);
      });
      socket.on('close', () => {
        if (generation !== this.generation) return;
        this.socket = null;
        this.connected = false;
        this.config = null;
        this.emit('close', { connected: false });
        finish(new Error('NTRIP connection closed before the stream was established.'));
      });
    });
  }

  sendGga(sentence) {
    if (!this.socket || !this.connected) {
      return { error: true, msg: 'NTRIP stream is not connected.' };
    }
    const value = String(sentence ?? '').trim();
    if (!/^\$G[A-Z]GGA,[^\r\n]*\*[0-9A-F]{2}$/i.test(value)) {
      return { error: true, msg: 'Invalid NMEA GGA sentence.' };
    }
    this.socket.write(`${value}\r\n`);
    return { error: false, bytesWritten: value.length + 2 };
  }

  fetchSourcetable(settings = {}) {
    return fetchNtripSourcetable(settings);
  }

  async close() {
    this.generation += 1;
    const socket = this.socket;
    this.socket = null;
    this.connected = false;
    this.config = null;
    if (!socket) return { error: false };
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve({ error: false });
      };
      socket.once('close', finish);
      socket.end();
      setTimeout(() => {
        socket.destroy();
        finish();
      }, 1000).unref?.();
    });
  }
}

export default NtripClient;
