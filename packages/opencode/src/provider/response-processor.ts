/**
 * Response Processor
 * 
 * "I am fluent in over six million forms of communication."
 * This module translates raw, messy text streams from local LLMs into
 * structured, civilized Tool Call events that the application can understand.
 */
import { Log } from "../util/log";

export type ResponseProcessorState = {
  buffer: string;
  potentialToolJson: string;
  isBufferingJson: boolean;
  wasCoerced: boolean;
  lastJsonChunk: any;
  toolCallId: string;
};

export const createInitialState = (): ResponseProcessorState => ({
  buffer: "",
  potentialToolJson: "",
  isBufferingJson: false,
  wasCoerced: false,
  lastJsonChunk: null,
  toolCallId: "call_" + Math.random().toString(36).slice(2, 11),
});

export function shouldProcessResponse(
  response: Response,
  model: any,
  options: any
): boolean {
  const contentType = response.headers.get("content-type");
  const baseURL = (options["baseURL"] as string) || "";
  const providerID = model.providerID || "";
  
  Log.Default.info("shouldProcessResponse: CHECK", { providerID, baseURL, contentType });

  const should = !!(
    response.body &&
    contentType?.includes("text/event-stream") &&
    (providerID.toLowerCase().includes("litellm") ||
      providerID.toLowerCase().includes("local") ||
      model.api.id.toLowerCase().includes("litellm") ||
      ((model.api.npm === "@ai-sdk/openai-compatible" ||
        model.api.npm === "@ai-sdk/openai") &&
        (baseURL.includes("localhost") ||
          baseURL.includes("127.0.0.1") ||
          baseURL.includes("100.222.0.")))
    )
  );
  
  if (should) {
    Log.Default.info("shouldProcessResponse: YES", { providerID, baseURL });
  }

  return should;
}

export type ProcessingContext = {
  controller: ReadableStreamDefaultController;
  encoder: TextEncoder;
  state: ResponseProcessorState;
  logger: Log.Logger;
};

// Pure function candidates

export function flushBufferingAsText(ctx: ProcessingContext, reason: string) {
  if (!ctx.state.isBufferingJson) return;
  
  ctx.logger.info("buffering_flush", {
    reason,
    preview: ctx.state.potentialToolJson.substring(0, 500),
  });
  
  const textChunk = {
    ...ctx.state.lastJsonChunk,
    choices: [
      {
        ...(ctx.state.lastJsonChunk?.choices?.[0] || { index: 0 }),
        delta: { content: ctx.state.potentialToolJson },
      },
    ],
  };
  
  ctx.controller.enqueue(
    ctx.encoder.encode(`data: ${JSON.stringify(textChunk)}\n\n`)
  );
  
  ctx.state.isBufferingJson = false;
  ctx.state.potentialToolJson = "";
}

export function tryCoerceToolCall(ctx: ProcessingContext, json: any): boolean {
  // Check if we should start buffering
  const content = json.choices?.[0]?.delta?.content || "";
  
  if (!ctx.state.isBufferingJson && content.trim().startsWith("{")) {
    ctx.logger.info("buffering_start", { content });
    ctx.state.isBufferingJson = true;
    ctx.state.potentialToolJson = content;
    return true; // Consumed
  }

  if (ctx.state.isBufferingJson) {
    ctx.state.potentialToolJson += content;

    try {
      const parsed = JSON.parse(ctx.state.potentialToolJson);
      
      let toolName: string | undefined;
      let toolArgs: any;

      // Check for 'actions' array (take the first one)
      let target = parsed;
      if (Array.isArray(parsed.actions) && parsed.actions.length > 0) {
        target = parsed.actions[0];
      } else if (parsed.actions && !Array.isArray(parsed.actions)) {
        // Handle malformed actions where it might be a single object
        target = parsed.actions;
      }

      const name =
        target.name ||
        target.function?.name ||
        target.action ||
        target.tool;
      const args =
        target.arguments ||
        target.parameters ||
        target.function?.arguments ||
        target.function?.parameters ||
        target.args ||
        target.input;

      const knownTools = ["bash", "read", "write", "edit", "list", "glob", "grep", "webfetch", "task", "todowrite", "todoread", "websearch"];
      const nonToolKeys = ["response", "text", "content", "message", "answer", "thought", "reasoning"];
      const toolAliases: Record<string, string> = {
        "ls": "list",
        "dir": "list",
        "read_file": "read",
        "cat": "read",
        "write_file": "write",
        "edit_file": "edit",
        "search": "grep",
        "find": "grep",
        "cmd": "bash",
        "execute": "bash",
        "run": "bash"
      };

      // Helper to normalize arguments
      const normalizeArgs = (name: string, args: any) => {
        if (!args) return {};
        
        // Handle array arguments (positional)
        if (Array.isArray(args)) {
          if (name === "read" && args.length > 0) return { filePath: args[0] };
          if (name === "list" && args.length > 0) return { path: args[0] };
          if (name === "write" && args.length > 1) return { filePath: args[0], content: args[1] };
          if (name === "grep" && args.length > 0) return { pattern: args[0], path: args[1] || "." };
          return {}; // Fallback for unknown array args
        }

        // Handle object arguments (alias normalization)
        if (typeof args === "object") {
          const newArgs = { ...args };
          
          if (name === "read") {
            if (newArgs.path) { newArgs.filePath = newArgs.path; delete newArgs.path; }
            if (newArgs.filename) { newArgs.filePath = newArgs.filename; delete newArgs.filename; }
            if (newArgs.file_path) { newArgs.filePath = newArgs.file_path; delete newArgs.file_path; }
          }
          
          if (name === "write") {
            if (newArgs.path) { newArgs.filePath = newArgs.path; delete newArgs.path; }
            if (newArgs.filename) { newArgs.filePath = newArgs.filename; delete newArgs.filename; }
            if (newArgs.file_path) { newArgs.filePath = newArgs.file_path; delete newArgs.file_path; }
            if (newArgs.text) { newArgs.content = newArgs.text; delete newArgs.text; }
            if (newArgs.data) { newArgs.content = newArgs.data; delete newArgs.data; }
          }

          if (name === "list") {
             if (newArgs.dir) { newArgs.path = newArgs.dir; delete newArgs.dir; }
             if (newArgs.directory) { newArgs.path = newArgs.directory; delete newArgs.directory; }
          }
          
          return newArgs;
        }

        return args;
      };

      if (name && args && typeof name === "string") {
        const lowerName = name.toLowerCase();
        if (knownTools.includes(lowerName)) {
            toolName = lowerName;
            toolArgs = normalizeArgs(toolName, args);
        } else if (toolAliases[lowerName]) {
            toolName = toolAliases[lowerName];
            toolArgs = normalizeArgs(toolName, args);
        }
      } 
      
      if (!toolName) {
        // Fallback: Check for known parameter keys in the root object
        const keys = Object.keys(target).map(k => k.toLowerCase());
        
        if (target.search_terms) {
            toolName = "websearch";
            const terms = Array.isArray(target.search_terms) ? target.search_terms.join(" ") : target.search_terms;
            toolArgs = { query: terms };
        } else if (target.fetch_urls) {
            toolName = "webfetch";
            const urls = Array.isArray(target.fetch_urls) ? target.fetch_urls[0] : target.fetch_urls;
            toolArgs = { url: urls };
        } else if (keys.includes("filepath") || keys.includes("path")) {
          toolName = "read";
          toolArgs = target;
        } else if (keys.includes("command")) {
          toolName = "bash";
          toolArgs = target;
        } else if (keys.length === 1) {
          const key = Object.keys(target)[0];
          const lowerKey = key.toLowerCase();
          if (knownTools.includes(lowerKey)) {
            toolName = lowerKey;
            toolArgs = target[key];
          } else if (nonToolKeys.includes(lowerKey)) {
             const value = target[key];
             const textContent = typeof value === "string" ? value : JSON.stringify(value);
             ctx.logger.info("coerced_text_content", { key });
             const textChunk = {
               ...json,
               choices: [{ ...json.choices?.[0], delta: { content: textContent } }],
             };
             ctx.controller.enqueue(ctx.encoder.encode(`data: ${JSON.stringify(textChunk)}\n\n`));
             ctx.state.isBufferingJson = false;
             ctx.state.potentialToolJson = "";
             ctx.state.wasCoerced = true;
             return true; 
          }
        }
      }

      if (toolName && toolArgs) {
        // Generate a fresh ID for each tool call to prevent SDK confusion
        const currentToolCallId = "call_" + Math.random().toString(36).slice(2, 11);
        ctx.logger.info("coerced_tool_call", { tool: toolName, id: currentToolCallId });
        
        const toolChunk = {
          ...json,
          choices: [
            {
              ...json.choices[0],
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: currentToolCallId,
                    type: "function",
                    function: {
                      name: toolName,
                      arguments:
                        typeof toolArgs === "string"
                          ? toolArgs
                          : JSON.stringify(toolArgs),
                    },
                  },
                ],
                role: "assistant",
              },
            },
          ],
        };
        ctx.controller.enqueue(
            ctx.encoder.encode(`data: ${JSON.stringify(toolChunk)}\n\n`)
        );
        ctx.state.isBufferingJson = false;
        ctx.state.potentialToolJson = "";
        ctx.state.wasCoerced = true;
        return true; // Consumed and coerced
      } else {
         // It parsed as JSON but didn't match our tool schema
         // Stop buffering and flush as text
         flushBufferingAsText(ctx, "not_tool_call");
         return true; // Consumed (flushed)
      }
    } catch (e) {
      // Keep buffering, JSON is incomplete
      return true; // Consumed
    }
  }
  
  return false;
}

export async function processStream(
  response: Response,
  model: any,
  logger: Log.Logger
): Promise<Response> {
  logger.info("processStream: START", { providerID: model.providerID });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const state = createInitialState();

  const stream = new ReadableStream({
    async start(controller) {
      const ctx: ProcessingContext = { controller, encoder, state, logger };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            flushBufferingAsText(ctx, "stream_end");
            if (state.buffer) {
              controller.enqueue(encoder.encode(state.buffer));
            }
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          state.buffer += chunk;

          const lines = state.buffer.split("\n");
          state.buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith("data: [DONE]")) {
              if (state.wasCoerced) {
                const finishChunk = {
                  choices: [
                    {
                      index: 0,
                      delta: {},
                      finish_reason: "tool_calls",
                    },
                  ],
                };
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(finishChunk)}\n\n`)
                );
              }
              controller.enqueue(encoder.encode(line + "\n\n"));
              continue;
            }

            if (trimmedLine.startsWith("data:")) {
              const jsonStr = trimmedLine.replace(/^data: /, "").trim();
              try {
                const json = JSON.parse(jsonStr);
                state.lastJsonChunk = json;

                if (state.wasCoerced && json.choices?.[0]?.finish_reason) {
                  json.choices[0].finish_reason = "tool_calls";
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify(json)}\n\n`)
                  );
                  continue;
                }

                if (tryCoerceToolCall(ctx, json)) {
                    continue;
                }
              } catch (e) {
                // Not JSON or parse error, pass through
              }

              controller.enqueue(encoder.encode(line + "\n\n"));
            } else {
              controller.enqueue(encoder.encode(line + "\n"));
            }
          }
        }
      } catch (e) {
        controller.error(e);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
