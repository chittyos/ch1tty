export interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'open' | 'in_progress' | 'done' | 'cancelled';
  priority?: 'low' | 'medium' | 'high';
  assignee?: string;
  project?: string;
  due_date?: string;
  tags?: string[];
  created_at: string;
  updated_at: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  status?: Task['status'];
  priority?: Task['priority'];
  assignee?: string;
  project?: string;
  due_date?: string;
  tags?: string[];
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: Task['status'];
  priority?: Task['priority'];
  assignee?: string;
  project?: string;
  due_date?: string;
  tags?: string[];
}

export interface ListTasksFilter {
  status?: Task['status'];
  assignee?: string;
  project?: string;
  limit?: number;
}

export class TasksClient {
  private baseUrl: string;
  private token: string | undefined;

  constructor(baseUrl?: string, token?: string) {
    this.baseUrl = (baseUrl ?? process.env['CHITTY_TASKS_URL'] ?? 'https://tasks.chitty.cc').replace(/\/$/, '');
    this.token = token ?? process.env['CHITTY_TASKS_TOKEN'];
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`tasks API ${method} ${path} → ${res.status}: ${text}`);
    }
    if (res.status === 204) return undefined as unknown as T;
    return res.json() as Promise<T>;
  }

  listTasks(filter?: ListTasksFilter): Promise<Task[]> {
    const params = new URLSearchParams();
    if (filter?.status) params.set('status', filter.status);
    if (filter?.assignee) params.set('assignee', filter.assignee);
    if (filter?.project) params.set('project', filter.project);
    if (filter?.limit !== undefined) params.set('limit', String(filter.limit));
    const qs = params.toString();
    return this.request<Task[]>('GET', `/api/tasks${qs ? `?${qs}` : ''}`);
  }

  getTask(id: string): Promise<Task> {
    return this.request<Task>('GET', `/api/tasks/${encodeURIComponent(id)}`);
  }

  createTask(input: CreateTaskInput): Promise<Task> {
    return this.request<Task>('POST', '/api/tasks', input);
  }

  updateTask(id: string, input: UpdateTaskInput): Promise<Task> {
    return this.request<Task>('PATCH', `/api/tasks/${encodeURIComponent(id)}`, input);
  }

  deleteTask(id: string): Promise<void> {
    return this.request<void>('DELETE', `/api/tasks/${encodeURIComponent(id)}`);
  }
}
