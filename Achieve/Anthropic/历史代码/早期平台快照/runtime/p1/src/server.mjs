import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { P1Core, P1Error } from './core.mjs';
import { ensureSampleData, scenarioCatalog } from './scenarios.mjs';

const maxJsonBodyBytes = 1024 * 1024;
const jsonContentType = 'application/json; charset=utf-8';

function validationError(message, details = {}) {
  return new P1Error(400, 'VALIDATION_ERROR', message, details);
}

function actorRequired(message = 'A named known actor is required', details = {}) {
  return new P1Error(401, 'ACTOR_REQUIRED', message, details);
}

function authorityDenied(message, details = {}) {
  return new P1Error(403, 'AUTHORITY_DENIED', message, details);
}

function routeNotFound(pathname) {
  return new P1Error(404, 'WORK_NOT_FOUND', 'Route or Work not found', { path: pathname });
}

function projectionUnavailable(details = {}) {
  return new P1Error(503, 'PROJECTION_UNAVAILABLE', 'WorkProjection is unavailable and must not fall back to fixture data', details);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sendJson(response, statusCode, body) {
  if (response.headersSent) {
    response.end();
    return;
  }
  response.writeHead(statusCode, { 'Content-Type': jsonContentType });
  response.end(JSON.stringify(body));
}

function sendP1Error(response, error) {
  if (error instanceof P1Error) {
    sendJson(response, error.statusCode, {
      error: { code: error.code, message: error.message, details: error.details ?? {} },
    });
    return;
  }
  sendJson(response, 503, {
    error: {
      code: 'PROJECTION_UNAVAILABLE',
      message: 'WorkProjection is unavailable and must not fall back to fixture data',
      details: {},
    },
  });
}

async function readJsonBody(request) {
  const contentType = request.headers['content-type'];
  if (typeof contentType !== 'string' || !/^application\/json(?:\s*;|$)/i.test(contentType.trim())) {
    throw validationError('Content-Type must be application/json', { field: 'Content-Type' });
  }

  const chunks = [];
  let byteLength = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    byteLength += chunk.byteLength;
    if (byteLength > maxJsonBodyBytes) {
      tooLarge = true;
      chunks.length = 0;
      continue;
    }
    chunks.push(Buffer.from(chunk));
  }
  if (tooLarge) {
    throw validationError(`JSON body must be at most ${maxJsonBodyBytes} bytes`, { limitBytes: maxJsonBodyBytes });
  }

  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw validationError('JSON body is invalid', { field: 'body' });
  }
  if (!isPlainObject(parsed)) throw validationError('JSON body must be an object', { field: 'body' });
  return parsed;
}

function requestActor(request) {
  const actorId = request.headers['x-actor-id'];
  if (typeof actorId !== 'string' || actorId.length < 1 || actorId.length > 128) {
    throw actorRequired('X-Actor-Id is required');
  }
  return actorId;
}

function pathSegments(request) {
  let pathname;
  try {
    pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  } catch {
    throw routeNotFound('/');
  }
  try {
    return pathname.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    throw validationError('URL path encoding is invalid', { path: pathname });
  }
}

function storageReadable(core) {
  if (core.closed || !core.db) return false;
  try {
    return core.db.prepare('SELECT 1 AS readable').get()?.readable === 1;
  } catch {
    return false;
  }
}

export function createP1HttpApp({ dbPath, seedSamples = true } = {}) {
  if (typeof dbPath !== 'string' || dbPath.length < 1) {
    throw validationError('dbPath is required', { field: 'dbPath' });
  }
  const core = new P1Core({ dbPath });
  if (seedSamples) ensureSampleData(core);

  async function handle(request, response) {
    try {
      const segments = pathSegments(request);
      const method = request.method ?? '';

      if (method === 'GET' && segments.length === 1 && segments[0] === 'health') {
        if (!storageReadable(core)) throw projectionUnavailable({ reason: 'storage is not readable' });
        sendJson(response, 200, { status: 'ok', storage: 'readable' });
        return;
      }

      if (method === 'GET' && segments.length === 3 && segments[0] === 'api' && segments[1] === 'v1' && segments[2] === 'scenarios') {
        sendJson(response, 200, scenarioCatalog);
        return;
      }

      const isWorkRoot = segments.length === 5 && segments[0] === 'api' && segments[1] === 'v1' &&
        segments[2] === 'workspaces' && segments[4] === 'works';
      const isProjection = segments.length === 7 && segments[0] === 'api' && segments[1] === 'v1' &&
        segments[2] === 'workspaces' && segments[4] === 'works' && segments[6] === 'projection';
      const isCommand = segments.length === 7 && segments[0] === 'api' && segments[1] === 'v1' &&
        segments[2] === 'workspaces' && segments[4] === 'works' && segments[6] === 'commands';

      if (method === 'GET' && isWorkRoot) {
        const query = new URL(request.url ?? '/', 'http://127.0.0.1').searchParams;
        const options = {};
        const scenarioId = query.get('scenarioId');
        if (scenarioId !== null) options.scenarioId = scenarioId;
        sendJson(response, 200, core.listWorks(segments[3], options));
        return;
      }

      if (method === 'GET' && isProjection) {
        sendJson(response, 200, core.getProjection(segments[3], segments[5]));
        return;
      }

      if (method === 'POST' && isWorkRoot) {
        const actorId = requestActor(request);
        const body = await readJsonBody(request);
        if (body.workspaceId !== segments[3]) {
          throw validationError('body.workspaceId must match the workspace path', {
            field: 'workspaceId',
          });
        }
        const knownActor = Array.isArray(body.actors) && body.actors.some((actor) =>
          isPlainObject(actor) && actor.id === actorId);
        if (body.currentActorId !== actorId || !knownActor) {
          throw authorityDenied('X-Actor-Id must equal currentActorId and identify a known actor', {
            actorId,
          });
        }
        const projection = core.createWork(body);
        sendJson(response, 201, {
          accepted: true,
          eventIds: [projection.activities[0].id],
          projection,
        });
        return;
      }

      if (method === 'POST' && isCommand) {
        const actorId = requestActor(request);
        const command = await readJsonBody(request);
        const result = core.executeCommand({
          workspaceId: segments[3],
          workId: segments[5],
          actorId,
          command,
        });
        sendJson(response, result.statusCode, result.body);
        return;
      }

      throw routeNotFound(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
    } catch (error) {
      sendP1Error(response, error);
    }
  }

  const server = createServer((request, response) => {
    void handle(request, response);
  });
  let closePromise;
  const close = async () => {
    if (!closePromise) {
      closePromise = (async () => {
        try {
          if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
          await new Promise((resolve, reject) => {
            server.close((error) => {
              if (error) reject(error);
              else resolve();
            });
          });
        } finally {
          core.close();
        }
      })();
    }
    await closePromise;
  };

  return { server, core, close };
}

async function runCli() {
  const args = process.argv.slice(2);
  let port = 4179;
  let dbPath = fileURLToPath(new URL('../data/p1.sqlite', import.meta.url));
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--port') {
      index += 1;
      const parsed = Number(args[index]);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error('--port must be an integer from 1..65535');
      port = parsed;
    } else if (args[index] === '--db') {
      index += 1;
      if (typeof args[index] !== 'string' || args[index].length === 0) throw new Error('--db requires a path');
      dbPath = args[index];
    } else {
      throw new Error(`Unknown CLI argument: ${args[index]}`);
    }
  }

  const app = createP1HttpApp({ dbPath, seedSamples: true });
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(port, '127.0.0.1', () => {
      app.server.off('error', reject);
      resolve();
    });
  });
  process.stdout.write(`P1 HTTP listening on http://127.0.0.1:${port}\n`);

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await app.close();
    } catch (error) {
      process.stderr.write(`${signal} shutdown error: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  };
  process.once('SIGINT', () => {
    void shutdown('SIGINT').then(() => process.exit(process.exitCode ?? 0));
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM').then(() => process.exit(process.exitCode ?? 0));
  });
}

const invokedDirectly = process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
