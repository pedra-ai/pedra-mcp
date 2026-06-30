import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  Pedra,
  PedraError,
  PedraApiError,
  type ImageResponse,
} from "@pedra-ai/sdk";

export const SERVER_NAME = "pedra";
export const SERVER_VERSION = "0.2.0";

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
  | "updateVideo"
  | "generateVoiceScript"
  | "generateVoice"
  | "musicLibrary"
  | "listProjects"
  | "listProjectImages"
  | "createProject"
  | "addImagesToProject"
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

// --- local image inlining ----------------------------------------------------

/**
 * Extension → image MIME type. Pedra accepts a `data:` URI, so a local file a
 * user drags or drops in becomes a base64 data URI we build from one of these.
 */
const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".avif": "image/avif",
};

/** Ceiling on an inlined local file, so a stray path can't build a runaway data URI. */
const MAX_LOCAL_IMAGE_BYTES = 40 * 1024 * 1024;

/**
 * Resolve one image input into a value the Pedra API accepts. Remote URLs and
 * existing `data:` URIs pass through untouched; anything else is treated as a
 * path to a local file — the form a terminal or drag-and-drop inserts — and
 * read off disk into a base64 `data:` URI. This is what lets a user point a
 * tool at a local image instead of having to host it somewhere first.
 */
function resolveImageInput(value: string): string {
  const raw = value.trim();
  if (/^(https?:|data:)/i.test(raw)) return raw;

  let path = raw;
  // Drag-and-drop and shells wrap or escape paths in a few predictable ways.
  if (
    (path.startsWith('"') && path.endsWith('"')) ||
    (path.startsWith("'") && path.endsWith("'"))
  ) {
    path = path.slice(1, -1);
  }
  if (path.startsWith("file://")) {
    path = fileURLToPath(path);
  } else {
    path = path.replace(/\\ /g, " "); // unescape "\ " from dragged paths
    if (path === "~" || path.startsWith("~/")) {
      path = homedir() + path.slice(1);
    }
  }

  const ext = extname(path).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) {
    throw new PedraError(
      `Unsupported local image type "${ext || "(none)"}" for ${path}. ` +
        `Supported: ${Object.keys(MIME_BY_EXT).join(", ")}. ` +
        `Otherwise pass a public https:// URL or a data: URI.`,
    );
  }

  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new PedraError(`Could not read local image at ${path}: ${why}`);
  }
  if (bytes.byteLength > MAX_LOCAL_IMAGE_BYTES) {
    const mb = (bytes.byteLength / 1024 / 1024).toFixed(1);
    throw new PedraError(
      `Local image at ${path} is ${mb} MB, over the ` +
        `${MAX_LOCAL_IMAGE_BYTES / 1024 / 1024} MB inline limit. ` +
        `Resize it or host it at a public URL.`,
    );
  }
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

/**
 * Return a shallow copy of a tool's args with every image-bearing field
 * resolved (see {@link resolveImageInput}). Covers the flat image tools plus
 * the per-frame images in `pedra_create_video`. Intentionally does NOT touch
 * `pedra_feedback`, whose `imageUrl` is an already-generated asset URL.
 */
function withResolvedImages<T extends Record<string, any>>(args: T): T {
  if (!args || typeof args !== "object") return args;
  const out: Record<string, any> = { ...args };
  if (typeof out.imageUrl === "string")
    out.imageUrl = resolveImageInput(out.imageUrl);
  if (typeof out.maskUrl === "string")
    out.maskUrl = resolveImageInput(out.maskUrl);
  if (typeof out.secondImageUrl === "string")
    out.secondImageUrl = resolveImageInput(out.secondImageUrl);
  if (Array.isArray(out.images)) {
    out.images = out.images.map((frame: any) => {
      if (!frame || typeof frame !== "object") return frame;
      const f = { ...frame };
      if (typeof f.imageUrl === "string")
        f.imageUrl = resolveImageInput(f.imageUrl);
      if (typeof f.secondImageUrl === "string")
        f.secondImageUrl = resolveImageInput(f.secondImageUrl);
      return f;
    });
  }
  return out as T;
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
  .describe(
    "Source image: a public https:// URL, a data: URI, or an absolute path to a local image file (the file is read and inlined automatically).",
  );
const creativity = z
  .enum(["Low", "Medium", "High"])
  .describe('Strength of the AI transformation. Defaults to "Medium".');
const preserveOriginalFraming = z
  .boolean()
  .describe(
    "Preserve the original framing/aspect ratio/resolution exactly (for verification verticals where the output must legally represent the captured photo). Defaults to false.",
  );

// Shared video building blocks, reused by pedra_create_video and pedra_update_video.
const videoImage = z.object({
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
  characteristics: z.object({ enabled: z.boolean().optional() }).optional(),
});

const videoMusic = z
  .object({
    enabled: z.boolean().optional(),
    track: z
      .string()
      .describe(
        "Genre key from pedra_music_library (e.g. acoustic, chill, cinematic, electronic, upbeat).",
      )
      .optional(),
  })
  .optional();

const videoVoice = z
  .object({
    enabled: z.boolean().optional(),
    audioId: z
      .string()
      .describe(
        "Id of a voiceover from pedra_generate_voice. Drives the narration and its synced subtitles.",
      )
      .optional(),
    audioUrl: z.string().describe("Legacy alias for audioId.").optional(),
    showSubtitles: z
      .boolean()
      .describe("Burn in word-synced subtitles. Defaults to true.")
      .optional(),
  })
  .optional();

const videoBranding = z
  .object({
    showWatermark: z.boolean().optional(),
    showProfessionalPicture: z.boolean().optional(),
  })
  .optional();

const propertyCharacteristics = z
  .array(z.object({ label: z.string(), value: z.string() }))
  .optional();

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
    guard(async (a) => imageOut(await client.enhance(withResolvedImages(a)))),
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
    guard(async (a) =>
      imageOut(await client.enhanceAndCorrectPerspective(withResolvedImages(a))),
    ),
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
    guard(async (a) => imageOut(await client.empty(withResolvedImages(a)))),
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
    guard(async (a) => imageOut(await client.furnish(withResolvedImages(a)))),
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
    guard(async (a) => imageOut(await client.renovation(withResolvedImages(a)))),
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
    guard(async (a) => imageOut(await client.editViaPrompt(withResolvedImages(a)))),
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
    guard(async (a) => imageOut(await client.sky(withResolvedImages(a)))),
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
          .describe(
            "Mask image marking the region to remove: a public https:// URL, a data: URI, or a local file path.",
          ),
      },
    },
    guard(async (a) => imageOut(await client.remove(withResolvedImages(a)))),
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
    guard(async (a) => imageOut(await client.blur(withResolvedImages(a)))),
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
          .array(videoImage)
          .min(1)
          .describe("Ordered list of images that make up the video."),
        music: videoMusic,
        voice: videoVoice,
        branding: videoBranding,
        endingTitle: z.string().optional(),
        endingSubtitle: z.string().optional(),
        isVertical: z
          .boolean()
          .describe("Force a vertical (9:16) video.")
          .optional(),
        propertyCharacteristics,
      },
    },
    guard(async (a) => {
      const res = await client.createVideo(withResolvedImages(a));
      return ok({
        message: res.message,
        videoId: res.videoId,
        videoUrl: res.videoUrl,
      });
    }),
  );

  register(
    server,
    "pedra_update_video",
    {
      title: "Edit existing video",
      description:
        "Edit an existing video (by videoId) without re-rendering unchanged clips — only new/changed photos re-animate and cost credits; reordering, music, voice, branding and text re-stitch for free. Omit `images` to change only audio/text/branding while keeping the current timeline. Omit `music`/`voice`/`branding`/ending text to leave them unchanged. Blocks until rendered and returns the new video URL.",
      inputSchema: {
        videoId: z
          .string()
          .describe("Id of the video to edit (from pedra_create_video)."),
        images: z
          .array(videoImage)
          .describe(
            "Full ordered image list to rebuild the timeline; matching photo+effect clips are reused. Omit to edit only audio/text and keep the current timeline.",
          )
          .optional(),
        music: videoMusic,
        voice: videoVoice,
        branding: videoBranding,
        endingTitle: z.string().optional(),
        endingSubtitle: z.string().optional(),
        isVertical: z
          .boolean()
          .describe("Force a vertical (9:16) video (only when images are sent).")
          .optional(),
        propertyCharacteristics,
      },
    },
    guard(async (a) => {
      const res = await client.updateVideo(withResolvedImages(a));
      return ok({
        message: res.message,
        videoId: res.videoId,
        videoUrl: res.videoUrl,
      });
    }),
  );

  register(
    server,
    "pedra_generate_voice_script",
    {
      title: "Generate voiceover script",
      description:
        "Write a short voiceover script from property photos (and optional facts). GPT-4o vision reads the images so the script reflects what's actually shown. Returns the script text — pass it to pedra_generate_voice.",
      inputSchema: {
        images: z
          .array(z.union([imageUrl, z.object({ imageUrl })]))
          .describe("Photos to base the script on (URLs or { imageUrl }).")
          .optional(),
        propertyCharacteristics,
        language: z
          .string()
          .describe('Script language, e.g. "English", "Español". Defaults to English.')
          .optional(),
      },
    },
    guard(async (a) => {
      const res = await client.generateVoiceScript(a);
      return ok({ message: res.message, script: res.script });
    }),
  );

  register(
    server,
    "pedra_generate_voice",
    {
      title: "Generate voiceover audio",
      description:
        "Render a voiceover from a script via text-to-speech. Returns an audioId — pass it to pedra_create_video / pedra_update_video as voice.audioId to attach the narration (with synced subtitles).",
      inputSchema: {
        text: z.string().describe("The script to narrate (max 1000 characters)."),
        language: z
          .string()
          .describe('Voice language, e.g. "English", "Español". Defaults to English.')
          .optional(),
      },
    },
    guard(async (a) => {
      const res = await client.generateVoice(a);
      return ok({
        message: res.message,
        audioId: res.audioId,
        audioUrl: res.audioUrl,
        alignmentUrl: res.alignmentUrl,
        duration: res.duration,
      });
    }),
  );

  register(
    server,
    "pedra_music_library",
    {
      title: "List music tracks",
      description:
        "List the background-music catalog: valid `music.track` values (genre keys) and the voice languages accepted by the voiceover tools. Read-only.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    guard(async () => {
      const res = await client.musicLibrary();
      return ok({
        tracks: res.tracks,
        variantsPerTrack: res.variantsPerTrack,
        defaultTrack: res.defaultTrack,
        voiceLanguages: res.voiceLanguages,
      });
    }),
  );

  register(
    server,
    "pedra_list_projects",
    {
      title: "List projects",
      description:
        "List the user's Pedra projects (id, name, photo count, and an appUrl to open each in Pedra). Use this to find photos already in the account — e.g. to build a video from a listing's photos.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    guard(async () => {
      const res = await client.listProjects();
      return ok({ projects: res.projects });
    }),
  );

  register(
    server,
    "pedra_list_project_images",
    {
      title: "List project photos",
      description:
        "List a project's photos as img.pedra.ai URLs, ready to pass straight to pedra_create_video or the image-editing tools. Get the projectId from pedra_list_projects.",
      inputSchema: {
        projectId: z
          .string()
          .describe("The project's id (from pedra_list_projects)."),
      },
      annotations: { readOnlyHint: true },
    },
    guard(async (a) => {
      const res = await client.listProjectImages(a);
      return ok({ projectId: res.projectId, name: res.name, images: res.images });
    }),
  );

  register(
    server,
    "pedra_create_project",
    {
      title: "Create project",
      description:
        "Create a new Pedra project. Returns its projectId and an appUrl. To add brand-new local photos (which can't be uploaded through chat), give the user the appUrl to open the project in Pedra and drop their photos in, then use pedra_list_project_images.",
      inputSchema: {
        name: z
          .string()
          .describe("Project name, e.g. the listing address.")
          .optional(),
      },
    },
    guard(async (a) => {
      const res = await client.createProject(a);
      return ok({ message: res.message, projectId: res.projectId, appUrl: res.appUrl });
    }),
  );

  register(
    server,
    "pedra_add_images_to_project",
    {
      title: "Add photos to project",
      description:
        "Add photos to a project BY URL — the server fetches each URL and stores it, so any public https image URL (or a small data: URI) works. Returns the stored img.pedra.ai URLs. For local files on the user's device, direct them to the project's appUrl instead (chat can't transfer large local files).",
      inputSchema: {
        projectId: z
          .string()
          .describe("Target project id (from pedra_list_projects or pedra_create_project)."),
        imageUrls: z
          .array(z.string())
          .describe("Up to 20 image URLs to fetch and add to the project."),
      },
    },
    guard(async (a) => {
      const res = await client.addImagesToProject(a);
      return ok({
        message: res.message,
        projectId: res.projectId,
        added: res.added,
        failed: res.failed,
        appUrl: res.appUrl,
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
