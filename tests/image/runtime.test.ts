import { docker, removeContainer, startContainer, statusOf } from "./docker";

// Long enough for the assertions below to land inside the drain window.
const DRAIN_MS = 6_000;

describe("Container runtime", () => {
  it("Should run node as PID 1, so a signal reaches the application", async () => {
    const container = await startContainer();

    try {
      // Shell-form CMD would put /bin/sh here, and sh forwards nothing.
      const argv = (await docker(["exec", container, "cat", "/proc/1/cmdline"]))
        .split("\0")
        .filter(Boolean);

      expect(argv[0]).toBe("node");
      expect(argv[1]).toBe("dist/index.js");
    } finally {
      await removeContainer(container);
    }
  });

  // The container is started with DATABASE_URL pointing at a port nothing
  // listens on, which is the whole state /health exists not to report and
  // /ready exists to. It is also what a deploy gates on, so a release that
  // cannot reach its database fails the deploy instead of passing it.
  it("Should serve while reporting not ready with the database unreachable", async () => {
    const container = await startContainer();

    try {
      await expect(statusOf(container, "/health")).resolves.toBe(200);
      await expect(statusOf(container, "/ready")).resolves.toBe(503);
    } finally {
      await removeContainer(container);
    }
  });

  it("Should report unhealthy while still serving on SIGTERM, then exit cleanly", async () => {
    const container = await startContainer({
      SHUTDOWN_DRAIN_DELAY_MS: String(DRAIN_MS),
    });

    try {
      await expect(statusOf(container, "/health")).resolves.toBe(200);

      await docker(["kill", "-s", "TERM", container]);

      // Still answering: the point of the window is to keep serving in-flight
      // work while the load balancer stops sending new work.
      await expect(statusOf(container, "/health")).resolves.toBe(503);

      await expect(docker(["wait", container])).resolves.toBe("0");
    } finally {
      await removeContainer(container);
    }
  });
});
