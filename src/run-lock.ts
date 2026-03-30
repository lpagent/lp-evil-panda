import { openSync, writeFileSync, readFileSync, unlinkSync, closeSync } from "fs";

type LockInfo = {
  owner: string;
  pid: number;
  createdAt: number;
  token: string;
};

const LOCK_FILE = ".openclaw-orchestrator.lock";

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readLockInfo(): LockInfo | null {
  try {
    const raw = readFileSync(LOCK_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<LockInfo>;
    if (
      typeof parsed.owner === "string" &&
      typeof parsed.pid === "number" &&
      typeof parsed.createdAt === "number" &&
      typeof parsed.token === "string"
    ) {
      return parsed as LockInfo;
    }
    return null;
  } catch {
    return null;
  }
}

function tryAcquire(owner: string): LockInfo {
  const lockInfo: LockInfo = {
    owner,
    pid: process.pid,
    createdAt: Date.now(),
    token: `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  };

  const fd = openSync(LOCK_FILE, "wx");
  try {
    writeFileSync(fd, JSON.stringify(lockInfo, null, 2));
  } finally {
    closeSync(fd);
  }

  return lockInfo;
}

function acquireLock(owner: string): LockInfo {
  try {
    return tryAcquire(owner);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") throw err;

    const existing = readLockInfo();
    if (existing && isPidAlive(existing.pid)) {
      throw new Error(`Another orchestration run is active (${existing.owner}, pid=${existing.pid})`);
    }

    try {
      unlinkSync(LOCK_FILE);
    } catch {
      // no-op
    }

    return tryAcquire(owner);
  }
}

function releaseLock(lockInfo: LockInfo): void {
  const existing = readLockInfo();
  if (!existing || existing.token !== lockInfo.token) return;
  try {
    unlinkSync(LOCK_FILE);
  } catch {
    // no-op
  }
}

export async function withRunLock<T>(owner: string, fn: () => Promise<T>): Promise<T> {
  const lock = acquireLock(owner);
  try {
    return await fn();
  } finally {
    releaseLock(lock);
  }
}
