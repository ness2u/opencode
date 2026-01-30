import { spawn } from "child_process";
import path from "path";
import fs from "fs";

// --- Configuration ---
const OPENCODE_BIN = path.resolve(__dirname, "../packages/opencode/src/index.ts");
const GOLDEN_REPO_SRC = path.resolve(__dirname, "golden-context-repo");
const OPENCODE_DIR = path.dirname(OPENCODE_BIN).replace("/src", "");
const TEST_ENV_NAME = "golden-test-env";
const TEST_ENV_PATH = path.join(OPENCODE_DIR, TEST_ENV_NAME);
const TESTS_FILE = path.join(GOLDEN_REPO_SRC, "tests.json");

// 20 Minutes Timeout per test case (as requested for big models)
const TIMEOUT_MS = 20 * 60 * 1000;

// Parse Arguments
const args = process.argv.slice(2);
let model = args.find((arg, i) => args[i - 1] === "--model" || arg.startsWith("--model="));
if (model && model.startsWith("--model=")) model = model.split("=")[1];

// --- Types ---
interface TestCase {
  id: string;
  description: string;
  prompt: string;
  expect?: {
    output_contains?: string[];
    file_exists?: string;
    file_content_contains?: string;
  };
}

// --- Helpers ---

function setupEnv() {
  console.log(`\n📦 Setting up test environment in: ${TEST_ENV_PATH}`);
  if (fs.existsSync(TEST_ENV_PATH)) {
    fs.rmSync(TEST_ENV_PATH, { recursive: true, force: true });
  }
  fs.cpSync(GOLDEN_REPO_SRC, TEST_ENV_PATH, { recursive: true });
}

async function runOpencodeCommand(cmdArgs: string[], check?: (out: string) => boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    // We use the 'dev' script from packages/opencode/package.json
    const finalArgs = ["run", "--cwd", OPENCODE_DIR, "dev", "--", ...cmdArgs];
    
    const cp = spawn("bun", finalArgs, {
      cwd: OPENCODE_DIR, 
      env: { 
          ...process.env, 
          CI: "true",
          OPENCODE_CONFIG_DIR: path.join(TEST_ENV_PATH, ".opencode"),
          OPENCODE_HEADLESS: "1" 
      },
    });

    let stdout = "";
    let stderr = "";
    let resolved = false;

    cp.stdout.on("data", (data) => {
      const str = data.toString();
      stdout += str;
      process.stdout.write(str);

      if (check && !resolved && check(stdout)) {
          resolved = true;
          console.log("\n✅ Assertions met. Stopping process early...");
          cp.kill();
      }
    });

    cp.stderr.on("data", (data) => {
      const str = data.toString();
      stderr += str;
      process.stderr.write(str);
    });

    cp.stdin.end();

    const heartbeat = setInterval(() => {
      if (!resolved) console.log("   💓 Still running...");
    }, 30000);

    const timeout = setTimeout(() => {
      if (resolved) return;
      cp.kill();
      clearInterval(heartbeat);
      reject(new Error(`Timeout: Opencode process took too long (> ${TIMEOUT_MS / 1000 / 60} mins).`));
    }, TIMEOUT_MS);

    cp.on("close", (code) => {
      clearTimeout(timeout);
      clearInterval(heartbeat);
      resolve(stdout + stderr);
    });
  });
}

// --- Main Runner ---

async function runTest(test: TestCase) {
  console.log(`\n🔹 [${test.id}] ${test.description}`);
  
  if (!model) {
    console.log("   ⏭️  Skipping (No model specified. Use --model <name>)");
    return;
  }

  const prompt = test.prompt;
  const args = ["run", prompt, "--model", model];

  try {
    const output = await runOpencodeCommand(args, (out) => {
        if (test.expect?.output_contains) {
            return test.expect.output_contains.every(str => out.includes(str));
        }
        return false;
    });

    console.log(`\n🏁 Finalizing assertions for ${test.id}...`);
    
    if (test.expect?.output_contains) {
      for (const str of test.expect.output_contains) {
        if (output.includes(str)) {
          console.log(`   ✅ Output contains "${str}"`);
        } else {
          console.error(`   ❌ FAIL: Output missing "${str}"`);
          throw new Error(`Output assertion failed for ${test.id}`);
        }
      }
    }

    if (test.expect?.file_exists) {
      const filePath = path.join(TEST_ENV_PATH, test.expect.file_exists);
      if (fs.existsSync(filePath)) {
        console.log(`   ✅ File exists: ${test.expect.file_exists}`);
      } else {
        console.error(`   ❌ FAIL: File not found: ${test.expect.file_exists}`);
        throw new Error(`File assertion failed for ${test.id}`);
      }
    }

  } catch (e) {
    console.error(`   💥 Error executing test:`, e);
  }
}

async function main() {
  console.log("🚀 Starting Validation Suite");
  if (!fs.existsSync(TESTS_FILE)) {
    console.error("No tests.json found in golden-context-repo");
    process.exit(1);
  }

  const tests: TestCase[] = JSON.parse(fs.readFileSync(TESTS_FILE, "utf-8"));
  console.log(`Found ${tests.length} tests.`);

  setupEnv();

  for (const test of tests) {
    await runTest(test);
  }

  console.log("\n✨ All tests completed.");
  if (fs.existsSync(TEST_ENV_PATH)) {
    fs.rmSync(TEST_ENV_PATH, { recursive: true, force: true });
  }
}

main();