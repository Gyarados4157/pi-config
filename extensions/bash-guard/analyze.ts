import { parse as shellParse } from "shell-quote";

export type Severity = "high" | "medium";

export type Risk = {
	severity: Severity;
	reasons: string[];
};

type OpToken = { op: string; [k: string]: unknown };

type Token = string | OpToken;

function isOpToken(t: Token): t is OpToken {
	return typeof t === "object" && t !== null && "op" in t;
}

function tokensToStrings(tokens: Token[]): string[] {
	return tokens.filter((t) => typeof t === "string") as string[];
}

function splitOnOps(tokens: Token[], splitOps: string[]): Token[][] {
	const out: Token[][] = [];
	let current: Token[] = [];
	for (const t of tokens) {
		if (isOpToken(t) && splitOps.includes(t.op)) {
			if (current.length) out.push(current);
			current = [];
			continue;
		}
		current.push(t);
	}
	if (current.length) out.push(current);
	return out;
}

function hasFlag(args: string[], flag: string): boolean {
	return args.includes(flag) || args.some((a) => a.startsWith(flag) && flag.length === 2 && a.startsWith("-"));
}

function anyArgStartsWith(args: string[], prefix: string): boolean {
	return args.some((a) => a.startsWith(prefix));
}

function nextString(tokens: Token[], i: number): string | undefined {
	const next = tokens[i + 1];
	return typeof next === "string" ? next : undefined;
}

function isBenignRedirectTarget(target: string | undefined): boolean {
	if (!target) return false;
	if (target === "/dev/null" || target === "/dev/stdout" || target === "/dev/stderr") return true;
	if (target.startsWith("/dev/fd/")) return true;
	// Agent scratch files. Overwriting /tmp is not the class of damage this guard is for.
	if (target === "/tmp" || target.startsWith("/tmp/")) return true;
	return false;
}

function stripHeredocBodies(command: string): string {
	// shell-quote does not treat heredoc bodies as data, so `if 1 > 0:` inside
	// `python3 <<'PY'` is parsed as a file redirect. Drop the body first.
	return command.replace(
		/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?^\2\s*$/gm,
		(full) => full.split("\n", 1)[0] ?? full,
	);
}

function gitSubcommand(rest: string[]): { sub: string | undefined; subArgs: string[] } {
	let i = 0;
	while (i < rest.length) {
		const a = rest[i];
		if (a === "--") {
			i += 1;
			break;
		}
		if (a === "-C" || a === "-c" || a === "--git-dir" || a === "--work-tree" || a === "--namespace") {
			i += 2;
			continue;
		}
		if (a.startsWith("--git-dir=") || a.startsWith("--work-tree=") || a.startsWith("--namespace=")) {
			i += 1;
			continue;
		}
		if (a.startsWith("-")) {
			i += 1;
			continue;
		}
		break;
	}
	return { sub: rest[i], subArgs: rest.slice(i + 1) };
}

function isFdDupTarget(target: string | undefined): boolean {
	return target === "-" || (typeof target === "string" && /^\d+$/.test(target));
}

function analyzeSegment(seg: Token[]): Risk | null {
	const reasons: string[] = [];
	let severity: Severity = "medium";

	const ops = seg.filter(isOpToken).map((o) => o.op);
	const args = tokensToStrings(seg);
	if (args.length === 0) return null;

	const cmd = args[0];
	const rest = args.slice(1);

	// Dangerous pipes (curl|sh, pipe-to-shell) stay per-segment. Generic `|` is not flagged.
	if (ops.includes("|") && (args.includes("sh") || args.includes("bash") || args.includes("zsh") || args.includes("fish"))) {
		reasons.push("pipe to a shell (possible remote code execution)");
		severity = "high";
	}

	// sudo
	if (cmd === "sudo") {
		reasons.push("sudo (elevated privileges)");
		severity = "high";
	}

	// rm/rmdir/unlink
	if (cmd === "rm" || cmd === "rmdir" || cmd === "unlink") {
		severity = "high";
		reasons.push(`${cmd} (file deletion)`);
		if (rest.some((a) => a.includes("-r") || a.includes("-R"))) reasons.push("recursive delete (-r/-R)");
		if (rest.some((a) => a.includes("-f"))) reasons.push("forced delete (-f)");
		if (ops.includes("glob")) reasons.push("glob pattern expansion (may delete many files)");
	}

	// find -delete
	if (cmd === "find" && rest.includes("-delete")) {
		severity = "high";
		reasons.push("find -delete (bulk deletion)");
	}

	// git: only mutating / destructive subs. status/diff/log/show/grep pass through.
	if (cmd === "git") {
		const { sub, subArgs } = gitSubcommand(rest);

		if (sub === "rm") {
			severity = "high";
			reasons.push("git rm (deletes files from working tree and stages deletions)");
		}
		if (sub === "clean" && (subArgs.some((a) => a.includes("-f")) || subArgs.includes("-d") || subArgs.includes("-x"))) {
			severity = "high";
			reasons.push("git clean (can delete untracked files)");
		}
		if (sub === "reset") {
			if (subArgs.includes("--hard")) {
				severity = "high";
				reasons.push("git reset --hard (discard changes)");
			} else {
				severity = severity === "high" ? "high" : "medium";
				reasons.push("git reset (moves HEAD; can drop commits)");
			}
		}
		if ((sub === "checkout" || sub === "restore") && (subArgs.includes(".") || subArgs.includes("--") || subArgs.includes("--source"))) {
			severity = severity === "high" ? "high" : "medium";
			reasons.push("git checkout/restore (can overwrite working tree)");
		}
		if (sub === "push") {
			if (subArgs.includes("--force") || subArgs.includes("--force-with-lease") || subArgs.includes("-f")) {
				severity = "high";
				reasons.push("git push --force (rewrite remote history)");
			} else {
				severity = severity === "high" ? "high" : "medium";
				reasons.push("git push (updates remote)");
			}
		}
		if (sub === "pull" || sub === "merge" || sub === "rebase" || sub === "commit") {
			severity = severity === "high" ? "high" : "medium";
			reasons.push(`git ${sub} (mutates repository)`);
		}
		if (sub === "branch" && subArgs.some((a) => a === "-D" || a === "-d" || a === "--delete")) {
			severity = severity === "high" ? "high" : "medium";
			reasons.push("git branch -d (deletes a branch)");
		}
		if (sub === "worktree" && (subArgs[0] === "remove" || subArgs[0] === "prune")) {
			severity = severity === "high" ? "high" : "medium";
			reasons.push(`git worktree ${subArgs[0]}`);
		}
		if (sub === "reflog" && subArgs.includes("expire")) {
			severity = "high";
			reasons.push("git reflog expire (can remove recovery history)");
		}
		if (sub === "gc" && subArgs.some((a) => a.startsWith("--prune"))) {
			severity = "high";
			reasons.push("git gc --prune (can permanently delete objects)");
		}
	}

	// truncate
	if (cmd === "truncate") {
		severity = severity === "high" ? "high" : "medium";
		reasons.push("truncate (in-place size change, can erase contents)");
	}

	// dd of=
	if (cmd === "dd" && (anyArgStartsWith(rest, "of=") || rest.includes("of"))) {
		severity = "high";
		reasons.push("dd with output file/device (can overwrite data)");
	}

	// Disk / volume management (prompt aggressively; high risk)
	// Linux: mkfs.*, wipefs, parted, fdisk, gdisk/sgdisk, lsblk, cryptsetup, LVM tools, zpool
	// macOS: diskutil, hdiutil, gpt, newfs_*, asr
	if (cmd.startsWith("mkfs")) {
		severity = "high";
		reasons.push("mkfs (filesystem formatting)");
	}
	if (cmd.startsWith("newfs_")) {
		severity = "high";
		reasons.push("newfs_* (filesystem formatting)");
	}
	if (cmd === "wipefs") {
		severity = "high";
		reasons.push("wipefs (disk signature wipe)");
	}
	if (cmd === "diskutil") {
		severity = "high";
		reasons.push("diskutil (disk management command)");
		if (rest.includes("eraseDisk") || rest.includes("eraseVolume")) {
			reasons.push("diskutil erase (destructive disk operation)");
		}
	}
	if (cmd === "hdiutil") {
		severity = "high";
		reasons.push("hdiutil (disk image management command)");
	}
	if (cmd === "gpt") {
		severity = "high";
		reasons.push("gpt (partition table manipulation)");
	}
	if (cmd === "asr") {
		severity = "high";
		reasons.push("asr (Apple Software Restore; can overwrite volumes)");
	}
	if (cmd === "parted" || cmd === "fdisk" || cmd === "gdisk" || cmd === "sgdisk") {
		severity = "high";
		reasons.push(`${cmd} (disk/partition management)`);
	}
	if (cmd === "lsblk") {
		// Usually read-only, but still disk-related; prompt as requested.
		severity = severity === "high" ? "high" : "medium";
		reasons.push("lsblk (disk listing)");
	}
	if (cmd === "cryptsetup") {
		severity = "high";
		reasons.push("cryptsetup (disk encryption management)");
	}
	if (cmd === "pvcreate" || cmd === "vgcreate" || cmd === "lvcreate") {
		severity = "high";
		reasons.push(`${cmd} (LVM volume management)`);
	}
	if (cmd === "zpool") {
		severity = "high";
		reasons.push("zpool (ZFS pool management)");
	}

	// chmod/chown recursive
	if (cmd === "chmod" && (rest.includes("-R") || rest.includes("--recursive"))) {
		severity = severity === "high" ? "high" : "medium";
		reasons.push("chmod -R (recursive permission changes)");
	}
	if (cmd === "chown" && (rest.includes("-R") || rest.includes("--recursive"))) {
		severity = severity === "high" ? "high" : "medium";
		reasons.push("chown -R (recursive ownership changes)");
	}

	// mv/cp overwriting
	if (cmd === "mv" && (rest.includes("-f") || rest.includes("--force"))) {
		severity = severity === "high" ? "high" : "medium";
		reasons.push("mv --force/-f (can overwrite files)");
	}
	if (cmd === "cp" && (rest.includes("-f") || rest.includes("--force"))) {
		severity = severity === "high" ? "high" : "medium";
		reasons.push("cp --force/-f (can overwrite files)");
	}

	// sed/perl in-place
	if (cmd === "sed" && (hasFlag(rest, "-i") || rest.includes("--in-place"))) {
		severity = severity === "high" ? "high" : "medium";
		reasons.push("sed -i (in-place file modification)");
	}
	if (cmd === "perl" && (rest.includes("-pi") || (rest.includes("-p") && rest.includes("-i")))) {
		severity = severity === "high" ? "high" : "medium";
		reasons.push("perl -pi/-i (in-place file modification)");
	}

	// kill/shutdown/systemctl
	if (cmd === "kill" || cmd === "pkill" || cmd === "killall") {
		severity = severity === "high" ? "high" : "medium";
		reasons.push(`${cmd} (process termination)`);
		if (rest.includes("-9")) {
			severity = "high";
			reasons.push("SIGKILL (-9)");
		}
	}
	if (cmd === "shutdown" || cmd === "reboot") {
		severity = "high";
		reasons.push(`${cmd} (system power operation)`);
	}
	if (cmd === "systemctl" && (rest.includes("stop") || rest.includes("disable"))) {
		severity = severity === "high" ? "high" : "medium";
		reasons.push("systemctl stop/disable (service disruption)");
	}

	// Remote execution patterns
	if ((cmd === "curl" || cmd === "wget") && ops.includes("|")) {
		severity = "high";
		reasons.push("curl/wget piped (possible remote code execution)");
	}

	// Infra deletes
	if (cmd === "kubectl" && rest[0] === "delete") {
		severity = "high";
		reasons.push("kubectl delete (resource deletion)");
	}
	if (cmd === "terraform" && rest[0] === "destroy") {
		severity = "high";
		reasons.push("terraform destroy (infrastructure teardown)");
	}
	if (cmd === "aws" && rest[0] === "s3" && rest[1] === "rm" && rest.includes("--recursive")) {
		severity = "high";
		reasons.push("aws s3 rm --recursive (bulk deletion)");
	}
	if (cmd === "gcloud" && rest.includes("delete")) {
		severity = "high";
		reasons.push("gcloud delete (resource deletion)");
	}

	if (reasons.length === 0) return null;
	return { severity, reasons };
}

function hasFileOverwriteRedirect(tokens: Token[]): boolean {
	for (let i = 0; i < tokens.length; i++) {
		const t = tokens[i];
		if (!isOpToken(t)) continue;
		const target = nextString(tokens, i);
		if (t.op === ">" || t.op === ">>") {
			if (!isBenignRedirectTarget(target)) return true;
		} else if (t.op === ">&") {
			// `2>&1` is fd duplication. `>& file` redirects stdout+stderr onto a file.
			if (!isFdDupTarget(target) && !isBenignRedirectTarget(target)) return true;
		}
	}
	return false;
}

export function analyzeBashCommand(command: string): Risk | null {
	let tokens: Token[];
	try {
		tokens = shellParse(stripHeredocBodies(command)) as Token[];
	} catch {
		// Bash-isms like `${var#prefix}` make shell-quote throw. Don't prompt
		// just because we couldn't parse — only if the raw text still looks destructive.
		if (
			/\b(rm|sudo|mkfs|wipefs|shutdown|reboot)\b/.test(command) ||
			/\b(curl|wget)\b[^#\n]*\|\s*(ba?sh|zsh|fish|dash|sh)\b/.test(command) ||
			/\bgit\s+(reset\s+--hard|clean\s+-[a-zA-Z]*f|push\s+--force)\b/.test(command)
		) {
			return { severity: "medium", reasons: ["unparsed shell command (unable to analyze safely)"] };
		}
		return null;
	}

	const reasons: string[] = [];
	let severity: Severity = "medium";

	// Whole-command operator checks. Generic `|` is not flagged — `grep | head`
	// is routine. Dangerous pipes (curl|sh, pipe-to-shell) are caught per-segment.
	// `>/dev/null` and `2>&1` are not file overwrites.
	if (hasFileOverwriteRedirect(tokens)) {
		reasons.push("shell output redirection (can overwrite files)");
		severity = severity === "high" ? "high" : "medium";
	}

	// Segment analysis (split on &&, ||, ;)
	const segments = splitOnOps(tokens, ["&&", "||", ";"]);
	for (const seg of segments) {
		const segRisk = analyzeSegment(seg);
		if (!segRisk) continue;
		if (segRisk.severity === "high") severity = "high";
		for (const r of segRisk.reasons) reasons.push(r);
	}

	// De-duplicate reasons
	const uniq = [...new Set(reasons)];
	if (uniq.length === 0) return null;
	return { severity, reasons: uniq };
}
