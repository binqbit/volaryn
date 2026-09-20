#!/usr/bin/env python3
"""Run the native demo with persistent, exclusively owned local database storage."""

import fcntl
import signal
import subprocess
import sys

from cluster import Cluster, ROOT

if len(sys.argv) < 2:
    raise SystemExit("Usage: tools/postgres/with-local-db.py COMMAND [ARG...]")
directory = ROOT / "target/localnet/postgres"
directory.mkdir(parents=True, exist_ok=True, mode=0o700)
child = None


def terminate(signum, _frame):
    if child is not None:
        child.send_signal(signum)
    else:
        raise SystemExit(128 + signum)


with (directory / "runner.lock").open("w") as lock:
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise SystemExit("The native localnet is already running") from None
    cluster = Cluster(directory)
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, terminate)
    try:
        cluster.start()
        child = subprocess.Popen(sys.argv[1:], cwd=ROOT, env=cluster.environment())
        raise SystemExit(child.wait())
    finally:
        cluster.stop()
