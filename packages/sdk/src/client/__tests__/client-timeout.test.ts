/**
 * `ClientConfig.timeout` bounds each call to the engine, through the real
 * native binding: a call the engine never answers fails at the timeout as a
 * `TimeoutError`, not when the connection's own three-minute limit runs out.
 */
import * as net from 'net';
import * as path from 'path';

// The binding `npm run build:native` leaves beside the crate.
process.env.ORCHER_NATIVE_MODULE = path.resolve(__dirname, '../../../native/orcher_core.node');

import { Client } from '../client';
import { TimeoutError } from '../../core/errors';

/** A server that accepts connections and never answers. */
function silentServer(): Promise<{ url: string; close: () => void }> {
  const sockets: net.Socket[] = [];
  const server = net.createServer((socket) => sockets.push(socket));
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => {
          sockets.forEach((s) => s.destroy());
          server.close();
        },
      });
    });
  });
}

describe('ClientConfig.timeout', () => {
  it('ends a call the engine does not answer at the timeout', async () => {
    const server = await silentServer();
    const client = new Client({ serverUrl: server.url, namespace: 'default', timeout: 300 });
    try {
      await client.connect();
      const started = Date.now();
      const error = await client.listWorkflows().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TimeoutError);
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      server.close();
    }
  }, 15_000);

  it('refuses a timeout that is not a positive number', async () => {
    const client = new Client({
      serverUrl: 'http://127.0.0.1:1',
      namespace: 'default',
      timeout: 0,
    });
    await expect(client.connect()).rejects.toThrow(/timeout must be a positive number/);
  });
});
