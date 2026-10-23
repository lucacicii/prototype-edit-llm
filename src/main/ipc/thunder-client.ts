/**
 * Thunder Agent Daemon — Electron / Node.js Sidecar Client
 *
 * This client manages the lifecycle of the Rust `thunder-daemon` subprocess,
 * communicates over STDIO using line-delimited JSON (NDJSON), handles request/response
 * matching, and emits streaming token/tool events.
 */

import { ChildProcess, spawn } from 'child_process';
import { resolveThunderBinary, sidecarCacheDir } from '../agent/thunder-binaries';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

export interface ThunderClientOptions {
  /** Path to the thunder-daemon binary. If omitted, auto-detects dev/prod path. */
  binaryPath?: string;
  /** Working directory for agent workspace. */
  workspaceDir?: string;
}

export interface ModelInfo {
  id: string;
  provider: string;
  name: string;
  selection_id: string;
  available: boolean;
}

/**
 * The two approval modes the daemon actually implements.
 *
 * `ask` and `acceptEdits` are retired: `normalize_mode` folds every "less strict
 * than plan" name into `yolo`, because `plan` is the only mode with behaviour of its
 * own. Offering them in a UI would be offering a value the daemon silently rewrites.
 */
export type ThunderPermissionMode = 'plan' | 'yolo';

/** Result of AI-title generation or a manual rename (errors are structured, never thrown). */
export interface ThunderTitleResult {
  ok: boolean;
  title?: string;
  /** `not_found` | `invalid_title` | `store_error` | `no_utility_model` | `api_error` */
  errorKind?: string;
  error?: string;
}

/**
 * Fold whatever mode name is on the wire into one of the two that exist.
 *
 * The daemon already does this server-side; doing it again here keeps an older
 * daemon — or a hand-edited state file — from putting `ask` on screen.
 */
export function normalizeMode(raw: unknown): ThunderPermissionMode {
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'plan' ? 'plan' : 'yolo';
}

function titleErrorResult(err: unknown): ThunderTitleResult {
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

/**
 * Fold the daemon's title reply into one shape.
 *
 * Both title commands answer with `success: true` and carry the real verdict inside
 * `{ok, errorKind, error}` — an RPC that completed is not a title that worked, and
 * reading only `title` would report success with an empty name.
 */
function titleResult(res: any): ThunderTitleResult {
  if (!res || res.ok === false) {
    return {
      ok: false,
      errorKind: res?.errorKind,
      error: res?.error ?? 'Title could not be produced'
    };
  }
  return { ok: true, title: res.title };
}

export interface RunTaskOptions {
  taskId: string;
  prompt: string;
  sessionId?: string;
  model?: string;
  modelDescriptor?: Record<string, any>;
  thinkingLevel?: string;
  attachments?: Array<{ path?: string; data?: string; mimeType?: string; name?: string }>;
  workspaceDir?: string;
  extraWorkspaceDirs?: string[];
  /** Approval mode (plan | ask | acceptEdits | yolo). Defaults to yolo in prototype-edit-llm. */
  mode?: ThunderPermissionMode | string;
  /** Disable ask_user_question for clients that cannot answer it. */
  headless?: boolean;
  /** Callback for real-time observed events (tokens, tools, turns) */
  onEvent?: (event: any) => void;
}

export interface ModeChangedEvent {
  session_id: string;
  task_id?: string;
  mode: string;
  previous?: string;
  source: string;
}

export interface UiNoticeEvent {
  source: string;
  message: string;
  level: string;
}

export class ThunderClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private lineReader: readline.Interface | null = null;
  private pendingRequests = new Map<
    string,
    { resolve: (data: any) => void; reject: (err: any) => void }
  >();
  private activeTaskListeners = new Map<string, (event: any) => void>();
  private reqSeq = 0;
  private options: ThunderClientOptions;

  constructor(options: ThunderClientOptions = {}) {
    super();
    this.options = options;
  }

  /**
   * Start the Rust sidecar daemon process.
   */
  public start(): void {
    if (this.process) {
      return;
    }

    const binaryPath = this.options.binaryPath || this.resolveBinaryPath();
    console.log(
      `[ThunderClient] daemon binary: ${binaryPath} (exists: ${fs.existsSync(binaryPath)})`
    );
    const args: string[] = [];
    if (this.options.workspaceDir) {
      args.push('--workspace', this.options.workspaceDir);
    }

    this.process = spawn(binaryPath, args, {
      stdio: ['pipe', 'pipe', 'inherit'], // stderr is passed through to parent terminal
      env: {
        ...process.env,
      },
    });

    this.lineReader = readline.createInterface({
      input: this.process.stdout!,
      crlfDelay: Infinity,
    });

    this.lineReader.on('line', (line) => {
      this.handleLine(line);
    });

    this.process.on('exit', (code, signal) => {
      this.emit('exit', { code, signal });
      this.process = null;
      this.lineReader = null;
      // Reject any pending requests
      for (const [_, pending] of this.pendingRequests) {
        pending.reject(new Error(`Daemon exited with code ${code}`));
      }
      this.pendingRequests.clear();
      this.activeTaskListeners.clear();
    });

    this.process.on('error', (err) => {
      this.emit('error', err);
    });
  }

  /**
   * Stop the daemon process.
   */
  public stop(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
      this.lineReader = null;
    }
  }

  /**
   * Ping daemon to test connectivity.
   */
  public async ping(): Promise<{ pong: boolean; version: string }> {
    return this.sendRequest('ping', {});
  }

  /**
   * List all configured models.
   */
  public async listModels(): Promise<ModelInfo[]> {
    const res = await this.sendRequest('list_models', {});
    return res.models || [];
  }

  /**
   * List stored conversations.
   */
  public async listConversations(): Promise<any[]> {
    return this.sendRequest('list_conversations', {});
  }

  /**
   * Get details for a specific conversation.
   */
  public async getConversation(sessionId: string): Promise<any> {
    return this.sendRequest('get_conversation', { session_id: sessionId });
  }

  /**
   * Set the mode a session is judged by.
   *
   * Takes effect on the session's next run *and* on a run already in flight, at its
   * next tool call. Only the two implemented modes are ever sent.
   */
  public async setMode(
    sessionId: string,
    mode: ThunderPermissionMode
  ): Promise<{ mode: ThunderPermissionMode } | null> {
    const res = await this.sendRequest('set_mode', { session_id: sessionId, mode });
    if (!res) return null;
    return { mode: normalizeMode(res.mode ?? mode) };
  }

  /**
   * Read the mode a session is judged by.
   *
   * The hydration source for a surface that has just opened a session: the daemon
   * keeps the mode in memory per `session_id` and deliberately does not store it in
   * the conversation.
   */
  public async getPermissionState(
    sessionId: string
  ): Promise<{ mode: ThunderPermissionMode; rules: unknown[] } | null> {
    const res = await this.sendRequest('get_permission_state', { session_id: sessionId });
    if (!res?.mode) return null;
    // The wire field is `allowed_rules`; reading `rules` silently returned [].
    return { mode: normalizeMode(res.mode), rules: res.allowed_rules ?? [] };
  }

  /**
   * Cooperatively pause a running task at its next tool boundary.
   *
   * Nothing here interrupts a tool that is already executing: the daemon checks the
   * gate between turns, so the reply means "accepted", not "stopped".
   */
  public async pauseTask(taskId: string): Promise<boolean> {
    const res = await this.sendRequest('pause_task', { task_id: taskId });
    return Boolean(res?.paused);
  }

  /** Resume a paused task. */
  public async resumeTask(taskId: string): Promise<boolean> {
    const res = await this.sendRequest('resume_task', { task_id: taskId });
    return Boolean(res?.resumed);
  }

  /**
   * Drop everything queued into a running task and hand the text back.
   *
   * The queues are returned separately because they mean different things: a
   * steering message enters at the next tool boundary, a follow-up only once the run
   * has nothing else to do. The caller puts them back in the editor.
   */
  public async clearQueue(
    taskId: string
  ): Promise<{ steering: string[]; followUp: string[] } | null> {
    const res = await this.sendRequest('clear_queue', { task_id: taskId });
    if (!res) return null;
    return { steering: res.steering ?? [], followUp: res.follow_up ?? [] };
  }

  /** AI-generate a conversation title. Never throws: the reason comes back structured. */
  public async generateConversationTitle(
    sessionId: string,
    force = false
  ): Promise<ThunderTitleResult> {
    try {
      const res = await this.sendRequest('generate_title', { session_id: sessionId, force });
      return titleResult(res);
    } catch (err) {
      return titleErrorResult(err);
    }
  }

  /** Set a conversation title by hand, which also locks it against auto-renames. */
  public async setConversationTitle(sessionId: string, title: string): Promise<ThunderTitleResult> {
    try {
      const res = await this.sendRequest('set_conversation_title', {
        session_id: sessionId,
        title,
      });
      return titleResult(res);
    } catch (err) {
      return titleErrorResult(err);
    }
  }

  /**
   * Run an Agent task and stream tokens/tool events.
   */
  public async runTask(opts: RunTaskOptions): Promise<any> {
    if (opts.onEvent) {
      this.activeTaskListeners.set(opts.taskId, opts.onEvent);
    }

    return new Promise((resolve, reject) => {
      const taskDoneListener = (evt: any) => {
        if (evt.task_id === opts.taskId) {
          this.activeTaskListeners.delete(opts.taskId);
          this.off('task_completed', onCompleted);
          this.off('task_failed', onFailed);
          resolve(evt);
        }
      };

      const taskFailedListener = (evt: any) => {
        if (evt.task_id === opts.taskId) {
          this.activeTaskListeners.delete(opts.taskId);
          this.off('task_completed', onCompleted);
          this.off('task_failed', onFailed);
          reject(new Error(evt.error || 'Task failed'));
        }
      };

      const onCompleted = taskDoneListener;
      const onFailed = taskFailedListener;

      this.on('task_completed', onCompleted);
      this.on('task_failed', onFailed);

      this.sendRequest('run_task', {
        task_id: opts.taskId,
        prompt: opts.prompt,
        session_id: opts.sessionId,
        model: opts.model,
        mode: opts.mode ?? 'yolo',
        ...(opts.modelDescriptor ? { model_descriptor: opts.modelDescriptor } : {}),
        ...(opts.thinkingLevel ? { thinking_level: opts.thinkingLevel } : {}),
        ...(opts.attachments?.length ? { attachments: opts.attachments } : {}),
        ...(opts.extraWorkspaceDirs?.length ? { extra_workspace_dirs: opts.extraWorkspaceDirs } : {}),
        workspace_dir: opts.workspaceDir ?? this.options.workspaceDir,
        headless: opts.headless ?? false,
      }).catch((err) => {
        this.activeTaskListeners.delete(opts.taskId);
        this.off('task_completed', onCompleted);
        this.off('task_failed', onFailed);
        reject(err);
      });
    });
  }

  /**
   * Answer a pending `ask_user_question` raised by `thunder-daemon`.
   */
  public async answerQuestion(params: {
    questionId: string;
    answers?: Record<string, any> | any;
    cancelled?: boolean;
  }): Promise<any> {
    return this.sendRequest('answer_question', {
      question_id: params.questionId,
      answers: params.answers ?? {},
      cancelled: Boolean(params.cancelled),
    });
  }

  /**
   * Answer a pending `ui_request` dialog raised by `thunder-daemon`.
   */
  public async answerUi(params: {
    requestId: string;
    value?: string;
    confirmed?: boolean;
    cancelled?: boolean;
  }): Promise<any> {
    return this.sendRequest('answer_ui', {
      request_id: params.requestId,
      ...(params.value !== undefined ? { value: params.value } : {}),
      ...(params.confirmed !== undefined ? { confirmed: params.confirmed } : {}),
      cancelled: Boolean(params.cancelled),
    });
  }

  /**
   * Steer or queue follow-up input into an active task.
   */
  public async steerTask(params: {
    taskId: string;
    message: string;
    behavior?: 'steer' | 'follow_up';
  }): Promise<any> {
    return this.sendRequest('steer_task', {
      task_id: params.taskId,
      message: params.message,
      behavior: params.behavior ?? 'steer',
    });
  }

  /**
   * Cancel an in-progress task.
   */
  public async cancelTask(taskId: string): Promise<boolean> {
    const res = await this.sendRequest('cancel_task', { task_id: taskId });
    return res?.cancelled ?? false;
  }

  /**
   * Listen for mode_changed events pushed by the daemon.
   */
  public onModeChanged(listener: (evt: ModeChangedEvent) => void): () => void {
    this.on('mode_changed', listener);
    return () => this.off('mode_changed', listener);
  }

  /**
   * Listen for ui_notice events pushed by the daemon.
   */
  public onUiNotice(listener: (evt: UiNoticeEvent) => void): () => void {
    this.on('ui_notice', listener);
    return () => this.off('ui_notice', listener);
  }

  private sendRequest(method: string, params: Record<string, any>): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.process || !this.process.stdin?.writable) {
        return reject(new Error('Thunder daemon process is not running or stdin closed'));
      }

      const id = `req_${++this.reqSeq}_${Date.now()}`;
      this.pendingRequests.set(id, { resolve, reject });

      const payload = {
        method,
        id,
        ...params,
      };

      this.process.stdin.write(JSON.stringify(payload) + '\n', (err) => {
        if (err) {
          this.pendingRequests.delete(id);
          reject(err);
        }
      });
    });
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const msg = JSON.parse(trimmed);
      const type = msg.type;

      if (type === 'response') {
        const id = msg.id;
        if (id && this.pendingRequests.has(id)) {
          const { resolve, reject } = this.pendingRequests.get(id)!;
          this.pendingRequests.delete(id);
          if (msg.success) {
            resolve(msg.data);
          } else {
            reject(new Error(msg.error || 'Command failed'));
          }
        }
      } else if (type === 'observed_event') {
        const taskId = msg.task_id;
        const listener = this.activeTaskListeners.get(taskId);
        if (listener) {
          listener(msg.event);
        }
        this.emit('observed_event', msg);
      } else if (type === 'task_completed') {
        this.emit('task_completed', msg);
      } else if (type === 'task_failed') {
        this.emit('task_failed', msg);
      } else if (type === 'user_question') {
        this.emit('user_question', msg);
      } else if (type === 'ui_request') {
        this.emit('ui_request', msg);
      } else if (type === 'task_paused') {
        this.emit('task_paused', msg);
      } else if (type === 'task_queue_update') {
        this.emit('task_queue_update', msg);
      } else if (type === 'mode_changed') {
        this.emit('mode_changed', msg);
      } else if (type === 'ui_notice') {
        this.emit('ui_notice', msg);
      }
    } catch (e) {
      console.error('[ThunderClient] Failed to parse daemon output line:', trimmed, e);
    }
  }

  /**
   * Same resolution as the runtime sidecar (see `agent/thunder-binaries.ts`):
   * env var → packaged Resources/bin → the pinned artefact cache. No thunder
   * checkout is read, at any path.
   */
  private resolveBinaryPath(): string {
    const binName = process.platform === 'win32' ? 'thunder-daemon.exe' : 'thunder-daemon';
    return resolveThunderBinary('thunder-daemon') ?? path.join(sidecarCacheDir(), binName);
  }
}

/**
 * Process-wide singleton for the thunder daemon.
 *
 * Both the legacy `thunder-bridge` (self-debug loop) and `agent-bridge` (the
 * main run pipeline) need a client. Creating one each would spawn two daemon
 * processes fighting over the same data root, so both go through here.
 */
let sharedClient: ThunderClient | null = null

export function getSharedThunderClient(options: ThunderClientOptions = {}): ThunderClient {
  if (!sharedClient) {
    sharedClient = new ThunderClient(options)
  }
  return sharedClient
}

export function getExistingThunderClient(): ThunderClient | null {
  return sharedClient
}
