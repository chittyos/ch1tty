// Code mode bridge. The `code` tool runs model-written TypeScript inside a
// Worker-Loader sandbox (DynamicWorkerExecutor) where each REMOTE upstream is a
// typed namespace. Instead of advertising every upstream tool on the MCP
// surface, the model writes code that calls these namespaces; calls dispatch via
// Workers RPC back to host functions that route through RemoteProxy (the same
// transport `execute` uses), so codemode and execute share one auth/circuit path.
//
// Each upstream `serverId` becomes a sandbox namespace with two methods:
//   <serverId>.execute(toolName, args) -> the upstream tool's raw result
//   <serverId>.search(query)           -> matching tool names+schemas for that server
// Plus a top-level `ch1tty` namespace:
//   ch1tty.search(query)               -> cross-server tool search
//   ch1tty.execute(namespacedTool,args)-> run any tool by serverId/toolName
import { DynamicWorkerExecutor } from '@cloudflare/codemode';
import { log } from './logger.js';
import { describeNamespaces as _describeNamespaces } from './codemode-describe.js';
import { buildFnTable, marshalResult } from './codemode-fns.js';

/** Minimal contract the bridge needs from the aggregator/DO core. */
export interface CodemodeHost {
  /** Active remote server ids the sandbox may target. */
  remoteServerIds(): string[];
  /** Run a namespaced tool (serverId/toolName) and return JSON-serializable output. */
  runTool(namespacedTool: string, args: Record<string, unknown>, sessionId?: string): Promise<unknown>;
  /** Search the registry, returning lightweight tool descriptors. */
  searchTools(query: string, server?: string): Promise<Array<{ tool: string; description: string; inputSchema: unknown }>>;
}

export interface CodemodeResult {
  result: unknown;
  error?: string;
  logs?: string[];
}

export class CodemodeBridge {
  private executor: DynamicWorkerExecutor;

  constructor(loader: unknown, timeoutMs = 60_000) {
    // globalOutbound: null → sandbox cannot fetch the internet directly; all
    // capability flows through the dispatched host functions (RemoteProxy).
    this.executor = new DynamicWorkerExecutor({
      loader: loader as ConstructorParameters<typeof DynamicWorkerExecutor>[0]['loader'],
      timeout: timeoutMs,
      globalOutbound: null,
    });
  }

  /**
   * Execute model-written code. `code` is the body of an async function with the
   * upstream namespaces in scope. Returns the resolved value, an error string,
   * or captured logs — never throws (executor contract).
   */
  async run(code: string, host: CodemodeHost, sessionId?: string): Promise<CodemodeResult> {
    const fns = buildFnTable(host, sessionId);
    try {
      const out = await this.executor.execute(code, fns);
      return marshalResult(out);
    } catch (err) {
      // Defensive — execute() is contracted not to throw, but never let a
      // bridge bug crash the DO request.
      log.error(`codemode bridge error: ${String(err)}`, 'codemode');
      return { result: null, error: String(err) };
    }
  }

  /**
   * Build the type hints / capability listing injected into the `code` tool
   * description so the model knows which namespaces exist.
   */
  static describeNamespaces(serverIds: string[]): string {
    return _describeNamespaces(serverIds);
  }
}
