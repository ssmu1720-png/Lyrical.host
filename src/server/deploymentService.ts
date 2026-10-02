import { db, BotRecord, DeploymentRecord, ServerRecord } from './db.ts';
import { processManager } from './processManager.ts';

export class DeploymentServiceAdapter {
  private get externalApiUrl(): string {
    return (db.state.systemSettings.deploymentApiUrl || process.env.DEPLOYMENT_API_URL || '').trim();
  }

  private get externalApiKey(): string {
    return (process.env.DEPLOYMENT_API_KEY || '').trim();
  }

  private async callExternalApi(endpoint: string, options: RequestInit = {}): Promise<any> {
    const baseUrl = this.externalApiUrl.replace(/\/+$/, '');
    const url = `${baseUrl}${endpoint}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string> || {}),
      };
      if (this.externalApiKey) {
        headers['Authorization'] = `Bearer ${this.externalApiKey}`;
        headers['X-API-Key'] = this.externalApiKey;
      }

      const res = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Upstream API returned HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      return await res.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  public async deployBot(bot: BotRecord, deployment: DeploymentRecord): Promise<void> {
    if (this.externalApiUrl) {
      try {
        processManager.appendLog(bot.id, `Connecting to configured external deployment API...`, deployment.id);
        const envVars = db.state.envVars
          .filter(e => e.botId === bot.id)
          .reduce((acc, cur) => ({ ...acc, [cur.key]: cur.value }), {} as Record<string, string>);

        const payload = {
          botId: bot.id,
          name: bot.name,
          runtime: bot.runtime,
          repoUrl: bot.repoUrl,
          branch: bot.branch,
          startCommand: bot.startCommand,
          buildCommand: bot.buildCommand,
          port: bot.port,
          region: bot.region,
          whatsappAuthMethod: bot.whatsappAuthMethod,
          whatsappPhone: bot.whatsappPhone,
          env: envVars,
        };

        const result = await this.callExternalApi('/bots/deploy', {
          method: 'POST',
          body: JSON.stringify(payload),
        });

        bot.containerId = result.containerId || result.id || `ext_${bot.id}`;
        bot.status = 'running';
        deployment.status = 'success';
        deployment.endTime = new Date().toISOString();
        deployment.durationMs = Date.now() - new Date(deployment.startTime).getTime();
        if (Array.isArray(result.logs)) {
          for (const l of result.logs) {
            processManager.appendLog(bot.id, String(l), deployment.id);
          }
        }
        db.save();
        return;
      } catch (err: any) {
        processManager.appendLog(bot.id, `[EXTERNAL-API-ERROR] ${err.message}`, deployment.id);
        throw err;
      }
    }

    // Default to integrated real OS ProcessManager & Git runner (from wh-panel-site-main)
    await processManager.deployBot(bot, deployment);
  }

  public async getDeploymentStatus(deploymentId: string): Promise<DeploymentRecord | null> {
    const dep = db.state.deployments.find(d => d.id === deploymentId) || null;
    return dep;
  }

  public async getBot(botId: string) {
    const bot = db.state.bots.find(b => b.id === botId);
    if (!bot) return null;
    const telemetry = processManager.getBotLiveTelemetry(bot);
    return {
      ...bot,
      telemetry,
    };
  }

  public async startBot(bot: BotRecord): Promise<void> {
    if (this.externalApiUrl) {
      await this.callExternalApi(`/bots/${bot.id}/start`, { method: 'POST' });
      bot.status = 'running';
      bot.startedAt = new Date().toISOString();
      db.save();
      return;
    }
    await processManager.startBot(bot);
  }

  public async stopBot(bot: BotRecord): Promise<void> {
    if (this.externalApiUrl) {
      await this.callExternalApi(`/bots/${bot.id}/stop`, { method: 'POST' });
      bot.status = 'stopped';
      bot.pid = null;
      db.save();
      return;
    }
    await processManager.stopBot(bot);
  }

  public async restartBot(bot: BotRecord): Promise<void> {
    if (this.externalApiUrl) {
      await this.callExternalApi(`/bots/${bot.id}/restart`, { method: 'POST' });
      bot.status = 'running';
      bot.lastRestartAt = new Date().toISOString();
      db.save();
      return;
    }
    await processManager.restartBot(bot);
  }

  public async deleteBot(bot: BotRecord): Promise<void> {
    if (this.externalApiUrl) {
      try {
        await this.callExternalApi(`/bots/${bot.id}`, { method: 'DELETE' });
      } catch {
        // continue local cleanup
      }
    }
    await processManager.stopBot(bot);
    processManager.deleteBotWorkspace(bot.id);
  }

  public async getLogs(botId: string): Promise<string[]> {
    if (this.externalApiUrl) {
      try {
        const res = await this.callExternalApi(`/bots/${botId}/logs`);
        if (Array.isArray(res.logs)) return res.logs;
      } catch {
        // fallback to stored logs
      }
    }
    return processManager.getLogs(botId);
  }

  public async getServers(): Promise<(ServerRecord & { metrics: any; runningBots: number })[]> {
    const hostMetrics = processManager.getSystemHostMetrics();
    return db.state.servers.map((srv, idx) => {
      const runningBots = db.state.bots.filter(b => b.serverId === srv.id && b.status === 'running').length;
      return {
        ...srv,
        runningBots,
        metrics: idx === 0 ? hostMetrics : {
          ...hostMetrics,
          hostname: srv.name,
          runningProcessesCount: runningBots,
        },
      };
    });
  }
}

export const deploymentService = new DeploymentServiceAdapter();
