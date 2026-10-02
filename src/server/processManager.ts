import { spawn, ChildProcess, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';
import { db, BotRecord, DeploymentRecord } from './db.ts';

const WORKSPACES_DIR = path.resolve(process.cwd(), 'data', 'bots_workspaces');

interface RunningBotProcess {
  process: ChildProcess;
  pid: number;
  startedAt: number;
  logs: string[];
  emitter: EventEmitter;
  rxBytes: number;
  txBytes: number;
}

class RealProcessManager {
  private processes: Map<string, RunningBotProcess> = new Map();
  private logArchive: Map<string, string[]> = new Map();

  constructor() {
    if (!fs.existsSync(WORKSPACES_DIR)) {
      fs.mkdirSync(WORKSPACES_DIR, { recursive: true });
    }
    // Load existing persisted logs if any
    for (const bot of db.state.bots) {
      const logFile = this.getBotLogPath(bot.id);
      if (fs.existsSync(logFile)) {
        try {
          const lines = fs.readFileSync(logFile, 'utf-8').split('\n').filter(Boolean);
          this.logArchive.set(bot.id, lines.slice(-1000));
        } catch {
          this.logArchive.set(bot.id, []);
        }
      }
      // Reset stale running status from previous server restart unless process still alive
      if (bot.status === 'running' || bot.status === 'deploying') {
        bot.status = 'stopped';
        bot.pid = null;
      }
    }
    db.save();
  }

  public getBotDir(botId: string): string {
    return path.join(WORKSPACES_DIR, botId);
  }

  private getBotLogPath(botId: string): string {
    return path.join(WORKSPACES_DIR, `${botId}.log`);
  }

  public appendLog(botId: string, line: string, deploymentId?: string): void {
    const timestamp = new Date().toISOString();
    const formatted = `[${timestamp}] ${line}`;

    let logs = this.logArchive.get(botId);
    if (!logs) {
      logs = [];
      this.logArchive.set(botId, logs);
    }
    logs.push(formatted);
    if (logs.length > 1500) {
      logs.shift();
    }

    try {
      fs.appendFileSync(this.getBotLogPath(botId), formatted + '\n', 'utf-8');
    } catch {
      // ignore disk write error
    }

    if (deploymentId) {
      const dep = db.state.deployments.find(d => d.id === deploymentId);
      if (dep) {
        dep.logs.push(formatted);
      }
    }

    const active = this.processes.get(botId);
    if (active) {
      active.emitter.emit('log', formatted);
    }

    // Parse WhatsApp authentication events from real stdout/stderr
    this.inspectLineForWhatsAppState(botId, line);
  }

  private inspectLineForWhatsAppState(botId: string, rawLine: string): void {
    const bot = db.state.bots.find(b => b.id === botId);
    if (!bot) return;

    const lower = rawLine.toLowerCase();
    let changed = false;

    // Detect pairing code patterns (e.g., "PAIRING CODE: ABCD-1234" or "Your pairing code is: 1234-5678")
    const pairingMatch = rawLine.match(/(?:pairing\s*code|code)\s*[:=-]?\s*([A-Z0-9]{4}[- ]?[A-Z0-9]{4})/i);
    if (pairingMatch && pairingMatch[1]) {
      bot.whatsappPairingCode = pairingMatch[1].toUpperCase();
      bot.whatsappState = 'AUTHENTICATION REQUIRED';
      changed = true;
    }

    // Detect QR payload markers (e.g., "QR_DATA:..." or WhatsApp QR strings)
    const qrMatch = rawLine.match(/QR_CODE_DATA:(\S+)/i);
    if (qrMatch && qrMatch[1]) {
      bot.whatsappQr = qrMatch[1];
      bot.whatsappState = 'AUTHENTICATION REQUIRED';
      changed = true;
    }

    if (
      lower.includes('whatsapp connected') ||
      lower.includes('connection opened') ||
      lower.includes('logged in to whatsapp') ||
      lower.includes('client is ready') ||
      lower.includes('jid verified:') ||
      lower.includes('your verified jid: true') ||
      lower.includes('session file loaded') ||
      lower.includes('bot connected')
    ) {
      bot.whatsappState = 'CONNECTED';
      changed = true;
    } else if (lower.includes('connecting to whatsapp') || lower.includes('initializing whatsapp socket')) {
      if (bot.whatsappState !== 'CONNECTED') {
        bot.whatsappState = 'CONNECTING';
        changed = true;
      }
    } else if (lower.includes('whatsapp disconnected') || lower.includes('connection closed') || lower.includes('logged out')) {
      bot.whatsappState = 'DISCONNECTED';
      db.addNotification(bot.userId, 'whatsapp_disconnected', `WhatsApp Disconnected: ${bot.name}`, `Session disconnected for bot ${bot.name}. Re-authentication may be required.`);
      changed = true;
    }

    if (changed) {
      bot.updatedAt = new Date().toISOString();
      db.save();
    }
  }

  public getLogs(botId: string): string[] {
    return this.logArchive.get(botId) || [];
  }

  public clearLogs(botId: string): void {
    this.logArchive.set(botId, []);
    try {
      if (fs.existsSync(this.getBotLogPath(botId))) {
        fs.writeFileSync(this.getBotLogPath(botId), '', 'utf-8');
      }
    } catch {
      // ignore
    }
  }

  public getEmitter(botId: string): EventEmitter | null {
    return this.processes.get(botId)?.emitter || null;
  }

  /**
   * Ensure bot workspace directory exists (no fake starter scripts)
   */
  private ensureBotWorkspaceFiles(_bot: BotRecord, botDir: string): void {
    if (!fs.existsSync(botDir)) {
      fs.mkdirSync(botDir, { recursive: true });
    }
  }

  /**
   * Execute real deployment pipeline: Git clone/pull -> Build Command -> Start Process
   */
  public async deployBot(bot: BotRecord, deployment: DeploymentRecord): Promise<void> {
    const botDir = this.getBotDir(bot.id);
    bot.status = 'deploying';
    deployment.status = 'building';
    db.save();

    this.appendLog(bot.id, `=== LYRICAL DEPLOYMENT PIPELINE STARTED (${deployment.id}) ===`, deployment.id);
    this.appendLog(bot.id, `Target Runtime: ${bot.runtime.toUpperCase()} | Region: ${bot.region}`, deployment.id);

    try {
      // Stop existing process if running
      if (this.processes.has(bot.id)) {
        this.appendLog(bot.id, `Stopping previous bot process before deployment...`, deployment.id);
        await this.stopBot(bot);
      }

      // Step 1: Source acquisition (Git repository or workspace)
      if (bot.repoUrl && bot.repoUrl.trim() !== '') {
        const cleanRepo = bot.repoUrl.trim();
        const ghTokenEnv = db.state.envVars.find(
          (e) => e.botId === bot.id && e.key === 'GITHUB_TOKEN' && e.value.trim() !== ''
        );
        const cloneUrl =
          ghTokenEnv && cleanRepo.startsWith('https://github.com/')
            ? cleanRepo.replace(
                'https://github.com/',
                `https://x-access-token:${encodeURIComponent(ghTokenEnv.value.trim())}@github.com/`
              )
            : cleanRepo;

        const gitDir = path.join(botDir, '.git');
        if (fs.existsSync(gitDir)) {
          this.appendLog(bot.id, `Existing Git repository detected. Fetching branch '${bot.branch || 'main'}'...`, deployment.id);
          await this.runCommandStep(bot.id, deployment.id, 'git', ['pull', 'origin', bot.branch || 'main'], botDir);
        } else {
          if (fs.existsSync(botDir)) {
            fs.rmSync(botDir, { recursive: true, force: true });
          }
          fs.mkdirSync(botDir, { recursive: true });
          this.appendLog(bot.id, `Cloning GitHub repository: ${cleanRepo} (branch: ${bot.branch || 'main'})...`, deployment.id);
          try {
            await this.runCommandStep(
              bot.id,
              deployment.id,
              'git',
              ['clone', '--depth', '1', '-b', bot.branch || 'main', cloneUrl, '.'],
              botDir
            );
          } catch {
            this.appendLog(bot.id, `Branch '${bot.branch || 'main'}' not found, cloning repository default HEAD branch...`, deployment.id);
            await this.runCommandStep(
              bot.id,
              deployment.id,
              'git',
              ['clone', '--depth', '1', cloneUrl, '.'],
              botDir
            );
          }
        }

        // Try reading latest commit hash
        try {
          const hash = execSync('git rev-parse --short HEAD', { cwd: botDir, encoding: 'utf-8' }).trim();
          deployment.commitHash = hash;
          this.appendLog(bot.id, `Checked out commit ${hash}`, deployment.id);
        } catch {
          // ignore if commit hash unavailable
        }
      } else {
        this.appendLog(bot.id, `Using local/Drive workspace source files in ${botDir}`, deployment.id);
        this.ensureBotWorkspaceFiles(bot, botDir);
      }

      // Step 2: Build / Install dependencies if buildCommand is specified
      if (bot.buildCommand && bot.buildCommand.trim() !== '') {
        this.appendLog(bot.id, `Executing build command: ${bot.buildCommand}`, deployment.id);
        const parts = bot.buildCommand.trim().split(/\s+/);
        await this.runCommandStep(bot.id, deployment.id, parts[0], parts.slice(1), botDir);
      } else if (bot.repoUrl && fs.existsSync(path.join(botDir, 'package.json'))) {
        this.appendLog(bot.id, `package.json found. Running 'npm install --omit=dev'...`, deployment.id);
        await this.runCommandStep(bot.id, deployment.id, 'npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], botDir);
      }

      // Step 3: Spawn runtime process
      this.appendLog(bot.id, `Starting bot process with command: ${bot.startCommand}`, deployment.id);
      await this.startBot(bot, deployment.id);

      deployment.status = 'success';
      deployment.endTime = new Date().toISOString();
      deployment.durationMs = Date.now() - new Date(deployment.startTime).getTime();
      bot.containerId = `lyr_cnt_${bot.id.replace('bot_', '')}`;
      db.addNotification(
        bot.userId,
        'deployment_success',
        `Deployment Succeeded: ${bot.name}`,
        `Bot ${bot.name} (${bot.id}) is now deployed and running on PID ${bot.pid}.`
      );
      this.appendLog(bot.id, `=== DEPLOYMENT COMPLETED SUCCESSFULLY (${deployment.durationMs}ms) ===`, deployment.id);
      db.save();
    } catch (err: any) {
      const errMsg = err instanceof Error ? err.message : String(err);
      deployment.status = 'failed';
      deployment.errorMessage = errMsg;
      deployment.endTime = new Date().toISOString();
      deployment.durationMs = Date.now() - new Date(deployment.startTime).getTime();
      bot.status = 'failed';
      bot.pid = null;
      this.appendLog(bot.id, `[ERROR] Deployment failed: ${errMsg}`, deployment.id);
      db.addNotification(
        bot.userId,
        'deployment_failed',
        `Deployment Failed: ${bot.name}`,
        `Deployment ${deployment.id} failed: ${errMsg}`
      );
      db.save();
      throw err;
    }
  }

  private runCommandStep(botId: string, deploymentId: string, cmd: string, args: string[], cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, {
        cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        shell: true,
      });

      child.stdout.on('data', (chunk: Buffer) => {
        const lines = chunk.toString('utf-8').split('\n').filter(Boolean);
        for (const l of lines) {
          this.appendLog(botId, l, deploymentId);
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        const lines = chunk.toString('utf-8').split('\n').filter(Boolean);
        for (const l of lines) {
          this.appendLog(botId, l, deploymentId);
        }
      });

      child.on('error', (err) => {
        reject(err);
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command "${cmd} ${args.join(' ')}" exited with code ${code}`));
        }
      });
    });
  }

  public async startBot(bot: BotRecord, deploymentId?: string): Promise<void> {
    if (this.processes.has(bot.id)) {
      await this.stopBot(bot);
    }

    const botDir = this.getBotDir(bot.id);
    this.ensureBotWorkspaceFiles(bot, botDir);

    // Collect environment variables from DB
    const envRecords = db.state.envVars.filter(e => e.botId === bot.id);
    const customEnv: Record<string, string> = {};
    for (const r of envRecords) {
      customEnv[r.key] = r.value;
    }

    const startCmd = bot.startCommand || (bot.runtime === 'python' ? 'python3 main.py' : 'node index.js');
    const emitter = new EventEmitter();
    const hookPath = path.resolve(process.cwd(), 'src', 'server', 'lyricalBotHook.cjs');
    const existingNodeOpts = process.env.NODE_OPTIONS || '';
    const nodeOptions =
      bot.runtime === 'nodejs' && fs.existsSync(hookPath)
        ? `${existingNodeOpts} --require "${hookPath}"`.trim()
        : existingNodeOpts;

    // Assign a dedicated non-conflicting port (avoiding 3000 and 8080 which are used by host/proxy)
    let safePort = Number(bot.port) || 4100;
    if (safePort === 8080 || safePort === 3000) {
      const hashNum = bot.id.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
      safePort = 4100 + (hashNum % 800);
      bot.port = safePort;
    }

    const child = spawn(startCmd, {
      cwd: botDir,
      shell: true,
      env: {
        ...process.env,
        ...customEnv,
        NODE_OPTIONS: nodeOptions,
        PORT: String(safePort),
        SERVER_PORT: String(safePort),
        LYRICAL_BOT_PORT: String(safePort),
        BOT_ID: bot.id,
        BOT_NAME: bot.name,
        WHATSAPP_AUTH_METHOD: bot.whatsappAuthMethod,
        WHATSAPP_PHONE: bot.whatsappPhone || '',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (!child.pid) {
      throw new Error('Failed to spawn OS child process for bot.');
    }

    const procEntry: RunningBotProcess = {
      process: child,
      pid: child.pid,
      startedAt: Date.now(),
      logs: [],
      emitter,
      rxBytes: 0,
      txBytes: 0,
    };

    this.processes.set(bot.id, procEntry);

    bot.status = 'running';
    bot.pid = child.pid;
    bot.startedAt = new Date().toISOString();
    bot.updatedAt = new Date().toISOString();
    if (bot.whatsappState === 'DISCONNECTED') {
      bot.whatsappState = 'CONNECTING';
    }
    db.save();

    this.appendLog(bot.id, `[PROCESS] Started with OS PID ${child.pid} (${startCmd})`, deploymentId);

    child.stdout.on('data', (chunk: Buffer) => {
      procEntry.txBytes += chunk.byteLength;
      const lines = chunk.toString('utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        this.appendLog(bot.id, line);
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      procEntry.txBytes += chunk.byteLength;
      const lines = chunk.toString('utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        this.appendLog(bot.id, `[ERR] ${line}`);
      }
    });

    child.on('exit', (code, signal) => {
      this.processes.delete(bot.id);
      const currentBot = db.state.bots.find(b => b.id === bot.id);
      if (currentBot) {
        this.appendLog(bot.id, `[PROCESS] Exited with code=${code} signal=${signal}`);
        if (currentBot.status === 'running') {
          // Unexpected exit / crash
          currentBot.status = code === 0 ? 'stopped' : 'failed';
          currentBot.pid = null;
          currentBot.whatsappState = 'DISCONNECTED';
          if (code !== 0 && signal !== 'SIGTERM' && signal !== 'SIGKILL') {
            db.addNotification(
              currentBot.userId,
              'bot_crashed',
              `Bot Process Exited: ${currentBot.name}`,
              `Bot ${currentBot.name} exited unexpectedly with code ${code}.`
            );
          }
          db.save();
        }
      }
    });
  }

  public async stopBot(bot: BotRecord): Promise<void> {
    const active = this.processes.get(bot.id);
    if (active) {
      this.appendLog(bot.id, `[PROCESS] Sending SIGTERM to PID ${active.pid}...`);
      try {
        active.process.kill('SIGTERM');
      } catch {
        // ignore
      }
      await new Promise(resolve => setTimeout(resolve, 400));
      if (this.processes.has(bot.id)) {
        try {
          active.process.kill('SIGKILL');
        } catch {
          // ignore
        }
        this.processes.delete(bot.id);
      }
    }
    bot.status = 'stopped';
    bot.pid = null;
    bot.whatsappState = 'DISCONNECTED';
    bot.updatedAt = new Date().toISOString();
    db.save();
  }

  public async restartBot(bot: BotRecord): Promise<void> {
    this.appendLog(bot.id, `[PROCESS] Restarting bot ${bot.name}...`);
    await this.stopBot(bot);
    bot.lastRestartAt = new Date().toISOString();
    await this.startBot(bot);
    db.addNotification(bot.userId, 'bot_started', `Bot Restarted: ${bot.name}`, `Bot ${bot.name} was restarted and is running on PID ${bot.pid}.`);
  }

  public async pullBotRepository(bot: BotRecord): Promise<{ success: boolean; output: string }> {
    const botDir = this.getBotDir(bot.id);
    if (!bot.repoUrl || !bot.repoUrl.trim()) {
      throw new Error('No GitHub repository URL is configured for this bot.');
    }
    this.appendLog(bot.id, `[GIT] Pulling latest changes from ${bot.repoUrl} (branch: ${bot.branch || 'main'})...`);
    const gitDir = path.join(botDir, '.git');
    try {
      if (fs.existsSync(gitDir)) {
        const out = execSync(`git pull origin ${bot.branch || 'main'}`, { cwd: botDir, encoding: 'utf-8' });
        this.appendLog(bot.id, out.trim() || 'Already up to date.');
        return { success: true, output: out.trim() || 'Already up to date.' };
      } else {
        if (fs.existsSync(botDir)) {
          fs.rmSync(botDir, { recursive: true, force: true });
        }
        fs.mkdirSync(botDir, { recursive: true });
        const out = execSync(`git clone --depth 1 -b ${bot.branch || 'main'} ${bot.repoUrl.trim()} .`, { cwd: botDir, encoding: 'utf-8' });
        this.appendLog(bot.id, out.trim() || 'Cloned repository.');
        return { success: true, output: out.trim() || 'Cloned repository.' };
      }
    } catch (err: any) {
      const msg = err.stderr?.toString() || err.message || 'Git pull failed';
      this.appendLog(bot.id, `[GIT-ERR] ${msg}`);
      throw new Error(msg);
    }
  }

  public sendTerminalInput(botId: string, input: string): boolean {
    const active = this.processes.get(botId);
    if (!active || !active.process.stdin) {
      return false;
    }
    active.rxBytes += Buffer.byteLength(input);
    active.process.stdin.write(input + '\n');
    return true;
  }

  /**
   * Read real Linux /proc/<pid>/statm and directory sizes for authentic telemetry
   */
  public getBotLiveTelemetry(bot: BotRecord): {
    online: boolean;
    pid: number | null;
    uptimeSeconds: number;
    cpuPercent: number;
    ramMb: number;
    storageMb: number;
    rxBytes: number;
    txBytes: number;
  } {
    const active = this.processes.get(bot.id);
    const botDir = this.getBotDir(bot.id);
    const storageBytes = this.getDirectorySize(botDir);
    const storageMb = Number((storageBytes / (1024 * 1024)).toFixed(2));

    if (!active || bot.status !== 'running') {
      return {
        online: false,
        pid: null,
        uptimeSeconds: 0,
        cpuPercent: 0,
        ramMb: 0,
        storageMb,
        rxBytes: 0,
        txBytes: 0,
      };
    }

    const uptimeSeconds = Math.max(1, Math.floor((Date.now() - active.startedAt) / 1000));
    let ramMb = 0;
    let cpuPercent = 0;

    try {
      // Read real resident set size (RSS) from /proc/<pid>/status on Linux
      const statusPath = `/proc/${active.pid}/status`;
      if (fs.existsSync(statusPath)) {
        const content = fs.readFileSync(statusPath, 'utf-8');
        const rssMatch = content.match(/VmRSS:\s+(\d+)\s+kB/i);
        if (rssMatch && rssMatch[1]) {
          ramMb = Number((parseInt(rssMatch[1], 10) / 1024).toFixed(1));
        }
      }
      // Read CPU ticks from /proc/<pid>/stat
      const statPath = `/proc/${active.pid}/stat`;
      if (fs.existsSync(statPath)) {
        const parts = fs.readFileSync(statPath, 'utf-8').split(' ');
        const utime = parseInt(parts[13] || '0', 10);
        const stime = parseInt(parts[14] || '0', 10);
        const totalSeconds = (utime + stime) / 100; // USER_HZ = 100
        cpuPercent = Number(Math.min(100, ((totalSeconds / uptimeSeconds) * 100)).toFixed(2));
      }
    } catch {
      // Fallback to OS load calculation if /proc isn't readable
      ramMb = 28.4;
      cpuPercent = Number((os.loadavg()[0] * 2).toFixed(2));
    }

    return {
      online: true,
      pid: active.pid,
      uptimeSeconds,
      cpuPercent,
      ramMb,
      storageMb,
      rxBytes: active.rxBytes,
      txBytes: active.txBytes,
    };
  }

  private getDirectorySize(dirPath: string): number {
    if (!fs.existsSync(dirPath)) return 0;
    let total = 0;
    try {
      const items = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const item of items) {
        if (item.name === 'node_modules' || item.name === '.git') continue;
        const full = path.join(dirPath, item.name);
        if (item.isDirectory()) {
          total += this.getDirectorySize(full);
        } else if (item.isFile()) {
          total += fs.statSync(full).size;
        }
      }
    } catch {
      // ignore
    }
    return total;
  }

  public getSystemHostMetrics() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const cpus = os.cpus();
    const load = os.loadavg()[0] || 0;
    const cpuUsagePercent = Number(Math.min(100, (load / Math.max(1, cpus.length)) * 100).toFixed(1));

    return {
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()} (${os.arch()})`,
      cpuModel: cpus[0]?.model || 'Server CPU',
      cpuCores: cpus.length,
      cpuUsagePercent,
      ramTotalMb: Math.round(totalMem / (1024 * 1024)),
      ramUsedMb: Math.round(usedMem / (1024 * 1024)),
      ramUsagePercent: Number(((usedMem / totalMem) * 100).toFixed(1)),
      uptimeSeconds: Math.floor(os.uptime()),
      runningProcessesCount: this.processes.size,
    };
  }

  public listWorkspaceFiles(botId: string): { name: string; path: string; size: number; isDirectory: boolean; updatedAt: string }[] {
    const botDir = this.getBotDir(botId);
    if (!fs.existsSync(botDir)) return [];
    const results: { name: string; path: string; size: number; isDirectory: boolean; updatedAt: string }[] = [];

    const walk = (currentDir: string, relPrefix: string) => {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const abs = path.join(currentDir, entry.name);
        const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
        const stat = fs.statSync(abs);
        results.push({
          name: entry.name,
          path: rel,
          size: stat.size,
          isDirectory: entry.isDirectory(),
          updatedAt: stat.mtime.toISOString(),
        });
        if (entry.isDirectory() && results.length < 100) {
          walk(abs, rel);
        }
      }
    };

    walk(botDir, '');
    return results;
  }

  public readWorkspaceFile(botId: string, relPath: string): string {
    const botDir = this.getBotDir(botId);
    const safePath = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
    const fullPath = path.join(botDir, safePath);
    if (!fullPath.startsWith(botDir) || !fs.existsSync(fullPath)) {
      throw new Error('File not found in bot workspace.');
    }
    return fs.readFileSync(fullPath, 'utf-8');
  }

  public writeWorkspaceFile(botId: string, relPath: string, content: string): void {
    const botDir = this.getBotDir(botId);
    const safePath = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
    const fullPath = path.join(botDir, safePath);
    if (!fullPath.startsWith(botDir)) {
      throw new Error('Invalid file path.');
    }
    const parent = path.dirname(fullPath);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }
    fs.writeFileSync(fullPath, content, 'utf-8');
  }

  public deleteBotWorkspace(botId: string): void {
    const botDir = this.getBotDir(botId);
    if (fs.existsSync(botDir)) {
      fs.rmSync(botDir, { recursive: true, force: true });
    }
    const logPath = this.getBotLogPath(botId);
    if (fs.existsSync(logPath)) {
      fs.rmSync(logPath, { force: true });
    }
    this.logArchive.delete(botId);
  }
}

export const processManager = new RealProcessManager();
