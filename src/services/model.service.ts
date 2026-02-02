import { spawn } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

export type PaddleTier = "eco" | "lite" | "pro";

export class ModelService {
    private static bridgeProcess: any = null;
    private static bridgeLogs: string[] = [];
    private static MAX_LOGS = 100;
    private static BRIDGE_PATH = join(process.cwd(), "src", "bridge", "paddle_bridge.py");
    private static VENV_PATH = join(process.cwd(), ".venv");
    private static CONFIG_PATH = join(process.cwd(), "model_config.json");

    /**
     * Gets the status of all tiers.
     */
    static getStatus(): any {
        let activeTier: PaddleTier = "eco";
        try {
            if (existsSync(this.CONFIG_PATH)) {
                const cfg = JSON.parse(readFileSync(this.CONFIG_PATH, "utf-8"));
                activeTier = cfg.activeTier || "eco";
            }
        } catch { activeTier = "eco"; }

        const hasVenv = existsSync(this.VENV_PATH);
        // Check for transformers in any python version directory
        const libPath = join(this.VENV_PATH, "lib");
        let hasVLM = false;
        if (hasVenv && existsSync(libPath)) {
            const pyDirs = spawn("ls", [libPath]).stdout; // This won't work synchronously like this
            // We'll use a safer approach: check for the bin/torch or bin/transformers-cli if they exist
            hasVLM = existsSync(join(this.VENV_PATH, "bin", "torchrun")) ||
                existsSync(join(this.VENV_PATH, "bin", "accelerate"));
        }

        return {
            installed: hasVenv,
            running: this.bridgeProcess !== null && this.bridgeProcess.exitCode === null,
            activeTier,
            tiers: {
                eco: { installed: hasVenv },
                lite: { installed: hasVLM },
                pro: { installed: hasVLM }
            }
        };
    }

    /**
     * Returns captured bridge logs.
     */
    static getLogs(): string[] {
        const logs = [...this.bridgeLogs];
        this.bridgeLogs = []; // Clear after reading to avoid duplicates in UI poll
        return logs;
    }

    private static stripAnsi(text: string): string {
        return text.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "");
    }

    private static addLog(data: string, isError = false) {
        const cleanData = this.stripAnsi(data.toString());
        const lines = cleanData.split("\n").filter(l => l.trim());

        lines.forEach(line => {
            // Smart Categorization: Paddle uses stderr for normal info
            let finalIsError = isError;
            const lowerLine = line.toLowerCase();
            if (isError && (
                lowerLine.includes("info:") ||
                lowerLine.includes("creating model") ||
                lowerLine.includes("already exist") ||
                lowerLine.includes("ready.") ||
                lowerLine.includes("waiting for application") ||
                lowerLine.includes("connectivity check") ||
                lowerLine.includes("warning:") ||
                lowerLine.includes("userwarning") ||
                lowerLine.includes("deprecationwarning") ||
                lowerLine.includes("warnings.warn") ||
                lowerLine.includes("paddlex") ||
                lowerLine.includes("u-v-doc") ||
                lowerLine.includes("ocr_engine.ocr") ||
                lowerLine.includes("result =") ||
                lowerLine.includes("traceback") ||
                lowerLine.includes("line") ||
                lowerLine.includes(".py:") ||
                lowerLine.includes("initialising paddleocr") ||
                lowerLine.includes("loading standard paddleocr") ||
                lowerLine.includes("warming up models") ||
                lowerLine.includes("extracted") ||
                lowerLine.includes("received ocr request") ||
                lowerLine.includes("processing") ||
                lowerLine.includes("warmup warning")
            )) {
                finalIsError = false;
            }

            const entry = finalIsError ? `[PADDLE_ERR] ${line}` : line;
            this.bridgeLogs.push(entry);
            if (this.bridgeLogs.length > this.MAX_LOGS) this.bridgeLogs.shift();
            console[finalIsError ? "error" : "log"](entry);
        });
    }

    /**
     * Sets the active tier.
     */
    static setActiveTier(tier: PaddleTier) {
        writeFileSync(this.CONFIG_PATH, JSON.stringify({ activeTier: tier }));
        // Always try to start/restart the bridge when tier is set
        this.addLog(`🔄 Switching to tier: ${tier.toUpperCase()}`);
        this.start(tier).catch(e => this.addLog(`❌ Failed to start bridge: ${e.message}`, true));
    }

    /**
     * Installs dependencies for a specific tier.
     */
    static async install(tier: PaddleTier): Promise<void> {
        this.addLog(`🛠 Updating environment for PaddleOCR [${tier}]...`);

        if (!existsSync(this.VENV_PATH)) {
            await this.runCommand("python3", ["-m", "venv", ".venv"]);
        }

        const pipPath = join(this.VENV_PATH, "bin", "pip");

        // Base dependencies
        await this.runCommand(pipPath, ["install", "--upgrade", "pip"]);
        await this.runCommand(pipPath, ["install", "paddlepaddle", "paddleocr", "fastapi", "uvicorn", "pydantic", "pillow"]);

        if (tier === "lite" || tier === "pro") {
            this.addLog(`📦 Installing VLM dependencies for ${tier}...`);
            await this.runCommand(pipPath, ["install", "transformers", "torch", "einops", "accelerate"]);
            if (tier === "lite") {
                await this.runCommand(pipPath, ["install", "bitsandbytes"]);
            }
        }

        this.addLog(`✅ Tier [${tier}] environment configured.`);
        this.setActiveTier(tier);
    }

    /**
     * Starts the PaddleOCR bridge process.
     */
    static async start(tier?: PaddleTier): Promise<void> {
        if (this.bridgeProcess && this.bridgeProcess.exitCode === null) {
            // Check if already healthy
            try {
                const res = await fetch("http://127.0.0.1:5000/health", { signal: AbortSignal.timeout(1000) });
                if (res.ok) return;
            } catch { }
        }

        // Cleanup before start
        await this.stop();

        if (!tier) {
            const status = this.getStatus();
            tier = status.activeTier;
        }

        const pythonPath = join(this.VENV_PATH, "bin", "python3");
        const cacheDir = join(process.cwd(), ".paddle_cache");

        this.addLog(`🚀 Starting PaddleOCR Bridge [Tier: ${tier}]...`);
        this.bridgeProcess = spawn(pythonPath, [this.BRIDGE_PATH, "--tier", tier!], {
            env: {
                ...process.env,
                PADDLE_HOME: join(cacheDir, "ocr"),
                PADDLEX_HOME: join(cacheDir, "paddlex"),
                HF_HOME: join(cacheDir, "hf")
            }
        });

        this.bridgeProcess.stdout.on("data", (data: any) => this.addLog(data.toString()));
        this.bridgeProcess.stderr.on("data", (data: any) => this.addLog(data.toString(), true));

        this.bridgeProcess.on("close", (code: number) => {
            this.addLog(`⚠️ Bridge process closed with code ${code}`, true);
        });

        // Wait for health check (max 5 minutes)
        for (let i = 0; i < 300; i++) {
            try {
                const res = await fetch("http://127.0.0.1:5000/health", { signal: AbortSignal.timeout(1000) });
                if (res.ok) {
                    const data = (await res.json()) as any;
                    if (data.status === "ok") {
                        this.addLog("✅ Bridge health check passed and model is ready.");
                        return;
                    } else if (data.status === "loading") {
                        this.addLog("⏳ Bridge is loading model weights...");
                    }
                }
            } catch { }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        this.addLog("⚠️ Bridge startup timed out after 5m", true);
    }

    static async stop() {
        if (this.bridgeProcess) {
            this.bridgeProcess.kill('SIGTERM');
            this.bridgeProcess = null;
        }
        // Force kill any remaining processes on port 5000
        try {
            // Using a more reliable way to kill processes on port 5000
            const cmd = process.platform === 'win32'
                ? `for /f "tokens=5" %a in ('netstat -aon ^| findstr :5000') do taskkill /f /pid %a`
                : `fuser -k 5000/tcp || true`;
            spawn(cmd, { shell: true });
            this.addLog("🛑 Bridge port 5000 cleared.");
        } catch { }
    }

    private static runCommand(command: string, args: string[]): Promise<void> {
        return new Promise((resolve, reject) => {
            const proc = spawn(command, args);
            proc.stdout.on("data", (d) => this.addLog(d.toString()));
            proc.stderr.on("data", (d) => this.addLog(d.toString(), true));
            proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${command} failed`)));
        });
    }
}
