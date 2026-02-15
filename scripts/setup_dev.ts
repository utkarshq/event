import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";

const VENV_DIR = join(process.cwd(), ".venv");
const CACHE_DIR = join(process.cwd(), ".paddle_cache");

console.log("🛠  Checking development environment...");

// 1. Create .paddle_cache if missing
if (!existsSync(CACHE_DIR)) {
    console.log(`📂 Creating paddle cache directory: ${CACHE_DIR}`);
    mkdirSync(CACHE_DIR, { recursive: true });
}

// 2. Create virtual environment if missing
if (!existsSync(VENV_DIR)) {
    console.log("🐍 Creating Python virtual environment...");
    const venvProc = spawnSync("python3", ["-m", "venv", ".venv"], { stdio: "inherit" });
    if (venvProc.status !== 0) {
        console.error("❌ Failed to create virtual environment.");
        process.exit(1);
    }
}

// 3. Install dependencies
console.log("📦 Checking/Installing Python dependencies...");
const pipPath = join(VENV_DIR, "bin", "pip");

// Upgrade pip first
spawnSync(pipPath, ["install", "--upgrade", "pip"], { stdio: "inherit" });

// Install requirements
const installProc = spawnSync(pipPath, ["install", "-r", "requirements.txt"], { stdio: "inherit" });

if (installProc.status !== 0) {
    console.error("❌ Failed to install dependencies.");
    process.exit(1);
}

console.log("✅ Development environment is ready!");
