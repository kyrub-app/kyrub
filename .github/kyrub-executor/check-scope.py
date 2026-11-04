#!/usr/bin/env python3
"""Fail closed when the pilot executor touches files outside its code scope."""
import subprocess
import sys

allowed = (
    "server/payments/",
    "server/integrations/",
    "src/components/",
    "src/utils/",
    "tests/",
    "api/",
    "shared/",
)
changes = subprocess.check_output(
    ["git", "status", "--porcelain", "--untracked-files=all"], text=True
).splitlines()
bad = []
for line in changes:
    path = line[3:]
    if " -> " in path:
        path = path.split(" -> ", 1)[-1]
    if path.startswith("executor-results/"):
        continue
    if not path.startswith(allowed):
        bad.append(path)
if bad:
    print("Changes outside allowed scope:", *bad, sep="\n", file=sys.stderr)
    sys.exit(1)
print("Scope check passed.")
