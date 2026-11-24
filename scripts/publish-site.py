"""Publish a reviewed main commit and verify the frontend served by GitHub Pages."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import subprocess
import sys
import time
from urllib.error import URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
PENDING = "refs/jm-invest/publish"
PAGES = "https://najaemin92.github.io/jm-invest/"
LOCAL = "http://127.0.0.1:8765/"


def git(*args, **kwargs):
    return subprocess.run(["git", *args], cwd=ROOT, check=True, **kwargs)


def revision(ref):
    return git("rev-parse", "--verify", ref, capture_output=True, text=True).stdout.strip()


def check_site(base, commit):
    paths = git("ls-tree", "-r", "--name-only", commit, capture_output=True, text=True).stdout.splitlines()
    paths = [p for p in paths if p.startswith("assets/") or "/" not in p and p.endswith((".html", ".css", ".js"))]
    stamp = str(time.time_ns())

    def matches(path):
        request = Request(base + quote(path) + "?release=" + commit + "&check=" + stamp, headers={"Cache-Control":"no-cache"})
        with urlopen(request, timeout=12) as response:
            return response.read() == git("show", commit + ":" + path, capture_output=True).stdout

    if not matches("index.html"):
        return False
    with ThreadPoolExecutor(max_workers=4) as pool:
        return all(pool.map(matches, (path for path in paths if path != "index.html")))


def main(action):
    if action == "check-local":
        if not check_site(LOCAL, revision("HEAD")):
            sys.exit("Local files differ from the committed frontend.")
        print("Local frontend matches HEAD.")
        return
    if action == "publish":
        branch = git("branch", "--show-current", capture_output=True, text=True).stdout.strip()
        dirty = git("status", "--porcelain", "--", "*.html", "*.css", "*.js", "assets/", capture_output=True).stdout
        if branch != "main" or dirty:
            sys.exit("Commit the frontend on main before publishing.")
        git("update-ref", PENDING, revision("HEAD"))
    elif subprocess.run(["git", "show-ref", "--verify", "--quiet", PENDING], cwd=ROOT).returncode:
        return
    commit = revision(PENDING)
    git("merge-base", "--is-ancestor", commit, "refs/heads/main")
    remote = git("remote", "get-url", "--push", "origin", capture_output=True, text=True).stdout.strip()
    if remote.lower().removesuffix(".git") not in ("https://github.com/najaemin92/jm-invest", "git@github.com:najaemin92/jm-invest"):
        sys.exit("The push destination is not the configured Pages repository.")
    git("push", "origin", commit + ":refs/heads/main", env={**os.environ, "GIT_TERMINAL_PROMPT":"0", "GH_PROMPT_DISABLED":"1"})
    for attempt in range(5):
        if attempt:
            time.sleep(12)
        if check_site(PAGES, commit):
            git("update-ref", "-d", PENDING, commit)
            print("Pages matches " + commit[:12])
            return
    sys.exit("Pages has not served the complete release yet. The commit remains queued.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("publish", "retry", "check-local"))
    try:
        main(parser.parse_args().action)
    except (OSError, URLError, subprocess.CalledProcessError) as error:
        sys.exit(str(error))
