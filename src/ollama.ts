/**
 * Ch1tty Ollama Integration — the intelligence layer
 *
 * Connects Ch1tty to a local Ollama model for meta-routing decisions.
 * The model evaluates requests and returns strategy recommendations:
 * which tools, which backends, which approach.
 *
 * Initially uses stock models (qwen2.5-coder, llama3.2).
 * Custom Ch1tty model will be fine-tuned on routing decisions.
 *
 * @canonical-uri chittycanon://core/services/ch1tty/ollama
 */

export interface OllamaConfig {
  baseUrl: string;     // default: http://localhost:11434
  model: string;       // default: qwen2.5-coder:3b (fast) or :7b (smart)
  timeout: number;     // default: 30000ms
}

export interface RoutingContext {
  request: string;           // what the user/agent is asking for
  availableTools: string[];  // what tools Ch1tty has
  activeBackends: string[];  // which backends are healthy
  sessionInfo?: {
    entity?: string;
    project?: string;
    workstream?: string;
    parallelSessions?: number;
  };
}

export interface RoutingDecision {
  strategy: string;         // direct, orchestrator, fan-out, queue, alchemist-first
  backend?: string;         // which backend to route to
  tool?: string;            // specific tool recommendation
  reasoning: string;        // why this strategy
  confidence: number;       // 0-1
}

const DEFAULT_CONFIG: OllamaConfig = {
  baseUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
  model: process.env.CH1TTY_MODEL || 'qwen2.5-coder:3b',
  timeout: 30000,
};

const SYSTEM_PROMPT = `You are Ch1tty's routing brain. Given a request and available tools/backends, choose the optimal strategy.

Strategies:
- "direct": Route to a specific backend tool. Fast, simple requests.
- "orchestrator": Use TY-VY-RY evaluation. When identity/trust matters.
- "fan-out": Send to multiple backends, merge results. When diverse perspectives help.
- "queue": Batch for later. Not urgent, resource-intensive.
- "alchemist-first": Unknown territory. Analyze before routing.
- "direct-connect": Recommend bypassing Ch1tty. Sensitive data, speed critical.

Respond with JSON only:
{"strategy":"...","backend":"...","tool":"...","reasoning":"...","confidence":0.0-1.0}`;

export class OllamaClient {
  private config: OllamaConfig;

  constructor(config?: Partial<OllamaConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  get isAvailable(): boolean {
    return true; // Assume available, fail gracefully on call
  }

  get modelName(): string {
    return this.config.model;
  }

  /**
   * Ask Ollama for a routing decision given the current context.
   * Falls back to deterministic routing if Ollama is unavailable.
   */
  async route(context: RoutingContext): Promise<RoutingDecision> {
    const prompt = `Request: "${context.request}"

Available tools (${context.availableTools.length}):
${context.availableTools.slice(0, 30).join(', ')}

Active backends (${context.activeBackends.length}):
${context.activeBackends.join(', ')}

${context.sessionInfo ? `Session: entity=${context.sessionInfo.entity || '?'}, project=${context.sessionInfo.project || '?'}, parallel=${context.sessionInfo.parallelSessions || 0}` : ''}

Choose the optimal routing strategy. JSON only.`;

    try {
      const response = await fetch(`${this.config.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          system: SYSTEM_PROMPT,
          prompt,
          stream: false,
          options: {
            temperature: 0.1,  // Low temp for consistent routing
            num_predict: 200,  // Short response
          },
        }),
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (!response.ok) {
        throw new Error(`Ollama ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as { response: string };
      return this.parseDecision(data.response);
    } catch (err) {
      // Ollama unavailable — fall back to deterministic routing
      return this.fallbackRoute(context);
    }
  }

  /**
   * General-purpose inference — for alchemist analysis, workstream detection, etc.
   */
  async infer(prompt: string, system?: string): Promise<string> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          system: system || 'You are Ch1tty, an intelligent middleware agent.',
          prompt,
          stream: false,
        }),
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (!response.ok) throw new Error(`Ollama ${response.status}`);
      const data = await response.json() as { response: string };
      return data.response;
    } catch {
      return '';
    }
  }

  /**
   * Health check — is Ollama responding?
   */
  async health(): Promise<{ ok: boolean; model: string; models: string[] }> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      const data = await response.json() as { models: Array<{ name: string }> };
      const models = data.models?.map((m) => m.name) || [];
      return {
        ok: true,
        model: this.config.model,
        models,
      };
    } catch {
      return { ok: false, model: this.config.model, models: [] };
    }
  }

  private parseDecision(raw: string): RoutingDecision {
    // Extract JSON from response (model might include extra text)
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        return {
          strategy: parsed.strategy || 'direct',
          backend: parsed.backend,
          tool: parsed.tool,
          reasoning: parsed.reasoning || '',
          confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
        };
      } catch { /* fall through */ }
    }

    return {
      strategy: 'direct',
      reasoning: 'Could not parse Ollama response, using direct routing',
      confidence: 0.1,
    };
  }

  private fallbackRoute(context: RoutingContext): RoutingDecision {
    // Simple deterministic routing when Ollama is down
    const request = context.request.toLowerCase();

    if (request.includes('provision') || request.includes('trust') || request.includes('identity')) {
      return { strategy: 'orchestrator', reasoning: 'Identity/trust keywords detected', confidence: 0.6 };
    }

    if (request.includes('search') || request.includes('find') || request.includes('discover')) {
      return { strategy: 'alchemist-first', reasoning: 'Discovery request', confidence: 0.5 };
    }

    return { strategy: 'direct', reasoning: 'Ollama unavailable, defaulting to direct', confidence: 0.3 };
  }
}
