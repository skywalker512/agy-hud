"""Install, symlink (dev mode), or uninstall the AGY-HUD plugin."""

import argparse
import os
import shutil
import subprocess
import sys
import tempfile


PLUGIN_NAME = "agy-hud"
MIN_NODE_VERSION = (22, 5)


def target_dir() -> str:
    return os.path.join(os.path.expanduser("~"), ".gemini", "config", "plugins", PLUGIN_NAME)


def source_dir() -> str:
    return os.path.dirname(os.path.realpath(__file__))


def _warn_node_version() -> None:
    try:
        proc = subprocess.run(
            ["node", "-p", "process.versions.node"],
            capture_output=True,
            text=True,
            timeout=2.0,
            check=False,
        )
    except FileNotFoundError:
        print(
            "Warning: `node` was not found on PATH. AGY-HUD sidecar requires Node.js >= 22.5 (for built-in `node:sqlite`).",
            file=sys.stderr,
        )
        return
    except Exception:
        return

    raw = (proc.stdout or "").strip()
    parts = raw.split(".")
    try:
        major, minor = int(parts[0]), int(parts[1])
    except (IndexError, ValueError):
        return
    if (major, minor) < MIN_NODE_VERSION:
        print(
            f"Warning: Detected Node.js {raw}, but AGY-HUD sidecar requires Node.js >= 22.5 (for built-in `node:sqlite`).",
            file=sys.stderr,
        )


def _remove_existing(dst: str) -> None:
    if os.path.islink(dst):
        os.unlink(dst)
    elif os.path.isdir(dst):
        shutil.rmtree(dst)
    elif os.path.exists(dst):
        os.remove(dst)


def install(link: bool = False) -> None:
    _warn_node_version()
    src = source_dir()
    dst = target_dir()
    parent = os.path.dirname(dst)
    os.makedirs(parent, exist_ok=True)

    if link:
        _remove_existing(dst)
        os.symlink(src, dst, target_is_directory=True)
        print(f"Linked {PLUGIN_NAME} plugin: {dst} -> {src}")
        return

    if not os.path.islink(dst) and os.path.exists(dst) and os.path.realpath(dst) == src:
        print(f"Plugin already resides at target path: {dst}")
        return

    stage_root = tempfile.mkdtemp(prefix=f".{PLUGIN_NAME}-stage-", dir=parent)
    stage_dst = os.path.join(stage_root, PLUGIN_NAME)
    try:
        shutil.copytree(
            src,
            stage_dst,
            ignore=shutil.ignore_patterns("install_plugin.py", "__pycache__", "*.pyc", "test"),
        )
        _remove_existing(dst)
        os.replace(stage_dst, dst)
    finally:
        shutil.rmtree(stage_root, ignore_errors=True)
    print(f"Installed {PLUGIN_NAME} plugin to: {dst}")


def uninstall() -> None:
    dst = target_dir()
    if os.path.islink(dst) or os.path.exists(dst):
        _remove_existing(dst)
        print(f"Removed {PLUGIN_NAME} plugin from: {dst}")
    else:
        print(f"Plugin directory not found: {dst}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Install/uninstall AGY-HUD plugin")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--link", action="store_true", help="Symlink repo plugin/ for live dev updates")
    group.add_argument("--uninstall", action="store_true", help="Remove installed plugin")
    args = parser.parse_args()
    if args.uninstall:
        uninstall()
    else:
        install(link=args.link)


if __name__ == "__main__":
    main()
