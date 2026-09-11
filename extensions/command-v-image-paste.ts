import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createRequire } from "node:module";
import { realpathSync, appendFileSync, writeFileSync, unlinkSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Ghostty sends Cmd+V as a Kitty key event (super+v), not a terminal paste,
// so this extension only needs the shortcut path. The old onTerminalInput
// empty-paste state machine was removed: 4 real Cmd+V presses all arrived
// via super+v, zero via bracketed paste. If Ghostty ever changes behavior,
// set PI_PASTE_DEBUG=1 and watch /tmp/pi-paste.log for what's arriving.

// Compress clipboard PNGs before attaching: Telegram screenshots are ~1MB,
// which makes the editor re-layout on every keystroke feel sluggish.
// sips (macOS built-in) resizes long edge to 1600px + JPEG q80 -> ~150-250KB.
// Falls back to the raw bytes when sips is missing or fails.
const MAX_LONG_EDGE = 1600;
const DEBUG_LOG = "/tmp/pi-paste.log";
const VERBOSE = process.env.PI_PASTE_DEBUG === "1";

function debug(line: string): void {
	if (!VERBOSE) return;
	try {
		appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${line}\n`);
	} catch {
		// ignore logging errors
	}
}

async function compressImage(bytes: Uint8Array, mimeType: string): Promise<{ filePath: string; size: number }> {
	const raw = Buffer.from(bytes);
	const rawExt = mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : "png";
	if (raw.length < 300 * 1024) {
		const filePath = join(tmpdir(), `pi-clipboard-${randomUUID()}.${rawExt}`);
		writeFileSync(filePath, raw);
		return { filePath, size: raw.length };
	}
	try {
		const src = join(tmpdir(), `pi-clipboard-src-${randomUUID()}.png`);
		const dst = join(tmpdir(), `pi-clipboard-${randomUUID()}.jpg`);
		writeFileSync(src, raw);
		await execFileAsync("sips", ["-Z", String(MAX_LONG_EDGE), "-s", "format", "jpeg", "-s", "formatOptions", "80", src, "--out", dst]);
		const size = statSync(dst).size;
		debug(`compress: ${raw.length} -> ${size} bytes`);
		try { unlinkSync(src); } catch { /* ignore */ }
		if (size === 0 || size >= raw.length) {
			try { unlinkSync(dst); } catch { /* ignore */ }
			const filePath = join(tmpdir(), `pi-clipboard-${randomUUID()}.png`);
			writeFileSync(filePath, raw);
			return { filePath, size: raw.length };
		}
		return { filePath: dst, size };
	} catch (err) {
		debug(`compress failed, using raw: ${err instanceof Error ? err.message : String(err)}`);
		const filePath = join(tmpdir(), `pi-clipboard-${randomUUID()}.png`);
		writeFileSync(filePath, raw);
		return { filePath, size: raw.length };
	}
}

type ClipboardImage = { bytes: Uint8Array; mimeType: string } | undefined;

let readerCache: (() => Promise<ClipboardImage>) | null | undefined = undefined;

function loadClipboardReader(): (() => Promise<ClipboardImage>) | undefined {
	// Cache the resolved reader (including the miss): createRequire + realpath
	// on every Cmd+V is pointless, the module never moves at runtime.
	if (readerCache !== undefined) return readerCache ?? undefined;
	try {
		// ~/.local/bin/pi is a symlink; realpath to dist/bundle/cli.js, so the
		// relative require base is dist/bundle/ -> ../utils/*.js.
		const realArgv1 = realpathSync(process.argv[1]);
		const req = createRequire(realArgv1);
		const mod = req("../utils/clipboard-image.js") as {
			readClipboardImage?: () => Promise<ClipboardImage>;
		};
		if (typeof mod.readClipboardImage === "function") {
			readerCache = mod.readClipboardImage;
			return readerCache;
		}
		debug("clipboard-image.js loaded but no readClipboardImage export");
	} catch (err) {
		debug(`loadClipboardReader failed: ${err instanceof Error ? err.message : String(err)}`);
	}
	readerCache = null;
	return undefined;
}

async function pasteImageFromClipboard(ctx: ExtensionContext): Promise<boolean> {
	const readClipboardImage = loadClipboardReader();
	if (!readClipboardImage) {
		ctx.ui.notify("Cmd+V: clipboard unavailable", "warning");
		return false;
	}
	let image: ClipboardImage;
	try {
		image = await readClipboardImage();
	} catch (err) {
		debug(`readClipboardImage threw: ${err instanceof Error ? err.message : String(err)}`);
		ctx.ui.notify("Cmd+V: clipboard read failed", "warning");
		return false;
	}
	debug(`readClipboardImage -> ${image ? `image bytes=${image.bytes.length} mime=${image.mimeType}` : "no image"}`);
	if (!image) {
		// No image on clipboard: fall back to plain text paste.
		const req = createRequire(realpathSync(process.argv[1]));
		try {
			const clip = req("../utils/clipboard.js") as { readClipboardText?: () => Promise<string> };
			const text = await clip.readClipboardText?.();
			if (text) {
				ctx.ui.pasteToEditor(text);
				return true;
			}
		} catch (err) {
			debug(`readClipboardText threw: ${err instanceof Error ? err.message : String(err)}`);
		}
		ctx.ui.notify("Cmd+V: clipboard has no image or text", "info");
		return false;
	}
	try {
		const { filePath, size } = await compressImage(image.bytes, image.mimeType);
		ctx.ui.pasteToEditor(filePath);
		// pasteToEditor goes through handleInput but doesn't request a render,
		// so the path stays invisible until the next keystroke. setStatus()
		// calls ui.requestRender() internally — set then clear to force a
		// repaint with no visible residue.
		ctx.ui.setStatus("cmdv-paste", "pasted");
		ctx.ui.setStatus("cmdv-paste", undefined);
		debug(`wrote ${filePath} (${size} bytes), pasted to editor`);
		return true;
	} catch (err) {
		debug(`write/paste failed: ${err instanceof Error ? err.message : String(err)}`);
		ctx.ui.notify("Cmd+V: failed to attach image", "error");
		return false;
	}
}

export default function (pi: ExtensionAPI): void {
	// Ghostty/Kitty delivers Cmd+V as a super+v key event. The default
	// pasteImage binding (ctrl+v) stays untouched.
	pi.registerShortcut("super+v", {
		description: "Paste image from clipboard (Cmd+V)",
		handler: async (ctx) => {
			debug("super+v shortcut fired -> pasteImageFromClipboard");
			await pasteImageFromClipboard(ctx as unknown as ExtensionContext);
		},
	});
}
