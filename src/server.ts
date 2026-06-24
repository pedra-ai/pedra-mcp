import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  Pedra,
  PedraError,
  PedraApiError,
  type ImageResponse,
} from "@pedra-ai/sdk";

export const SERVER_NAME = "pedra";
export const SERVER_VERSION = "0.1.2";

/** A Pedra-shaped client. Typed structurally so tests can inject a fake. */
export type PedraClient = Pick<
  Pedra,
  | "enhance"
  | "enhanceAndCorrectPerspective"
  | "empty"
  | "furnish"
  | "renovation"
  | "editViaPrompt"
  | "sky"
  | "remove"
  | "blur"
  | "createVideo"
  | "credits"
  | "feedback"
>;

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

/** Wrap an arbitrary value as a text tool result. */
function ok(data: unknown): ToolResult {
  const text =
    typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text }] };
}

/** Turn any thrown error into an `isError` tool result the model can read. */
function fail(err: unknown): ToolResult {
  let text: string;
  if (err instanceof PedraApiError) {
    text = `Pedra API error${err.status ? ` (HTTP ${err.status})` : ""}: ${err.message}`;
  } else if (err instanceof PedraError) {
    text = err.message;
  } else {
    text = err instanceof Error ? err.message : String(err);
  }
  return { content: [{ type: "text", text }], isError: true };
}

/** Image endpoints all return the same normalized shape. */
function imageOut(res: ImageResponse): ToolResult {
  return ok({ message: res.message, url: res.url, urls: res.urls });
}

/** Catch errors from every handler so they surface as tool errors, not crashes. */
function guard(
  fn: (args: any) => Promise<ToolResult>,
): (args: any) => Promise<ToolResult> {
  return async (args: any) => {
    try {
      return await fn(args);
    } catch (err) {
      return fail(err);
    }
  };
}

type ToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  openWorldHint?: boolean;
};

type ToolConfig = {
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: ToolAnnotations;
};

/**
 * Register a tool while erasing `registerTool`'s generic inference. Inferring
 * the args type from a zod `ZodRawShape` across all 12 tools makes `tsc` blow
 * its heap; we don't need the inference (handlers take `any` and validate at
 * runtime), so cast through to keep type-checking bounded and fast.
 */
function register(
  server: McpServer,
  name: string,
  config: ToolConfig,
  handler: (args: any) => Promise<ToolResult>,
): void {
  // Every tool advertises a `title` + behavioral hints (required for the
  // Claude connectors directory). All endpoints hit the external Pedra API and
  // create new assets — none mutate or delete existing data — so the default is
  // non-read-only, non-destructive, open-world; tools override as needed.
  const fullConfig = {
    ...config,
    annotations: {
      title: config.title,
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
      ...config.annotations,
    },
  };
  (server.registerTool as any)(name, fullConfig, handler);
}

// --- shared field schemas ----------------------------------------------------

const imageUrl = z
  .string()
  .describe("URL (or data: URL) of the source image.");
const creativity = z
  .enum(["Low", "Medium", "High"])
  .describe('Strength of the AI transformation. Defaults to "Medium".');
const preserveOriginalFraming = z
  .boolean()
  .describe(
    "Preserve the original framing/aspect ratio/resolution exactly (for verification verticals where the output must legally represent the captured photo). Defaults to false.",
  );

/**
 * Build a Pedra MCP server with one tool per API endpoint. Each tool is a
 * single blocking call that returns the final asset URL(s); the API's 4xx
 * errors (insufficient credits, bad image, …) come back as tool errors.
 */
export function createServer(client: PedraClient): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  register(
    server,
    "pedra_enhance",
    {
      title: "Enhance image",
      description:
        "Enhance a real-estate photo: improve lighting, color, and sharpness. Returns the enhanced image URL.",
      inputSchema: {
        imageUrl,
        preserveOriginalFraming: preserveOriginalFraming.optional(),
      },
    },
    guard(async (a) => imageOut(await client.enhance(a))),
  );

  register(
    server,
    "pedra_enhance_and_correct_perspective",
    {
      title: "Enhance + correct perspective",
      description:
        "Enhance a photo and correct vertical/horizontal perspective (straighten walls and lines). Returns the corrected image URL.",
      inputSchema: {
        imageUrl,
        preserveOriginalFraming: preserveOriginalFraming.optional(),
      },
    },
    guard(async (a) => imageOut(await client.enhanceAndCorrectPerspective(a))),
  );

  register(
    server,
    "pedra_empty_room",
    {
      title: "Empty room",
      description:
        "Remove all furniture and objects from a room, leaving an empty space. Returns the emptied image URL.",
      inputSchema: { imageUrl },
    },
    guard(async (a) => imageOut(await client.empty(a))),
  );

  register(
    server,
    "pedra_furnish",
    {
      title: "Furnish / virtually stage",
      description:
        "Virtually stage (furnish) a room with AI-generated furniture. Returns the staged image URL.",
      inputSchema: {
        imageUrl,
        roomType: z
          .string()
          .describe('e.g. "Living room", "Bedroom", "Kitchen". Auto-detected if omitted.')
          .optional(),
        style: z
          .string()
          .describe('e.g. "Minimalist", "Scandinavian", "Modern".')
          .optional(),
        creativity: creativity.optional(),
      },
    },
    guard(async (a) => imageOut(await client.furnish(a))),
  );

  register(
    server,
    "pedra_renovation",
    {
      title: "Renovate space",
      description:
        "Renovate a space (walls, floors, finishes), optionally furnished. Returns the renovated image URL.",
      inputSchema: {
        imageUrl,
        style: z.string().describe("Renovation style.").optional(),
        creativity: creativity.optional(),
        furnish: z
          .union([
            z.boolean(),
            z.enum(["With furniture", "Empty", "Auto"]),
          ])
          .describe(
            "Whether the renovated room should be furnished (true → with furniture, false → empty).",
          )
          .optional(),
        roomType: z.string().describe("Room type. Auto-detected if omitted.").optional(),
      },
    },
    guard(async (a) => imageOut(await client.renovation(a))),
  );

  register(
    server,
    "pedra_edit_via_prompt",
    {
      title: "Edit via prompt",
      description:
        "Edit an image from a natural-language instruction (e.g. \"paint the walls sage green\"). Returns the edited image URL.",
      inputSchema: {
        imageUrl,
        prompt: z
          .string()
          .describe("Natural-language description of the edit to apply."),
      },
    },
    guard(async (a) => imageOut(await client.editViaPrompt(a))),
  );

  register(
    server,
    "pedra_sky_blue",
    {
      title: "Replace sky",
      description:
        "Replace a dull or overcast sky with a clear blue one. Returns the image URL with the new sky.",
      inputSchema: {
        imageUrl,
        skyStyle: z.string().describe("Optional named sky style.").optional(),
      },
    },
    guard(async (a) => imageOut(await client.sky(a))),
  );

  register(
    server,
    "pedra_remove_object",
    {
      title: "Remove object",
      description:
        "Remove an object from an image using a mask. Returns the cleaned image URL.",
      inputSchema: {
        imageUrl,
        maskUrl: z
          .string()
          .describe("URL of the mask image marking the region to remove."),
      },
    },
    guard(async (a) => imageOut(await client.remove(a))),
  );

  register(
    server,
    "pedra_blur",
    {
      title: "Blur objects",
      description:
        "Blur objects in an image (e.g. faces, license plates) for privacy. Returns the blurred image URL.",
      inputSchema: {
        imageUrl,
        objectsToBlur: z
          .array(z.string())
          .describe('Labels/regions to blur, e.g. ["faces", "license plates"].'),
      },
    },
    guard(async (a) => imageOut(await client.blur(a))),
  );

  register(
    server,
    "pedra_create_video",
    {
      title: "Create property video",
      description:
        "Create a property video from a list of images. Blocks server-side until the video is rendered (up to ~10 min) and returns the finished video URL inline.",
      inputSchema: {
        images: z
          .array(
            z.object({
              imageUrl,
              effect: z
                .enum(["zoom-in", "zoom-out", "transition", "static"])
                .describe('Animation for this image. Defaults to "zoom-in".')
                .optional(),
              secondImageUrl: z
                .string()
                .describe('Required when effect is "transition".')
                .optional(),
              subtitle: z.string().optional(),
              title: z.string().optional(),
              watermark: z
                .object({
                  enabled: z.boolean().optional(),
                  position: z.string().optional(),
                  opacity: z.number().optional(),
                })
                .optional(),
              characteristics: z
                .object({ enabled: z.boolean().optional() })
                .optional(),
            }),
          )
          .min(1)
          .describe("Ordered list of images that make up the video."),
        music: z
          .object({
            enabled: z.boolean().optional(),
            track: z.string().optional(),
          })
          .optional(),
        voice: z
          .object({
            enabled: z.boolean().optional(),
            audioUrl: z.string().optional(),
          })
          .optional(),
        branding: z
          .object({
            showWatermark: z.boolean().optional(),
            showProfessionalPicture: z.boolean().optional(),
          })
          .optional(),
        endingTitle: z.string().optional(),
        endingSubtitle: z.string().optional(),
        isVertical: z
          .boolean()
          .describe("Force a vertical (9:16) video.")
          .optional(),
        propertyCharacteristics: z
          .array(z.object({ label: z.string(), value: z.string() }))
          .optional(),
      },
    },
    guard(async (a) => {
      const res = await client.createVideo(a);
      return ok({
        message: res.message,
        videoId: res.videoId,
        videoUrl: res.videoUrl,
      });
    }),
  );

  register(
    server,
    "pedra_credits",
    {
      title: "Get credits",
      description:
        "Read the account's plan and remaining credits. Never deducts credits.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    guard(async () => {
      const res = await client.credits();
      return ok({ plan: res.plan, creditsRemaining: res.creditsRemaining });
    }),
  );

  register(
    server,
    "pedra_feedback",
    {
      title: "Submit feedback",
      description:
        "Submit thumbs up/down feedback on a generated image, with an optional credit-back on a thumbs-down (subject to the API's eligibility rules).",
      inputSchema: {
        imageUrl: z
          .string()
          .describe("The generated image URL to vote on (id is parsed from it).")
          .optional(),
        imageId: z
          .string()
          .describe("Explicit image id. One of imageUrl/imageId is required.")
          .optional(),
        vote: z
          .enum(["up", "down", "positive", "negative", ""])
          .describe("Thumbs up/down. An empty string clears a previous vote.")
          .optional(),
        comment: z.string().optional(),
        creditBack: z
          .boolean()
          .describe("Request a credit refund (only honored on a thumbs-down).")
          .optional(),
      },
    },
    guard(async (a) => {
      const res = await client.feedback(a);
      const { raw, ...rest } = res;
      return ok(rest);
    }),
  );

  return server;
}
