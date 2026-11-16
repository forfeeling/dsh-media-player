/**
 * Unit-level validation for dsh-media-player without touching the live GUI:
 *  - host: tool registration, execute() minting, route handler (200/206/404)
 *  - client: factory form, toolview registration, MediaRow element tree
 */
import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PLUGIN = new URL("..", import.meta.url).pathname.replace(/%20/g, " ").replace(/\/$/, "");
let MEDIA = process.env.MEDIA_FILE ?? "/home/ubuntu/新想法/test_cat_video.mp4";
if (!existsSync(MEDIA)) {
	// Synthesize a 1s clip so the suite runs on any machine with ffmpeg.
	MEDIA = join(tmpdir(), "dsh-media-player-test.mp4");
	execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=10:duration=1", MEDIA]);
}

// ── host half ────────────────────────────────────────────────────────────────
const registered = { tools: [], sections: [], routes: [] };
const ctxStub = {
	tools: { register: (t) => registered.tools.push(t) },
	systemPrompt: { section: (s) => registered.sections.push(s) },
	get: (svc) => {
		assert.equal(svc, "webServer");
		return { register: (r) => { registered.routes.push(r); return () => {}; } };
	},
};
const host = await import(`${PLUGIN}/lib/index.js`);
assert.equal(host.name, "dsh-media-player");
const dispose = host.apply(ctxStub);
assert.equal(registered.tools.length, 1);
assert.equal(registered.routes.length, 1);
assert.equal(registered.sections.length, 1);
const tool = registered.tools[0];
assert.equal(tool.name, "media_show");

const execStub = { agent: { session: { header: { cwd: "/home/ubuntu/新想法" } } } };
const outcome = await tool.execute({ path: "test_cat_video.mp4" }, execStub);
assert.equal(outcome.kind, "video");
assert.match(outcome.url, /^\/dsh-media\/[0-9a-f]{24}$/);
assert.equal(outcome.mime, "video/mp4");
const bad = await tool.execute({ path: "nope.xyz" }, execStub);
assert.match(bad.error, /unsupported media extension/);
const missing = await tool.execute({ path: "missing.mp4" }, execStub);
assert.match(missing.error, /not found/);

function mockRes() {
	const chunks = [];
	const res = new Writable({ write(c, _e, cb) { chunks.push(c); cb(); } });
	res.statusCode = null;
	res.headers = null;
	res.writeHead = (code, headers) => { res.statusCode = code; res.headers = headers ?? {}; return res; };
	res.chunks = chunks;
	return res;
}
const route = registered.routes[0];
assert.equal(route.kind, "prefix");
assert.equal(route.path, "/dsh-media");
const token = outcome.url.slice("/dsh-media/".length);

// 200 full body
{
	const res = mockRes();
	await route.handler({ url: `/dsh-media/${token}`, headers: {} }, res);
	await new Promise((r) => res.on("finish", r));
	assert.equal(res.statusCode, 200);
	assert.equal(res.headers["content-type"], "video/mp4");
	assert.equal(res.headers["accept-ranges"], "bytes");
	const size = Buffer.concat(res.chunks).length;
	assert.equal(size, outcome.bytes);
}
// 206 range
{
	const res = mockRes();
	await route.handler({ url: `/dsh-media/${token}`, headers: { range: "bytes=0-99" } }, res);
	await new Promise((r) => res.on("finish", r));
	assert.equal(res.statusCode, 206);
	assert.equal(Buffer.concat(res.chunks).length, 100);
	assert.match(res.headers["content-range"], /^bytes 0-99\//);
}
// 416 bad range
{
	const res = mockRes();
	await route.handler({ url: `/dsh-media/${token}`, headers: { range: "bytes=999999999-" } }, res);
	await new Promise((r) => res.on("finish", r));
	assert.equal(res.statusCode, 416);
}
// 404 unknown token
{
	const res = mockRes();
	await route.handler({ url: "/dsh-media/deadbeefdeadbeefdeadbeef", headers: {} }, res);
	await new Promise((r) => res.on("finish", r));
	assert.equal(res.statusCode, 404);
}
// output.render shape (model-facing content)
const presented = tool.output.render({}, outcome);
assert.equal(presented[0].type, "text");
assert.match(presented[0].text, /\/dsh-media\//);
dispose();

// ── client half ──────────────────────────────────────────────────────────────
let loaded = null;
globalThis.window = { __ModuleLoader__: { load: (m) => { loaded = m; } } };
const code = readFileSync(`${PLUGIN}/lib/client.js`, "utf8");
(0, eval)(code);
assert.equal(loaded.id, "dsh-media-player");

const elements = [];
const reactStub = {
	createElement: (type, props, ...children) => {
		const el = { type, props: props ?? {}, children: children.flat().filter((c) => c != null) };
		elements.push(el);
		return el;
	},
};
const clientExports = loaded.factory((spec) => {
	assert.equal(spec, "react");
	return reactStub;
});
let registration = null;
const ctxClient = {
	slots: {
		inject: (slotName, fn) => { assert.equal(slotName, "tool.call.toolview"); fn(); },
		register: (desc, comp) => { registration = { desc, comp }; return () => {}; },
	},
};
clientExports.apply(ctxClient);
assert.equal(registration.desc.name, "tool.call.toolview");
assert.equal(registration.desc.key, "media_show");

const block = {
	content: [{ type: "text", text: JSON.stringify({ url: outcome.url, kind: "video", mime: "video/mp4", bytes: outcome.bytes, path: MEDIA, label: "太空猫" }) }],
};
const card = registration.comp({ callId: "c1", toolName: "media_show", block });
assert.equal(card.type, "div");
const video = card.children.find((c) => c.type === "video");
assert.ok(video, "video element rendered");
assert.equal(video.props.src, outcome.url);
assert.equal(video.props.controls, true);
// image kind
const imgBlock = { content: [{ type: "text", text: JSON.stringify({ url: "/dsh-media/aa", kind: "image", mime: "image/webp", bytes: 10 }) }] };
const imgCard = registration.comp({ block: imgBlock });
assert.ok(imgCard.children.some((c) => c.type === "img"));
// no-url fallback
const deadCard = registration.comp({ block: { content: [{ type: "text", text: "nothing here" }] } });
assert.ok(deadCard.children.length === 0 || deadCard.type === "div");

console.log("ALL UNIT CHECKS PASSED");
console.log("  tool:", tool.name, "| route:", route.path, "| token url:", outcome.url);
