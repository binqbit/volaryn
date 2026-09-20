#!/usr/bin/env python3
"""Run checks against a fresh, owned PostgreSQL cluster and retain failure evidence."""

from pathlib import Path
import signal
import subprocess
import sys
import tempfile

from cluster import Cluster, ROOT

if len(sys.argv) < 2:
    raise SystemExit("Usage: tools/postgres/with-test-db.py COMMAND [ARG...]")
artifacts = ROOT / "artifacts/postgres"
artifacts.mkdir(parents=True, exist_ok=True)
directory = Path(tempfile.mkdtemp(prefix="run-", dir=artifacts))
print(f"PostgreSQL test artifacts: {directory}", flush=True)
cluster = Cluster(directory)
child = None


def terminate(signum, _frame):
    if child is not None:
        child.send_signal(signum)


for sig in (signal.SIGINT, signal.SIGTERM):
    signal.signal(sig, terminate)
try:
    cluster.start()
    child = subprocess.Popen(sys.argv[1:], cwd=ROOT, env=cluster.environment(testing=True))
    raise SystemExit(child.wait())
finally:
    cluster.stop()
