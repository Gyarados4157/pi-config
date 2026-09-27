import { chmod, copyFile, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

type Model = { provider: string; id: string };
type MagicContextConfig = {
  historian?: {
    pi?: { model?: unknown; thinking_level?: unknown; fallback_models?: unknown; [k: string]: unknown };
    [k: string]: unknown;
  };
  [k: string]: unknown;
};

type SyncOptions = {
  configPath?: string;
  backupRoot?: string;
};

const defaultConfigPath = join(
  process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
  "cortexkit",
  "magic-context.jsonc",
);
const defaultBackupRoot = join(homedir(), ".config-backups", "pi", "magic-context-model-sync");
const requireFromAgentPackages = createRequire(join(getAgentDir(), "npm", "package.json"));
const { parse, stringify } = requireFromAgentPackages("comment-json") as {
  parse: <T>(source: string) => T;
  stringify: (value: unknown, replacer: null, space: number) => string;
};

let syncQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = syncQueue.then(operation, operation);
  syncQueue = result.then(() => undefined, () => undefined);
  return result;
}

function modelKey(model: Model): string {
  return `${model.provider}/${model.id}`;
}

function backupName(): string {
  return `magic-context.jsonc.${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}.bak`;
}

async function writeAtomicallyWithBackup(
  targetPath: string,
  source: string,
  nextSource: string,
  backupRoot: string,
): Promise<void> {
  const before = await stat(targetPath);
  const latestSource = await readFile(targetPath, "utf8");
  if (latestSource !== source) {
    throw new Error("Magic Context 配置在同步期间发生变化；请重新执行 /sync-magic-model");
  }

  await mkdir(backupRoot, { recursive: true, mode: 0o700 });
  const lockPath = join(backupRoot, ".sync.lock");
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("Magic Context 配置同步正在进行；请稍后重试");
    }
    throw error;
  }

  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await lock.writeFile(`${process.pid}\n${new Date().toISOString()}\n`, "utf8");
    await lock.sync();
    await lock.close();
    lock = undefined;

    const lockedSource = await readFile(targetPath, "utf8");
    if (lockedSource !== source) {
      throw new Error("Magic Context 配置在同步期间发生变化；请重新执行 /sync-magic-model");
    }

    const backupPath = join(backupRoot, backupName());
    await copyFile(targetPath, backupPath);
    await chmod(backupPath, before.mode & 0o777);

    const handle = await open(tempPath, "wx", before.mode & 0o777);
    try {
      await handle.writeFile(nextSource, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tempPath, targetPath);
  } finally {
    await lock?.close().catch(() => undefined);
    await rm(tempPath, { force: true }).catch(() => undefined);
    await rm(lockPath, { force: true }).catch(() => undefined);
  }
}

export async function syncHistorianModel(
  model: Model,
  thinkingLevel: string | undefined,
  options: SyncOptions = {},
): Promise<boolean> {
  const targetPath = options.configPath ?? defaultConfigPath;
  const backupRoot = options.backupRoot ?? defaultBackupRoot;

  return enqueue(async () => {
    const source = await readFile(targetPath, "utf8");
    const config = parse<MagicContextConfig>(source);
    const historian = config.historian ?? (config.historian = {});
    const piConfig = historian.pi ?? (historian.pi = {});
    const nextModel = modelKey(model);
    const changed = piConfig.model !== nextModel || piConfig.thinking_level !== thinkingLevel;
    if (!changed) return false;

    piConfig.model = nextModel;
    if (thinkingLevel) piConfig.thinking_level = thinkingLevel;
    else delete piConfig.thinking_level;

    const nextSource = `${stringify(config, null, 2)}\n`;
    parse(nextSource);
    await writeAtomicallyWithBackup(targetPath, source, nextSource, backupRoot);
    return true;
  });
}

export default function magicContextModelSync(pi: ExtensionAPI) {
  pi.on("model_select", async (event, ctx) => {
    try {
      if (await syncHistorianModel(event.model, ctx.thinkingLevel)) {
        ctx.ui.notify(
          `Magic Context Historian 已同步至 ${modelKey(event.model)}；执行 /sync-magic-model 可立即重载。`,
          "info",
        );
      }
    } catch (error) {
      ctx.ui.notify(
        `无法同步 Magic Context Historian：${error instanceof Error ? error.message : String(error)}`,
        "warning",
      );
    }
  });

  pi.registerCommand("sync-magic-model", {
    description: "Sync Magic Context Historian with the current Pi model and reload",
    handler: async (_args, ctx: ExtensionContext) => {
      if (!ctx.model) {
        ctx.ui.notify("当前没有已选模型，未同步 Magic Context Historian。", "warning");
        return;
      }
      try {
        await syncHistorianModel(ctx.model, ctx.thinkingLevel);
        await ctx.reload();
      } catch (error) {
        ctx.ui.notify(
          `无法同步 Magic Context Historian：${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
      }
    },
  });
}
