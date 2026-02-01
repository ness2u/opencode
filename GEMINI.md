# OpenCode Project Context

## Project Overview
**OpenCode** is an open-source AI coding agent designed to be a provider-agnostic, TUI-first alternative to tools like Claude Code. It allows users to interact with an AI agent to perform coding tasks, supporting multiple LLM providers (Anthropic, OpenAI, Google, local models, etc.) and offering a rich terminal user interface.

## Architecture
The project follows a **Client/Server** architecture within a **Monorepo**:

*   **Core Logic (`packages/opencode`)**: Contains the "brain" of the agent, the headless API server, and the TUI client. It handles file operations, LLM interactions, and tool execution.
*   **Shared UI (`packages/app`)**: A shared Web UI library built with SolidJS, used by both the Web interface and the Desktop app.
*   **Desktop App (`packages/desktop`)**: A native desktop application built with **Tauri v2** that wraps the shared Web UI.
*   **Console (`packages/console`)**: Likely the SaaS management dashboard components.
*   **Infrastructure (`infra/`)**: Cloud infrastructure defined using **SST** (Serverless Stack), targeting Cloudflare.

## Tech Stack
*   **Runtime:** [Bun](https://bun.sh) (v1.3+)
*   **Language:** TypeScript
*   **Build System:** [Turborepo](https://turbo.build)
*   **Frontend Framework:** [SolidJS](https://www.solidjs.com)
*   **Styling:** [Tailwind CSS](https://tailwindcss.com)
*   **TUI Library:** `@opentui/core` (Custom SolidJS-based TUI)
*   **Desktop:** [Tauri](https://tauri.app) (v2)
*   **AI Integration:** [Vercel AI SDK](https://sdk.vercel.ai)
*   **Infrastructure:** [SST](https://sst.dev)

## Development Workflow

### Prerequisites
*   **Bun:** v1.3 or later (`curl -fsSL https://bun.sh/install | bash`)
*   **Rust:** Required for Tauri development.

### Setup
```bash
bun install
```

### Running the CLI (TUI)
The primary development mode runs the CLI directly from source.

```bash
# Run the TUI in the current directory
bun dev

# Run the TUI against a specific directory
bun dev <directory_path>

# Run the TUI against the OpenCode repo itself
bun dev .
```

### Running the Headless Server
Required for Web and Desktop development.

```bash
bun dev serve --port 4096
```

### Running the Desktop App
Requires the headless server to be running.

```bash
# Start the Tauri dev server (opens native window)
bun run --cwd packages/desktop tauri dev

# Build the native app bundle
bun run --cwd packages/desktop tauri build
```

### Running the Web UI
Requires the headless server to be running.

```bash
bun run --cwd packages/app dev
```

### Building a Local Binary
To compile a standalone `opencode` binary:

```bash
./packages/opencode/script/build.ts --single
# Binary location: ./packages/opencode/dist/opencode-<platform>/bin/opencode
```

### Type Checking
```bash
bun turbo typecheck
```

## Debugging
*   **TUI/CLI:** `bun run --inspect=ws://localhost:6499/ dev ...`
*   **Server:** `bun run --inspect=ws://localhost:6499/ --cwd packages/opencode ./src/index.ts serve --port 4096`
*   **VS Code:** Reference `.vscode/launch.example.json` for configurations.

## Project Structure
*   `packages/opencode`: **CORE**. The CLI, TUI, and Agent Server logic.
*   `packages/app`: Shared SolidJS Web UI components.
*   `packages/desktop`: Tauri configuration and wrapper.
*   `packages/console`: SaaS/Cloud management console.
*   `packages/sdk`: JavaScript SDK for OpenCode.
*   `packages/plugin`: Plugin system implementation.
*   `packages/ui`: Shared UI components library.
*   `infra/`: SST infrastructure definitions.
*   `script/`: Global scripts for release, stats, etc.

## Conventions
*   **Package Manager:** **Bun** is strictly used. Do not use `npm` or `yarn`.
*   **Code Style:**
    *   Prefer **functions** over classes for logic.
    *   Avoid unnecessary destructuring.
    *   Avoid `else` statements where possible (early return).
    *   Use precise types (avoid `any`).
    *   Use `const` (immutable) over `let`.
*   **Commits:** Follow Conventional Commits (`feat:`, `fix:`, `chore:`, etc.).
*   **PRs:** Must reference an existing issue.
