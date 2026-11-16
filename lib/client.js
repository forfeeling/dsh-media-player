/* dsh-media-player — client half (browser bundle).
 * Hand-authored in the DSH client-module factory form (no build step):
 * the loader runs factory(require) once; require("react") resolves to the
 * shell's React instance. Registers a keyed `tool.call.toolview` renderer so
 * `media_show` tool calls render as a native <video>/<img> player card.
 */
window.__ModuleLoader__.load({
	id: "dsh-media-player",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		const react = require("react");
		const e = react.createElement;

		const CARD = {
			margin: "4px 0 6px",
			maxWidth: "100%",
		};
		const MEDIA = {
			maxWidth: "100%",
			maxHeight: "480px",
			borderRadius: "12px",
			background: "#000",
			display: "block",
		};
		const CAPTION = {
			fontSize: "12px",
			lineHeight: "18px",
			color: "var(--dsw-alias-label-secondary)",
			marginTop: "4px",
		};
		const META = {
			fontSize: "11px",
			lineHeight: "16px",
			color: "var(--dsw-alias-label-tertiary)",
			marginTop: "2px",
			overflowWrap: "anywhere",
		};

		function collectText(value, out) {
			if (value == null) return;
			if (typeof value === "string") {
				out.push(value);
				return;
			}
			if (Array.isArray(value)) {
				for (const part of value) collectText(part, out);
				return;
			}
			if (typeof value === "object") {
				if (typeof value.text === "string") out.push(value.text);
				if (value.content !== undefined) collectText(value.content, out);
			}
		}

		function flattenBlock(block) {
			const out = [];
			if (block == null) return "";
			collectText(block.content, out);
			collectText(block.resultView, out);
			collectText(block.text, out);
			return out.join("\n");
		}

		function extractInfo(text) {
			if (!text) return null;
			try {
				const obj = JSON.parse(text);
				if (obj && typeof obj.url === "string") return obj;
			} catch {
				/* fall through to regex salvage */
			}
			const m = text.match(/"url"\s*:\s*"(\/dsh-media\/[A-Za-z0-9_-]+)"/);
			if (m) return { url: m[1] };
			return null;
		}

		function fmtBytes(bytes) {
			if (typeof bytes !== "number" || !isFinite(bytes)) return "";
			if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
			return `${Math.round(bytes / 1024)} KB`;
		}

		function MediaRow(props) {
			const block = props && props.block;
			const info = extractInfo(flattenBlock(block));
			if (info === null || typeof info.url !== "string") {
				return e(
					"div",
					{ style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "12px", padding: "2px 4px" } },
					"media_show: result carries no playable URL",
				);
			}
			const isImage = info.kind === "image";
			const media = isImage
				? e("img", { src: info.url, alt: info.label || "media", style: MEDIA })
				: e("video", {
						src: info.url,
						controls: true,
						playsInline: true,
						preload: "metadata",
						style: MEDIA,
					});
			const size = fmtBytes(info.bytes);
			const metaBits = [isImage ? "image" : "video", info.mime, size].filter(Boolean);
			return e(
				"div",
				{ style: CARD, "data-dsh-media-player": "card" },
				media,
				info.label ? e("div", { style: CAPTION }, info.label) : null,
				e("div", { style: META }, metaBits.join(" · "), info.path ? ` · ${info.path}` : ""),
			);
		}

		function apply(ctx) {
			ctx.slots.inject("tool.call.toolview", () =>
				ctx.slots.register(
					{
						name: "tool.call.toolview",
						key: "media_show",
					},
					MediaRow,
				),
			);
		}

		const inject = ["slots"];

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
