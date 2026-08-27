import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

// CI builds and tags by commit SHA; locally `npm run image:build` writes this.
export const IMAGE = process.env.IMAGE_TAG ?? "scheduling-manager:test";

// Asked from inside the container, so these tests do not depend on the host
// being able to reach a published port.
const probeFor = (path: string) =>
  `fetch("http://127.0.0.1:4000${path}").then((r) => console.log(r.status))`;

export async function docker(args: string[]): Promise<string> {
  const { stdout } = await exec("docker", args);
  return stdout.trim();
}

/** Runs a one-off command in a throwaway container, replacing the image's CMD. */
export function inspectImage(command: string[]): Promise<string> {
  return docker(["run", "--rm", IMAGE, ...command]);
}

/**
 * Starts the image with its own CMD and waits until it serves. No database is
 * provided: the pool connects lazily, so the server comes up without one.
 */
export async function startContainer(
  env: Record<string, string> = {},
): Promise<string> {
  const variables = {
    DATABASE_URL: "postgresql://unused:unused@127.0.0.1:5432/unused",
    ...env,
  };

  const flags = Object.entries(variables).flatMap(([key, value]) => [
    "-e",
    `${key}=${value}`,
  ]);

  const container = await docker(["run", "-d", ...flags, IMAGE]);
  await waitFor(async () => (await statusOf(container, "/health")) === 200);

  return container;
}

export async function statusOf(
  container: string,
  path: string,
): Promise<number> {
  return Number(
    await docker(["exec", container, "node", "-e", probeFor(path)]),
  );
}

export async function removeContainer(container: string): Promise<void> {
  await docker(["rm", "-f", container]).catch(() => undefined);
}

async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await condition().catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Container did not start serving within ${timeoutMs}ms`);
}
