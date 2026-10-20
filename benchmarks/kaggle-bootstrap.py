"""Run the real phase-1 baseline in a Kaggle CPU kernel, from a verified archive."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import socket
import subprocess
import sys
import tarfile
import time
import urllib.request
import uuid


WORKING = Path("/kaggle/working")
SOURCE = WORKING / "online-exam-api"
TOOLS = WORKING / ".online-exam-baseline-tools"
RESULTS = WORKING / "phase1-baseline-results"
NODE_VERSION = "24.12.0"
MONGO_VERSION = "8.0.30"
K6_VERSION = "1.6.1"
PINNED = {
    "node": {
        "url": f"https://nodejs.org/dist/v{NODE_VERSION}/node-v{NODE_VERSION}-linux-x64.tar.xz",
        "checksums": f"https://nodejs.org/dist/v{NODE_VERSION}/SHASUMS256.txt",
        "sha256": "bdebee276e58d0ef5448f3d5ac12c67daa963dd5e0a9bb621a53d1cefbc852fd",
        "binary": f"node-v{NODE_VERSION}-linux-x64/bin/node",
    },
    "mongo": {
        "url": f"https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-ubuntu2204-{MONGO_VERSION}.tgz",
        "checksums": f"https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-ubuntu2204-{MONGO_VERSION}.tgz.sha256",
        "sha256": "bf8e0c3bb277d04c47b1d7aad15a47e4b7e0c660e3cce976ed64054abc88cbea",
        "binary": f"mongodb-linux-x86_64-ubuntu2204-{MONGO_VERSION}/bin/mongod",
    },
    "k6": {
        "url": f"https://github.com/grafana/k6/releases/download/v{K6_VERSION}/k6-v{K6_VERSION}-linux-amd64.tar.gz",
        "checksums": f"https://github.com/grafana/k6/releases/download/v{K6_VERSION}/k6-v{K6_VERSION}-checksums.txt",
        "sha256": "68df4958a1b089dc6f70a234e07c7ec818922f83b261ca24f3abf79882b13343",
        "binary": f"k6-v{K6_VERSION}-linux-amd64/k6",
    },
}
ROOT_FILES = {
    "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json",
    "nest-cli.json", "prisma.config.ts", "Dockerfile", "docker-compose.yml", ".env.example",
}
EXCLUDED_BENCHMARK_DIRS = {".generated", ".tools", "results", "__pycache__", ".pytest_cache"}


def sha256_file(filename: Path) -> str:
    digest = hashlib.sha256()
    with filename.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def required_archive_sha(archive: Path, value: str | None) -> str:
    if not value:
        sidecar = archive.with_name(archive.name + ".sha256")
        if not sidecar.is_file():
            raise ValueError("Supply --archive-sha256 or the trusted source.tar.gz.sha256 sidecar.")
        fields = sidecar.read_text(encoding="utf-8").strip().split()
        value = fields[0] if fields else ""
    if not re.fullmatch(r"[a-fA-F0-9]{64}", value):
        raise ValueError("Archive SHA256 must contain exactly 64 hexadecimal characters.")
    return value.lower()


def verify_kaggle_cpu() -> dict:
    markers = sorted(key for key in os.environ if key.startswith("KAGGLE_"))
    if sys.platform != "linux" or not WORKING.is_dir() or not markers:
        raise RuntimeError("Run this script in an actual Kaggle Linux kernel; local results cannot be labeled Kaggle.")
    if platform.machine() not in {"x86_64", "amd64"}:
        raise RuntimeError("The pinned runtime archives require Linux x86_64.")
    accelerator = os.environ.get("KAGGLE_ACCELERATOR", "")
    cuda = os.environ.get("CUDA_VISIBLE_DEVICES", "")
    if re.search(r"gpu|tpu", accelerator, re.IGNORECASE) or cuda not in {"", "-1"}:
        raise RuntimeError("Select Accelerator: None before running the CPU baseline.")
    if list(Path("/dev").glob("nvidia[0-9]*")):
        raise RuntimeError("GPU devices are exposed; select Accelerator: None.")
    if any(os.environ.get(key) for key in ("TPU_NAME", "TPU_ACCELERATOR_TYPE", "TPU_WORKER_ID", "COLAB_TPU_ADDR")):
        raise RuntimeError("A TPU environment is exposed; select Accelerator: None.")
    gpu_probe = "nvidia-smi unavailable"
    if shutil.which("nvidia-smi"):
        probe = subprocess.run(["nvidia-smi", "-L"], capture_output=True, text=True, timeout=10)
        if re.search(r"GPU \d", probe.stdout):
            raise RuntimeError("nvidia-smi found a GPU; select Accelerator: None.")
        gpu_probe = "no GPU reported by nvidia-smi"
    return {
        "platform": sys.platform, "machine": platform.machine(), "pythonVersion": platform.python_version(),
        "osRelease": platform.freedesktop_os_release(), "cpuCount": os.cpu_count(),
        "accelerator": "none", "kaggleVerified": True, "kaggleEnvironmentKeys": markers,
        "acceleratorEvidence": {"gpuProbe": gpu_probe, "gpuDeviceNodes": 0, "tpuEnvironmentDetected": False},
    }


def sanitized_source_member(member: tarfile.TarInfo) -> bool:
    relative = PurePosixPath(member.name)
    parts = relative.parts
    if relative.is_absolute() or not parts or ".." in parts or not (member.isfile() or member.isdir()):
        return False
    if len(parts) == 1 and parts[0] in ROOT_FILES:
        return member.isfile()
    if parts[0] == "src":
        return len(parts) == 1 or parts[1] != "generated"
    if parts[0] == "prisma":
        return (member.isdir() and len(parts) == 1) or (member.isfile() and parts == ("prisma", "schema.prisma"))
    if parts[0] == "benchmarks":
        return len(parts) == 1 or parts[1] not in EXCLUDED_BENCHMARK_DIRS
    return False


def extract_source(archive: Path) -> dict:
    with tarfile.open(archive, "r:gz") as bundle:
        members = bundle.getmembers()
        if not members or any(not sanitized_source_member(member) for member in members):
            raise ValueError("Archive is not the sanitized package made by benchmarks/package.cjs.")
        names = {PurePosixPath(member.name).as_posix() for member in members}
        required = {"package.json", "package-lock.json", "prisma/schema.prisma",
                    "benchmarks/run.cjs", "benchmarks/source.cjs", "benchmarks/source-provenance.json"}
        if not required.issubset(names):
            raise ValueError("Archive lacks the benchmark runner or source provenance manifest.")
        raw = bundle.extractfile("benchmarks/source-provenance.json")
        if raw is None:
            raise ValueError("Source provenance manifest is missing.")
        provenance = json.load(raw)
        if not re.fullmatch(r"[a-fA-F0-9]{40}", str(provenance.get("gitCommit", ""))):
            raise ValueError("Source provenance requires a full Git commit.")
        if SOURCE.exists() and any(SOURCE.iterdir()):
            saved = SOURCE / "benchmarks/source-provenance.json"
            if (SOURCE / ".git").exists() or not saved.is_file() or json.loads(saved.read_text(encoding="utf-8")) != provenance:
                raise RuntimeError("The existing /kaggle/working/online-exam-api belongs to different source. Use a fresh Kaggle session.")
        else:
            SOURCE.mkdir(parents=True, exist_ok=True)
            # Source archives contain regular files/directories only: no links, credentials or node_modules.
            for member in members:
                target = SOURCE / PurePosixPath(member.name)
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with bundle.extractfile(member) as source, target.open("wb") as destination:
                        shutil.copyfileobj(source, destination)
                    target.chmod(member.mode & 0o777)
    return provenance


def fetch_text(url: str) -> str:
    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read().decode("utf-8")


def install_runtime(name: str) -> Path:
    spec = PINNED[name]
    filename = spec["url"].rsplit("/", 1)[-1]
    checksums = fetch_text(spec["checksums"])
    official = next((line.split()[0].lower() for line in checksums.splitlines()
                     if len(line.split()) >= 2 and line.split()[-1].lstrip("*") == filename), None)
    if official != spec["sha256"]:
        raise ValueError(f"Official {name} SHA256 does not match the pinned release.")
    cache = TOOLS / "downloads"
    cache.mkdir(parents=True, exist_ok=True)
    archive = cache / filename
    if not archive.is_file() or sha256_file(archive) != spec["sha256"]:
        partial = archive.with_name(archive.name + ".part")
        try:
            with urllib.request.urlopen(spec["url"], timeout=120) as response, partial.open("wb") as destination:
                shutil.copyfileobj(response, destination)
            if sha256_file(partial) != spec["sha256"]:
                raise ValueError(f"Downloaded {name} archive failed SHA256 verification.")
            partial.replace(archive)
        finally:
            partial.unlink(missing_ok=True)
    installed = TOOLS / name
    marker = installed / ".verified-sha256"
    binary = installed / spec["binary"]
    if not binary.is_file() or not marker.is_file() or marker.read_text().strip() != spec["sha256"]:
        if not hasattr(tarfile, "data_filter"):
            raise RuntimeError("Use the current Kaggle Python image with safe tarfile.data_filter support.")
        installed.mkdir(parents=True, exist_ok=True)
        with tarfile.open(archive, "r:*") as bundle:
            bundle.extractall(installed, filter="data")
        if not binary.is_file():
            raise ValueError(f"Verified {name} archive lacks its expected binary.")
        marker.write_text(spec["sha256"], encoding="ascii")
    binary.chmod(binary.stat().st_mode | 0o100)
    return binary


def execute(arguments: list[str], *, env: dict | None = None, cwd: Path | None = None) -> None:
    subprocess.run(arguments, env=env, cwd=cwd, check=True)


def init_replica_set(mongod: subprocess.Popen, python_client: Path) -> str:
    sys.path.insert(0, str(python_client))
    import pymongo
    if pymongo.version != "4.10.1":
        raise RuntimeError("Expected pinned PyMongo 4.10.1 for replica-set initialization.")
    client = pymongo.MongoClient(
        "mongodb://127.0.0.1:27018/admin?directConnection=true",
        serverSelectionTimeoutMS=1000, connectTimeoutMS=1000,
    )
    try:
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            if mongod.poll() is not None:
                raise RuntimeError("Owned mongod exited. Inspect its log under /kaggle/working/.online-exam-baseline-tools.")
            try:
                client.admin.command("ping")
                break
            except pymongo.errors.PyMongoError:
                time.sleep(0.3)
        else:
            raise RuntimeError("Owned MongoDB did not become reachable.")
        client.admin.command({
            "replSetInitiate": {"_id": "rs0", "members": [{"_id": 0, "host": "127.0.0.1:27018"}]},
        })
        while time.monotonic() < deadline:
            if client.admin.command("hello").get("isWritablePrimary"):
                actual = str(client.admin.command("buildInfo")["version"])
                if actual != MONGO_VERSION:
                    raise RuntimeError("MongoDB actual version differs from the pinned release.")
                return actual
            time.sleep(0.3)
        raise RuntimeError("Owned rs0 did not elect its primary.")
    finally:
        client.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-archive", type=Path, required=True)
    parser.add_argument("--archive-sha256", help="Required SHA256; defaults to the trusted archive .sha256 sidecar")
    args = parser.parse_args()
    runtime = verify_kaggle_cpu()
    archive = args.source_archive.expanduser().resolve()
    expected_sha = required_archive_sha(archive, args.archive_sha256)
    if not archive.is_file() or sha256_file(archive) != expected_sha:
        raise ValueError("Source archive does not match its required SHA256.")
    provenance = extract_source(archive)
    node = install_runtime("node")
    k6 = install_runtime("k6")
    mongo = install_runtime("mongo")
    node_actual = subprocess.check_output([str(node), "--version"], text=True).strip()
    k6_actual = subprocess.check_output([str(k6), "version"], text=True).strip()
    subprocess.run([str(mongo), "--version"], check=True, capture_output=True, text=True)
    if node_actual != f"v{NODE_VERSION}" or f"v{K6_VERSION} " not in k6_actual:
        raise RuntimeError("Actual Node/k6 versions do not match the pinned binaries.")
    python_client = TOOLS / "python-client"
    if not (python_client / "pymongo/__init__.py").is_file():
        execute([sys.executable, "-m", "pip", "install", "--disable-pip-version-check",
                 "--no-cache-dir", "--target", str(python_client), "pymongo==4.10.1", "dnspython==2.7.0"])
    run_id = uuid.uuid4().hex[:12]
    data = TOOLS / "mongo-runs" / run_id
    data.mkdir(parents=True)
    output = RESULTS / run_id
    output.mkdir(parents=True)
    database_url = f"mongodb://127.0.0.1:27018/online_exam_{run_id}_benchmark?replicaSet=rs0&directConnection=true"
    env = {**os.environ, "PATH": str(node.parent) + os.pathsep + os.environ.get("PATH", ""),
           "BENCH_DATABASE_URL": database_url, "DATABASE_URL": database_url,
           "K6_BINARY": str(k6), "K6_NEW_MACHINE_READABLE_SUMMARY": "false",
           "MONGODB_VERSION": MONGO_VERSION}
    runtime.update({
        "nodeVersion": node_actual, "k6Version": k6_actual, "mongoVersion": MONGO_VERSION,
        "sourceArchiveSha256": expected_sha, "sourceProvenance": provenance,
        "downloads": {name: {"url": spec["url"], "sha256": spec["sha256"]} for name, spec in PINNED.items()},
        "mongoBindIp": "127.0.0.1", "mongoPort": 27018, "replicaSet": "rs0",
        "databaseName": f"online_exam_{run_id}_benchmark", "status": "prepared",
    })
    metadata = output / "runtime.json"
    metadata.write_text(json.dumps(runtime, indent=2), encoding="utf-8")
    with socket.socket() as port_probe:
        try:
            port_probe.bind(("127.0.0.1", 27018))
        except OSError as error:
            raise RuntimeError("Port 27018 is already in use. Existing services will not be replaced.") from error
    mongod = subprocess.Popen([
        str(mongo), "--bind_ip", "127.0.0.1", "--port", "27018", "--replSet", "rs0",
        "--dbpath", str(data), "--logpath", str(data / "mongod.log"),
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    report_folder = SOURCE / "benchmarks/results"
    previous = set(report_folder.iterdir()) if report_folder.exists() else set()
    try:
        runtime["mongoVersion"] = init_replica_set(mongod, python_client)
        # npm ci uses the uploaded lockfile; generate/db push/build are performed by run.cjs.
        execute([str(node), str(node.parent.parent / "lib/node_modules/npm/bin/npm-cli.js"),
                 "ci", "--no-audit", "--no-fund"], cwd=SOURCE, env=env)
        execute([str(node), "benchmarks/run.cjs", "--environment", "kaggle-cpu"], cwd=SOURCE, env=env)
        reports = [file for file in report_folder.iterdir() if file not in previous and file.is_file()]
        if not any(file.name.endswith(".summary.json") for file in reports) or not any(file.suffix == ".md" for file in reports):
            raise RuntimeError("Runner produced no measured summary and validated report.")
        for file in reports:
            if file.suffix in {".json", ".md"}:
                shutil.copy2(file, output / file.name)
        runtime["status"] = "completed"
        print(f"Measured Kaggle CPU artifacts: {output}")
    except BaseException as error:
        runtime["status"] = "failed"
        runtime["failureType"] = type(error).__name__
        raise
    finally:
        if mongod.poll() is None:
            mongod.terminate()
            try:
                mongod.wait(timeout=15)
            except subprocess.TimeoutExpired:
                mongod.kill()
                mongod.wait(timeout=5)
        runtime["ownedMongoStopped"] = mongod.poll() is not None
        metadata.write_text(json.dumps(runtime, indent=2), encoding="utf-8")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Kaggle baseline stopped: {error}", file=sys.stderr)
        raise SystemExit(1)
