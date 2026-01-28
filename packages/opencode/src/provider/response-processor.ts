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
  return !!(
    response.body &&
    contentType?.includes("text/event-stream") &&
    (model.providerID.toLowerCase().includes("litellm") ||
      model.api.id.toLowerCase().includes("litellm") ||
      ((model.api.npm === "@ai-sdk/openai-compatible" ||
        model.api.npm === "@ai-sdk/openai") &&
        (options["baseURL"] as string)?.includes("localhost")))
  );
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

      if (name && args) {
        toolName = name;
        toolArgs = args;
      } else if (target.subagent_type) {
        toolName = "task";
        toolArgs = target;
      } else if (target.command) {
        if (typeof target.command === "string") {
          toolName = "bash";
          toolArgs = { command: target.command };
        } else if (typeof target.command === "object") {
          toolName = target.command.name || "bash";
          toolArgs = target.command.arguments || target.command;
        }
      }

      if (toolName && toolArgs) {
        ctx.logger.info("coerced_tool_call", { tool: toolName });
        const toolChunk = {
          ...json,
          choices: [
            {
              ...json.choices[0],
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: ctx.state.toolCallId,
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
