import { createServer, type Server as HttpServer } from 'node:http';
import type { Aggregator } from './aggregator.js';
import { VERSION } from './utils.js';

export interface HealthServerOptions {
  port: number;
  bindAddress?: string;
}

export class HealthServer {
  private server: HttpServer;
  private port: number;
  private bindAddress: string;

  constructor(aggregator: Aggregator, options: HealthServerOptions) {
    this.port = options.port;
    this.bindAddress = options.bindAddress ?? '127.0.0.1';

    this.server = createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');

      if (req.method !== 'GET') {
        res.writeHead(405);
        res.end(JSON.stringify({ error: 'method not allowed' }));
        return;
      }

      switch (req.url) {
        case '/health':
          res.writeHead(200);
          res.end(JSON.stringify({ status: 'ok', service: 'ch1tty', version: VERSION }));
          break;

        case '/api/v1/status':
          try {
            const snapshot = aggregator.getStatusSnapshot();
            res.writeHead(200);
            res.end(JSON.stringify(snapshot));
          } catch {
            res.writeHead(200);
            res.end(JSON.stringify({ status: 'ok', service: 'ch1tty', version: VERSION, transport: 'stdio' }));
          }
          break;

        default:
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'not found' }));
      }
    });
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.bindAddress, () => {
        this.server.removeListener('error', reject);
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }
}
