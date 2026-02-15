import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";

const VENV_DIR = join(process.cwd(), ".venv");
const CACHE_DIR = join(process.cwd(), ".paddle_cache");

console.log("🛠  Checking development environment...");

const FLAG_FILE = join(process.cwd(), "node_modules", ".python_deps_installed");

// Check if we should skip
if (process.argv.includes("--force")) {
    console.log("Force flag detected. Re-checking env...");
} else if (existsSync(FLAG_FILE) && existsSync(VENV_DIR)) {
    console.log("✅ Python environment ready (cached). Skipping checks.");
    process.exit(0);
}

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

console.log("📦 Checking/Installing Python dependencies...");
const pipPath = join(VENV_DIR, "bin", "pip");

// Upgrade pip first
spawnSync(pipPath, ["install", "--upgrade", "pip"], { stdio: "inherit" });

// 3. Install CPU-optimized PyTorch separateley (STRICTLY from CPU index)
console.log("🧠 Installing PyTorch (CPU optimized)...");
const torchProc = spawnSync(
    pipPath,
    [
        "install",
        "torch",
        "--index-url",
        "https://download.pytorch.org/whl/cpu",
    ],
    { stdio: "inherit" }
);

if (torchProc.status !== 0) {
    console.error("❌ Failed to install PyTorch (CPU).");
    process.exit(1);
}

// 4. Install VLM extras (from PyPI)
console.log("🧩 Installing VLM extras...");
const vlmProc = spawnSync(
    pipPath,
    [
        "install",
        "accelerate",
        "bitsandbytes",
    ],
    { stdio: "inherit" }
);
if (vlmProc.status !== 0) {
    console.warn("⚠️  VLM extras failed to install. 'eco' tier will work, but 'lite'/'pro' might fail.");
}


// 5. Install other requirements
console.log("📦 Checking/Installing remaining dependencies...");
const installProc = spawnSync(pipPath, ["install", "-r", "requirements.txt"], { stdio: "inherit" });

if (installProc.status !== 0) {
    console.error("❌ Failed to install dependencies.");
    process.exit(1);
}

// Mark as installed
const { writeFileSync } = require("fs");
try {
    writeFileSync(FLAG_FILE, new Date().toISOString());
} catch { }

console.log("✅ Development environment is ready!");
