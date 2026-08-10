import {
  docker,
  healthStatus,
  removeContainer,
  startContainer,
} from "./docker";

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

  it("Should report unhealthy while still serving on SIGTERM, then exit cleanly", async () => {
    const container = await startContainer({
      SHUTDOWN_DRAIN_DELAY_MS: String(DRAIN_MS),
    });

    try {
      await expect(healthStatus(container)).resolves.toBe(200);

      await docker(["kill", "-s", "TERM", container]);

      // Still answering: the point of the window is to keep serving in-flight
      // work while the load balancer stops sending new work.
      await expect(healthStatus(container)).resolves.toBe(503);

      await expect(docker(["wait", container])).resolves.toBe("0");
    } finally {
      await removeContainer(container);
    }
  });
});
