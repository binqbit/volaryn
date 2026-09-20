"""Own one local PostgreSQL cluster; never connect to an ambient database URL."""

import os
from pathlib import Path
import socket
import subprocess

VERSION = "17.11"
ROOT = Path(__file__).resolve().parents[2]
LOCAL_PASSWORD = "volaryn-local"
ADMIN_PASSWORD = "volaryn-local-admin"


def free_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


class Cluster:
    def __init__(self, directory, port=None):
        self.directory = Path(directory).resolve()
        self.data = self.directory / "data"
        self.port = port or free_port()
        self.started = False
        self.admin_url = f"postgresql://postgres:{ADMIN_PASSWORD}@127.0.0.1:{self.port}/postgres"
        self.app_url = f"postgresql://volaryn:{LOCAL_PASSWORD}@127.0.0.1:{self.port}/volaryn"

    def run(self, command, *, env=None):
        with (self.directory / "commands.log").open("a") as output:
            subprocess.run(command, env=env, stdout=output, stderr=subprocess.STDOUT, check=True)

    def start(self):
        version = subprocess.check_output(["postgres", "--version"], text=True).strip()
        if version != f"postgres (PostgreSQL) {VERSION}":
            raise RuntimeError(f"Install PostgreSQL {VERSION}; found {version}")
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        if not (self.data / "PG_VERSION").exists():
            password = self.directory / "init-password"
            password.write_text(ADMIN_PASSWORD + "\n")
            password.chmod(0o600)
            try:
                self.run(
                    [
                        "initdb",
                        "-D",
                        str(self.data),
                        "-U",
                        "postgres",
                        "--encoding=UTF8",
                        "--no-locale",
                        "--data-checksums",
                        "--auth-local=trust",
                        "--auth-host=scram-sha-256",
                        f"--pwfile={password}",
                    ]
                )
            finally:
                password.unlink(missing_ok=True)
        elif (self.data / "PG_VERSION").read_text().strip() != "17":
            raise RuntimeError("The local cluster needs an explicit PostgreSQL major-version upgrade")
        # No shared system socket; all TCP access is loopback and uses SCRAM.
        self.run(
            [
                "pg_ctl",
                "-D",
                str(self.data),
                "-l",
                str(self.directory / "server.log"),
                "-o",
                f"-h 127.0.0.1 -p {self.port} -k ''",
                "-w",
                "-t",
                "30",
                "start",
            ]
        )
        self.started = True
        env = {
            **os.environ,
            "PGHOST": "127.0.0.1",
            "PGPORT": str(self.port),
            "PGUSER": "postgres",
            "PGPASSWORD": ADMIN_PASSWORD,
            "PGDATABASE": "postgres",
        }
        self.run(
            ["psql", "-X", "-v", "ON_ERROR_STOP=1", "-f", str(ROOT / "tools/postgres/init.sql")],
            env=env,
        )

    def environment(self, *, testing=False):
        env = {
            **os.environ,
            "DATABASE_URL": self.app_url,
            "PGHOST": "127.0.0.1",
            "PGPORT": str(self.port),
            "PGUSER": "volaryn",
            "PGPASSWORD": LOCAL_PASSWORD,
            "PGDATABASE": "volaryn",
        }
        env.pop("VOLARYN_TEST_DATABASE_URL", None)
        env.pop("VOLARYN_TEST_PGDATA", None)
        if testing:
            env["VOLARYN_TEST_DATABASE_URL"] = self.admin_url
            env["VOLARYN_TEST_PGDATA"] = str(self.data)
        return env

    def stop(self):
        if not self.started:
            return
        status = subprocess.run(
            ["pg_ctl", "-D", str(self.data), "status"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        if status.returncode == 0:
            self.run(
                [
                    "pg_ctl",
                    "-D",
                    str(self.data),
                    "-m",
                    "fast",
                    "-w",
                    "-t",
                    "30",
                    "stop",
                ]
            )
