import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { TasksClient, type CreateTaskInput, type UpdateTaskInput, type ListTasksFilter } from './tasks-client.js';

const client = new TasksClient();

const server = new Server(
  { name: 'tasks-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_tasks',
      description: 'List tasks from ChittyAgent Tasks, with optional filtering by status, assignee, or project.',
      inputSchema: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['open', 'in_progress', 'done', 'cancelled'],
            description: 'Filter by task status',
          },
          assignee: { type: 'string', description: 'Filter by assignee identifier' },
          project: { type: 'string', description: 'Filter by project identifier' },
          limit: { type: 'number', description: 'Maximum number of results (default: 50)' },
        },
      },
    },
    {
      name: 'get_task',
      description: 'Get full details of a specific task by ID.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Task ID' },
        },
        required: ['id'],
      },
    },
    {
      name: 'create_task',
      description: 'Create a new task in ChittyAgent Tasks.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Task title (required)' },
          description: { type: 'string', description: 'Optional detailed description' },
          status: {
            type: 'string',
            enum: ['open', 'in_progress', 'done', 'cancelled'],
            description: 'Initial status (default: open)',
          },
          priority: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
            description: 'Task priority',
          },
          assignee: { type: 'string', description: 'Assignee identifier' },
          project: { type: 'string', description: 'Project identifier' },
          due_date: { type: 'string', description: 'Due date as ISO 8601 string' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags' },
        },
        required: ['title'],
      },
    },
    {
      name: 'update_task',
      description: 'Update one or more fields on an existing task.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Task ID to update (required)' },
          title: { type: 'string' },
          description: { type: 'string' },
          status: { type: 'string', enum: ['open', 'in_progress', 'done', 'cancelled'] },
          priority: { type: 'string', enum: ['low', 'medium', 'high'] },
          assignee: { type: 'string' },
          project: { type: 'string' },
          due_date: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['id'],
      },
    },
    {
      name: 'complete_task',
      description: 'Mark a task as done. Shorthand for update_task with status: done.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Task ID to mark complete' },
        },
        required: ['id'],
      },
    },
    {
      name: 'delete_task',
      description: 'Permanently delete a task by ID.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Task ID to delete' },
        },
        required: ['id'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  const a = args as Record<string, unknown>;

  try {
    let result: unknown;

    switch (name) {
      case 'list_tasks':
        result = await client.listTasks({
          status: a['status'] as ListTasksFilter['status'],
          assignee: a['assignee'] as string | undefined,
          project: a['project'] as string | undefined,
          limit: a['limit'] as number | undefined,
        });
        break;

      case 'get_task':
        result = await client.getTask(a['id'] as string);
        break;

      case 'create_task':
        result = await client.createTask({
          title: a['title'] as string,
          description: a['description'] as string | undefined,
          status: a['status'] as CreateTaskInput['status'],
          priority: a['priority'] as CreateTaskInput['priority'],
          assignee: a['assignee'] as string | undefined,
          project: a['project'] as string | undefined,
          due_date: a['due_date'] as string | undefined,
          tags: a['tags'] as string[] | undefined,
        });
        break;

      case 'update_task':
        result = await client.updateTask(a['id'] as string, {
          title: a['title'] as string | undefined,
          description: a['description'] as string | undefined,
          status: a['status'] as UpdateTaskInput['status'],
          priority: a['priority'] as UpdateTaskInput['priority'],
          assignee: a['assignee'] as string | undefined,
          project: a['project'] as string | undefined,
          due_date: a['due_date'] as string | undefined,
          tags: a['tags'] as string[] | undefined,
        });
        break;

      case 'complete_task':
        result = await client.updateTask(a['id'] as string, { status: 'done' });
        break;

      case 'delete_task':
        await client.deleteTask(a['id'] as string);
        result = { deleted: true, id: a['id'] };
        break;

      default:
        return {
          content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text' as const, text: `Error: ${msg}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
