#!/usr/bin/env python3
"""Apply booklogr's observability instrumentation to a substrate checkout.

Adds prometheus-flask-exporter in multiprocess mode so the multi-worker gunicorn
deployment exposes one aggregated /metrics endpoint on a dedicated port (9090),
separate from the application's request port (5000). It instruments every route
uniformly (the exporter's defaults) — it is not tuned to any one endpoint.

Idempotent: every edit is guarded by a marker check, so re-running is a no-op.

Usage:  python3 apply.py <substrate-dir>
"""
import sys
from collections.abc import Callable
from pathlib import Path

GUNICORN_CONF = """\
# Gunicorn config — wires prometheus-flask-exporter's multiprocess mode so the
# multi-worker deployment exposes one aggregated /metrics endpoint.
from prometheus_flask_exporter.multiprocess import GunicornPrometheusMetrics


def when_ready(server):
    # Serve aggregated metrics from the gunicorn master on a dedicated port,
    # separate from the application's request port.
    GunicornPrometheusMetrics.start_http_server_when_ready(9090)


def child_exit(server, worker):
    GunicornPrometheusMetrics.mark_process_dead_on_child_exit(worker.pid)
"""

# Inserted at the TOP of entrypoint.sh: the multiprocess metrics dir must exist
# BEFORE any process imports api.app — db migration, user bootstrap, AND gunicorn
# all import the app, which registers GunicornPrometheusMetrics and requires this
# directory to already exist (else it raises at import time and the command fails).
ENTRYPOINT_TOP = """\
# Prometheus multiprocess metrics directory — must exist before anything imports
# the app (gunicorn runs multiple workers; the exporter aggregates per-process
# metrics from this shared dir and serves them on a dedicated port, see
# gunicorn.conf.py).
export PROMETHEUS_MULTIPROC_DIR="${PROMETHEUS_MULTIPROC_DIR:-/tmp/prometheus_multiproc}"
rm -rf "$PROMETHEUS_MULTIPROC_DIR"
mkdir -p "$PROMETHEUS_MULTIPROC_DIR"
"""


def patch(path: Path, marker: str, transform: Callable[[str], str], label: str) -> None:
    """Apply `transform` to `path` unless `marker` is already present.

    Idempotent and fail-loud: if the marker is absent but the transform changes
    nothing (anchor not found), raise rather than write a partial result.
    """
    if not path.exists():
        raise SystemExit(f"  ! {label}: file not found: {path}")
    text = path.read_text()
    if marker in text:
        print(f"  = {label}: already applied")
        return
    new = transform(text)
    if new == text:
        raise SystemExit(f"  ! {label}: anchor not found in {path}")
    path.write_text(new)
    print(f"  + {label}: applied")


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: apply.py <substrate-dir>")
    root = Path(sys.argv[1]).resolve()
    if not (root / "api" / "app.py").exists():
        raise SystemExit(f"not a booklogr checkout (no api/app.py): {root}")

    # 1. gunicorn.conf.py (new file at repo root). Refuse to clobber an
    #    unrelated pre-existing config rather than silently overwrite it.
    conf = root / "gunicorn.conf.py"
    if conf.exists():
        if "GunicornPrometheusMetrics" in conf.read_text():
            print("  = gunicorn.conf.py: already present")
        else:
            raise SystemExit("  ! gunicorn.conf.py exists without expected content — refusing to overwrite")
    else:
        conf.write_text(GUNICORN_CONF)
        print("  + gunicorn.conf.py: written")

    # 2. pyproject.toml — declare the dependency.
    patch(
        root / "pyproject.toml",
        "prometheus-flask-exporter",
        lambda t: t.replace(
            'flask-caching = "^2.3.1"',
            'flask-caching = "^2.3.1"\nprometheus-flask-exporter = "^0.23.2"',
            1,
        ),
        "pyproject dependency",
    )

    # 3a. api/app.py — the import (own marker = the import line itself).
    patch(
        root / "api" / "app.py",
        "from prometheus_flask_exporter.multiprocess import GunicornPrometheusMetrics",
        lambda t: t.replace(
            "from api.extensions import cache\n",
            "from api.extensions import cache\n"
            "from prometheus_flask_exporter.multiprocess import GunicornPrometheusMetrics\n",
            1,
        ),
        "app.py import",
    )

    # 3b. api/app.py — register metrics on the module-level app (own marker).
    patch(
        root / "api" / "app.py",
        "metrics = GunicornPrometheusMetrics(app)",
        lambda t: t.replace(
            "cache.init_app(app)\n",
            "cache.init_app(app)\nmetrics = GunicornPrometheusMetrics(app)\n",
            1,
        ),
        "app.py metrics registration",
    )

    # 4a. entrypoint.sh — create the multiproc dir before anything imports the
    #     app (db migration + user bootstrap + gunicorn all import api.app).
    patch(
        root / "entrypoint.sh",
        "PROMETHEUS_MULTIPROC_DIR",
        lambda t: t.replace("#!/bin/sh\n", "#!/bin/sh\n" + ENTRYPOINT_TOP, 1),
        "entrypoint multiproc dir",
    )

    # 4b. entrypoint.sh — fail loudly if the migration fails (don't mask a broken
    #     DB; the index-route healthcheck would otherwise report healthy anyway).
    patch(
        root / "entrypoint.sh",
        "db upgrade || ",
        lambda t: t.replace(
            "python -m flask db upgrade",
            'python -m flask db upgrade || { echo "FATAL: database migration failed"; exit 1; }',
            1,
        ),
        "entrypoint migration guard",
    )

    # 4c. entrypoint.sh — run gunicorn with the metrics config file.
    patch(
        root / "entrypoint.sh",
        "/app/gunicorn.conf.py",
        lambda t: t.replace(
            "exec gunicorn -w 4 -b :5000 api.app:app",
            "exec gunicorn -c /app/gunicorn.conf.py -w 4 -b :5000 api.app:app",
            1,
        ),
        "entrypoint gunicorn config",
    )

    # 5. Dockerfile — copy gunicorn.conf.py into the image.
    patch(
        root / "Dockerfile",
        "gunicorn.conf.py",
        lambda t: t.replace(
            "COPY README.md pyproject.toml entrypoint.sh ./",
            "COPY README.md pyproject.toml entrypoint.sh gunicorn.conf.py ./",
            1,
        ),
        "Dockerfile copy",
    )

    # 6. Dockerfile — document the metrics port.
    patch(
        root / "Dockerfile",
        "EXPOSE 9090",
        lambda t: t.replace("EXPOSE 5000", "EXPOSE 5000\nEXPOSE 9090", 1),
        "Dockerfile expose metrics port",
    )

    print("instrumentation complete")


if __name__ == "__main__":
    main()
