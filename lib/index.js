/**
 * dsh-media-player — host half.
 *
 * Registers the `media_show` tool (mints a short-lived, tokenized media URL for
 * a local file) and a `/dsh-media/` prefix route on the Web server that streams
 * the bytes with HTTP Range support so the browser player can seek.
 *
 * Security posture: the route never accepts paths — only opaque random tokens
 * minted by the tool, each bound to one absolute path at mint time. Tokens die
 * with the process; there is no directory listing and no path traversal surface.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, isAbsolute, resolve as resolvePath } from "node:path";
import { randomBytes } from "node:crypto";
import { defineTool } from "@deepseek-ai/dsh-tools";

export const name = "dsh-media-player";

/** Services required: tool registry, prompt sections, and the Web server route table. */
export const inject = ["tools", "systemPrompt", "webServer"];

const MIME = {
	".mp4": "video/mp4",
	".webm": "video/webm",
	".mov": "video/quicktime",
	".m4v": "video/x-m4v",
	".mkv": "video/x-matroska",
	".gif": "image/gif",
	".webp": "image/webp",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
};

export function apply(ctx) {
	/** @type {Map<string, {abs: string, mime: string, bytes: number}>} */
	const tokens = new Map();

	ctx.tools.register(
		defineTool({
			name: "media_show",
			description:
				"Show a local video or animation inline in the chat as a native player card. Mints a short-lived URL served by this host; call it after generating a video/animation or whenever the user asks to view one. Supported: mp4, webm, mov, m4v, mkv, gif, webp, png, jpg.",
			parameters: {
				path: {
					type: "string",
					required: true,
					description: "Absolute or workspace-relative path to the media file.",
				},
				label: {
					type: "string",
					description: "Optional caption rendered under the player.",
				},
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: true,
					properties: {
						url: { type: "string" },
						kind: { type: "string" },
						mime: { type: "string" },
						bytes: { type: "number" },
						path: { type: "string" },
						label: { type: "string" },
						error: { type: "string" },
					},
				},
				render(_args, value) {
					return [{ type: "text", text: JSON.stringify(value) }];
				},
			},
			isConcurrencySafe: () => true,
			async execute(args, exec) {
				const cwd = exec?.agent?.session?.header?.cwd ?? process.cwd();
				const abs = isAbsolute(args.path) ? args.path : resolvePath(cwd, args.path);
				const ext = extname(abs).toLowerCase();
				const mime = MIME[ext];
				if (mime === undefined) {
					return { error: `unsupported media extension "${ext || "(none)"}"; supported: ${Object.keys(MIME).join(", ")}` };
				}
				const st = await stat(abs).catch(() => null);
				if (st === null || !st.isFile()) {
					return { error: `media file not found: ${args.path}` };
				}
				const token = randomBytes(12).toString("hex");
				tokens.set(token, { abs, mime, bytes: st.size });
				return {
					url: `/dsh-media/${token}`,
					kind: mime.startsWith("video/") ? "video" : "image",
					mime,
					bytes: st.size,
					path: abs,
					label: typeof args.label === "string" ? args.label : "",
				};
			},
		}),
	);

	ctx.systemPrompt.section({
		name: "tool:media_show",
		order: 103,
		text: "To display a local video or animation inline in the chat player, call media_show with its file path (mp4/webm/mov/gif/webp/png/jpg). Prefer it over describing generated video contents in prose; the player card renders in the conversation.",
	});

	const webServer = ctx.get("webServer");
	const disposeRoute = webServer.register({
		kind: "prefix",
		path: "/dsh-media",
		async handler(req, res) {
			const pathname = new URL(req.url ?? "/", "http://internal").pathname;
			const token = decodeURIComponent(pathname.slice("/dsh-media/".length));
			const entry = tokens.get(token);
			if (entry === undefined) {
				res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
				res.end("media token unknown or expired (tokens die with the server process)");
				return;
			}
			const st = await stat(entry.abs).catch(() => null);
			if (st === null || !st.isFile()) {
				res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
				res.end("media file no longer exists");
				return;
			}
			const headers = {
				"content-type": entry.mime,
				"accept-ranges": "bytes",
				"cache-control": "no-store",
			};
			const range = req.headers.range;
			if (typeof range === "string" && range.startsWith("bytes=")) {
				const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
				const start = m && m[1] !== "" ? Number(m[1]) : 0;
				const end = m && m[2] !== "" ? Number(m[2]) : st.size - 1;
				if (m === null || Number.isNaN(start) || Number.isNaN(end) || start > end || end >= st.size) {
					res.writeHead(416, { "content-range": `bytes */${st.size}` });
					res.end();
					return;
				}
				res.writeHead(206, {
					...headers,
					"content-range": `bytes ${start}-${end}/${st.size}`,
					"content-length": String(end - start + 1),
				});
				createReadStream(entry.abs, { start, end }).pipe(res);
				return;
			}
			res.writeHead(200, { ...headers, "content-length": String(st.size) });
			createReadStream(entry.abs).pipe(res);
		},
	});

	return () => {
		disposeRoute();
		tokens.clear();
	};
}
