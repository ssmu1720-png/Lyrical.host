import { spawn, ChildProcess, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import net from 'net';
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
  private watchdogInterval: NodeJS.Timeout | null = null;
  private autoStartInterval: NodeJS.Timeout | null = null;
  private restartBackoffs: Map<string, { count: number; lastAttempt: number }> = new Map();

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
    this.startWatchdog();
    this.start3MinuteAutoStarter();
  }

  /**
   * 3-Minute Auto-Starter Heartbeat
   * Verifies every bot every 3 minutes (180s) and automatically wakes up / starts any inactive or sleeping bot
   */
  public start3MinuteAutoStarter(): void {
    if (this.autoStartInterval) return;
    this.autoStartInterval = setInterval(() => {
      this.run3MinuteAutoStartCycle().catch((err) => {
        console.error('[3-MIN-AUTO-STARTER-ERR]', err);
      });
    }, 3 * 60 * 1000); // exactly every 3 minutes
  }

  public async run3MinuteAutoStartCycle(): Promise<void> {
    for (const bot of db.state.bots) {
      if (bot.autoRestart === false) continue;
      const proc = this.processes.get(bot.id);
      let isRunning = false;
      if (proc && proc.pid) {
        try {
          process.kill(proc.pid, 0);
          isRunning = true;
        } catch {
          isRunning = false;
        }
      }

      if (!isRunning) {
        this.appendLog(
          bot.id,
          `[3-MIN-AUTO-STARTER] Scheduled 3-minute heartbeat: bot "${bot.name}" is sleeping/inactive. Automatically starting up...`
        );
        this.startBot(bot).catch((err) => {
          this.appendLog(bot.id, `[3-MIN-AUTO-STARTER-ERR] Auto-start failed: ${err.message}`);
        });
      }
    }
  }

  /**
   * Continuous 24/7 Watchdog that inspects all bots and recovers any that slept or terminated silently
   */
  public startWatchdog(): void {
    if (this.watchdogInterval) return;
    this.watchdogInterval = setInterval(() => {
      this.runWatchdogCycle().catch((err) => {
        console.error('[WATCHDOG-CYCLE-ERR]', err);
      });
    }, 15000); // Probe every 15 seconds
  }

  public async runWatchdogCycle(): Promise<void> {
    const now = Date.now();
    for (const bot of db.state.bots) {
      if (bot.status !== 'running') continue;
      if (bot.autoRestart === false) continue;

      const proc = this.processes.get(bot.id);
      let isDead = false;

      if (!proc || !proc.pid) {
        isDead = true;
      } else {
        try {
          // Signal 0 probes process existence in the OS kernel
          process.kill(proc.pid, 0);
        } catch (e: any) {
          if (e.code === 'ESRCH') {
            isDead = true;
          }
        }
      }

      if (isDead) {
        const backoff = this.restartBackoffs.get(bot.id) || { count: 0, lastAttempt: 0 };
        // Reset counter if more than 5 minutes have elapsed since last attempt
        if (now - backoff.lastAttempt > 5 * 60 * 1000) {
          backoff.count = 0;
        }

        if (backoff.count >= 8) {
          this.appendLog(
            bot.id,
            `[WATCHDOG] Bot ${bot.name} reached max recovery attempts (8). Pausing auto-restart to prevent crash loop.`
          );
          bot.status = 'failed';
          bot.whatsappState = 'DISCONNECTED';
          db.save();
          continue;
        }

        backoff.count++;
        backoff.lastAttempt = now;
        this.restartBackoffs.set(bot.id, backoff);

        bot.restartCount = (bot.restartCount || 0) + 1;
        bot.lastRestartAt = new Date().toISOString();
        this.appendLog(
          bot.id,
          `[WATCHDOG] Detected bot "${bot.name}" is sleeping or process stopped (Recovery attempt ${backoff.count}/8). Automatically restarting...`
        );
        this.processes.delete(bot.id);
        db.save();

        this.startBot(bot).catch((err) => {
          this.appendLog(bot.id, `[WATCHDOG-ERR] Auto-recovery restart failed: ${err.message}`);
        });
      }
    }
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

      // Step 2: Build / Install dependencies (with --legacy-peer-deps to prevent peer conflicts)
      const pkgPath = path.join(botDir, 'package.json');
      const hasPkg = fs.existsSync(pkgPath);

      if (bot.buildCommand && bot.buildCommand.trim() !== '') {
        let cmd = bot.buildCommand.trim();
        if (cmd === 'npm install' || cmd === 'npm i') {
          cmd = 'npm install --legacy-peer-deps --no-audit --no-fund';
        }
        this.appendLog(bot.id, `Executing build command: ${cmd}`, deployment.id);
        const parts = cmd.split(/\s+/);
        try {
          await this.runCommandStep(bot.id, deployment.id, parts[0], parts.slice(1), botDir);
        } catch (buildErr: any) {
          this.appendLog(bot.id, `[BUILD-WARN] ${buildErr.message}. Attempting install fallback with --legacy-peer-deps...`, deployment.id);
          await this.runCommandStep(bot.id, deployment.id, 'npm', ['install', '--legacy-peer-deps', '--no-audit', '--no-fund'], botDir);
        }
      } else if (hasPkg) {
        this.appendLog(bot.id, `package.json found. Installing all dependencies with '--legacy-peer-deps'...`, deployment.id);
        await this.runCommandStep(bot.id, deployment.id, 'npm', ['install', '--legacy-peer-deps', '--no-audit', '--no-fund'], botDir);
      }

      // Automatically detect start command from package.json if available
      if (hasPkg) {
        try {
          const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
          if (pkgJson.scripts && pkgJson.scripts.start && (!bot.startCommand || bot.startCommand === 'node index.js')) {
            bot.startCommand = 'npm start';
            db.save();
          }
        } catch {
          // ignore
        }
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

  /**
   * Probes whether a TCP port is currently occupied on IPv6 (::) or IPv4 (0.0.0.0)
   */
  public checkPortOccupiedOnHost(port: number): Promise<boolean> {
    const probeHost = (host: string): Promise<boolean> =>
      new Promise((resolve) => {
        const tester = net.createServer();
        tester.once('error', (err: any) => {
          if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
            resolve(true);
          } else {
            resolve(false);
          }
        });
        tester.once('listening', () => {
          tester.close(() => resolve(false));
        });
        try {
          tester.listen(port, host);
        } catch {
          resolve(true);
        }
      });

    return (async () => {
      const ipv6Busy = await probeHost('::');
      if (ipv6Busy) return true;
      const ipv4Busy = await probeHost('0.0.0.0');
      return ipv4Busy;
    })();
  }

  /**
   * Detects if the requested port (e.g. 8080) is occupied and scans 4100-4999 for the next available port
   */
  public async allocateAvailablePort(
    preferredPort: number,
    botId: string,
    deploymentId?: string
  ): Promise<number> {
    const targetPort = Number(preferredPort) || 8080;

    // Check if another active bot already claims this port
    const claimedByOtherBot = (p: number) =>
      db.state.bots.some((b) => b.id !== botId && b.status === 'running' && b.port === p);

    const isTargetBusy =
      targetPort === 3000 ||
      targetPort === 8080 ||
      claimedByOtherBot(targetPort) ||
      (await this.checkPortOccupiedOnHost(targetPort));

    if (!isTargetBusy) {
      return targetPort;
    }

    this.appendLog(
      botId,
      `[PORT-SCANNER] Detected port ${targetPort} is occupied on host. Scanning range 4100–4999 for next available port...`,
      deploymentId
    );

    for (let candidate = 4100; candidate <= 4999; candidate++) {
      if (claimedByOtherBot(candidate)) continue;
      const busy = await this.checkPortOccupiedOnHost(candidate);
      if (!busy) {
        this.appendLog(
          botId,
          `[PORT-SCANNER] Dynamically assigned available port ${candidate} (avoided EADDRINUSE on ${targetPort}).`,
          deploymentId
        );
        return candidate;
      }
    }

    // Fallback: ask OS kernel for an ephemeral free port
    const ephemeralPort = await new Promise<number>((resolve) => {
      const srv = net.createServer();
      srv.listen(0, '0.0.0.0', () => {
        const addr = srv.address();
        const assigned = typeof addr === 'object' && addr ? addr.port : 4500;
        srv.close(() => resolve(assigned));
      });
      srv.on('error', () => resolve(4500));
    });

    this.appendLog(
      botId,
      `[PORT-SCANNER] Dynamically assigned OS ephemeral port ${ephemeralPort}.`,
      deploymentId
    );
    return ephemeralPort;
  }

  public async startBot(bot: BotRecord, deploymentId?: string): Promise<void> {
    if (this.processes.has(bot.id)) {
      await this.stopBot(bot);
    }

    const botDir = this.getBotDir(bot.id);
    this.ensureBotWorkspaceFiles(bot, botDir);

    // Detect if port 8080 (or current bot.port) is occupied and dynamically assign next available port
    const safePort = await this.allocateAvailablePort(bot.port || 8080, bot.id, deploymentId);
    bot.port = safePort;
    db.save();

    // Collect environment variables from DB
    const envRecords = db.state.envVars.filter(e => e.botId === bot.id);
    const customEnv: Record<string, string> = {};
    for (const r of envRecords) {
      customEnv[r.key] = r.value;
    }
    // Ensure PORT in customEnv cannot override our dynamically verified safePort with 8080
    customEnv['PORT'] = String(safePort);
    customEnv['SERVER_PORT'] = String(safePort);
    customEnv['APP_PORT'] = String(safePort);

    const startCmd = bot.startCommand || (bot.runtime === 'python' ? 'python3 main.py' : 'node index.js');
    const emitter = new EventEmitter();
    const hookPath = path.resolve(process.cwd(), 'src', 'server', 'lyricalBotHook.cjs');
    const existingNodeOpts = process.env.NODE_OPTIONS || '';
    const nodeOptions =
      bot.runtime === 'nodejs' && fs.existsSync(hookPath)
        ? `${existingNodeOpts} --require "${hookPath}"`.trim()
        : existingNodeOpts;

    const child = spawn(startCmd, {
      cwd: botDir,
      shell: true,
      env: {
        ...process.env,
        ...customEnv,
        NODE_OPTIONS: nodeOptions,
        PORT: String(safePort),
        SERVER_PORT: String(safePort),
        APP_PORT: String(safePort),
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
          currentBot.pid = null;
          currentBot.whatsappState = 'DISCONNECTED';

          // If stopped intentionally via user action (SIGTERM/SIGKILL), mark stopped
          if (signal === 'SIGTERM' || signal === 'SIGKILL' || currentBot.autoRestart === false) {
            currentBot.status = 'stopped';
            db.save();
          } else {
            // Unexpected crash or silent sleep exit: notify user and trigger auto-restart watchdog
            currentBot.status = 'deploying';
            currentBot.restartCount = (currentBot.restartCount || 0) + 1;
            currentBot.lastRestartAt = new Date().toISOString();
            db.addNotification(
              currentBot.userId,
              'bot_crashed',
              `Bot Process Exited: ${currentBot.name}`,
              `Bot ${currentBot.name} exited (code ${code}). Auto-restarting watchdog active...`
            );
            db.save();

            this.appendLog(
              bot.id,
              `[WATCHDOG] Process terminated / slept (code ${code}, signal ${signal}). Automatically restarting bot in 4 seconds...`
            );

            setTimeout(() => {
              // Only restart if still in deploying state (user hasn't manually deleted/stopped it)
              const recheck = db.state.bots.find((b) => b.id === bot.id);
              if (recheck && recheck.status === 'deploying') {
                this.startBot(recheck).catch((err) => {
                  this.appendLog(bot.id, `[WATCHDOG-ERR] Auto-restart failed: ${err.message}`);
                  recheck.status = 'failed';
                  db.save();
                });
              }
            }, 4000);
          }
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
