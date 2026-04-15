#!/usr/bin/env python3
"""Claude Code Usage Dashboard — http://localhost:8765

Uses ccusage CLI (must be installed) for accurate data including live sessions.
Refresh interval: 30 seconds.
"""

import json
import os
import subprocess
from datetime import datetime, timezone
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

# ── Account configuration ─────────────────────────────────────────────────────
# CLAUDE_CONFIG_DIR is supported by BOTH Claude Code and ccusage.
# Each account uses a separate config dir via shell aliases (see ~/.zshrc).
#
# token_limit_5h: estimated 5h-window token budget (NOT published by Anthropic).
#   Adjust based on observed usage. These are rough approximations:
#     Max plan:  ~30M tokens / 5h
#     Team plan: ~19M tokens / 5h
#     Pro plan:  ~5M tokens / 5h
#
# Config is loaded from (in order of precedence):
#   1. $CC_ACCOUNTS_JSON env var — raw JSON array string
#   2. ./accounts.json           — local file (gitignored)
#   3. ./accounts.example.json   — template fallback
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def _load_accounts() -> list:
    raw = os.environ.get("CC_ACCOUNTS_JSON")
    if raw:
        accounts = json.loads(raw)
    else:
        for filename in ("accounts.json", "accounts.example.json"):
            path = os.path.join(_BASE_DIR, filename)
            if os.path.isfile(path):
                with open(path, "r", encoding="utf-8") as f:
                    accounts = json.load(f)
                break
        else:
            raise FileNotFoundError(
                "No account config found. Copy accounts.example.json to accounts.json "
                "or set CC_ACCOUNTS_JSON."
            )

    for a in accounts:
        if a.get("config_dir"):
            a["config_dir"] = os.path.expanduser(a["config_dir"])
    return accounts


ACCOUNTS = _load_accounts()

# ── ccusage runner ────────────────────────────────────────────────────────────

def run_ccusage(args: list, config_dir: str | None = None) -> dict | list:
    """Run a ccusage command and return parsed JSON output."""
    env = os.environ.copy()
    if config_dir:
        env["CLAUDE_CONFIG_DIR"] = config_dir

    cmd = ["ccusage"] + args + ["--json"]
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=15, env=env
        )
        if result.returncode != 0:
            return {}
        return json.loads(result.stdout)
    except (subprocess.TimeoutExpired, json.JSONDecodeError, FileNotFoundError):
        return {}


def empty_account_data(account: dict) -> dict:
    now_local = datetime.now(timezone.utc).astimezone()
    return {
        "id":             account["id"],
        "name":           account["name"],
        "email":          account.get("email", ""),
        "plan":           account.get("plan", ""),
        "alias":          account.get("alias", ""),
        "token_limit_5h": account.get("token_limit_5h", 0),
        "limit_pct":      0,
        "current_block":  None,
        "today":          {"date": now_local.strftime("%Y-%m-%d"), "total_tokens": 0, "cost_usd": 0.0, "entry_count": 0},
        "this_month":     {"month": now_local.strftime("%Y-%m"),   "total_tokens": 0, "cost_usd": 0.0},
        "daily_history":  [],
        "last_activity":  None,
        "configured":     False,
    }


def get_account_data(account: dict) -> dict:
    cfg = account.get("config_dir")
    if cfg and not os.path.isdir(cfg):
        return empty_account_data(account)

    # Run ccusage commands via subprocess (each returns quickly from JSONL cache)
    blocks_raw  = run_ccusage(["blocks"],   cfg)
    daily_raw   = run_ccusage(["daily", "-o", "desc"],  cfg)
    monthly_raw = run_ccusage(["monthly", "-o", "desc"], cfg)

    now = datetime.now(timezone.utc)

    # ── Current / most recent block ───────────────────────────────────────────
    blocks = blocks_raw.get("blocks", [])
    active_blocks  = [b for b in blocks if b.get("isActive") and not b.get("isGap")]
    recent_blocks  = [b for b in blocks if not b.get("isGap")]

    cur_block = None
    if active_blocks:
        b = active_blocks[-1]
        cur_block = _format_block(b, now, is_live=True)
    elif recent_blocks:
        b = recent_blocks[-1]
        cur_block = _format_block(b, now, is_live=False)

    # ── Today + daily history (last 30 days) ──────────────────────────────────
    today_str = now.astimezone().strftime("%Y-%m-%d")
    today = {"date": today_str, "total_tokens": 0, "cost_usd": 0.0, "entry_count": 0}
    daily_all = daily_raw.get("daily", [])  # sorted desc (newest first)
    for day in daily_all:
        if day.get("date") == today_str:
            today = {
                "date":         today_str,
                "total_tokens": day.get("totalTokens", 0),
                "cost_usd":     round(day.get("totalCost", 0), 4),
                "entry_count":  0,
            }
            break

    daily_history = [
        {
            "date":         d.get("date"),
            "total_tokens": d.get("totalTokens", 0),
            "cost_usd":     round(d.get("totalCost", 0), 4),
        }
        for d in daily_all
    ]
    daily_history.reverse()  # oldest → newest for chart

    # ── This month ────────────────────────────────────────────────────────────
    month_str = now.astimezone().strftime("%Y-%m")
    this_month = {"month": month_str, "total_tokens": 0, "cost_usd": 0.0}
    months = monthly_raw.get("monthly", [])
    if months:
        m = months[0]  # most recent (desc order)
        if m.get("month") == month_str:
            this_month = {
                "month":        month_str,
                "total_tokens": m.get("totalTokens", 0),
                "cost_usd":     round(m.get("totalCost", 0), 4),
            }

    # ── Last activity ─────────────────────────────────────────────────────────
    last_activity = None
    if cur_block:
        last_activity = cur_block.get("last_entry_time")

    limit = account.get("token_limit_5h", 0)
    limit_pct = 0
    if limit > 0 and cur_block:
        limit_pct = round(100 * cur_block["total_tokens"] / limit)

    return {
        "id":             account["id"],
        "name":           account["name"],
        "email":          account.get("email", ""),
        "plan":           account.get("plan", ""),
        "alias":          account.get("alias", ""),
        "token_limit_5h": limit,
        "limit_pct":      limit_pct,
        "current_block":  cur_block,
        "today":          today,
        "this_month":     this_month,
        "daily_history":  daily_history,
        "last_activity":  last_activity,
        "configured":     True,
    }


def _format_block(b: dict, now: datetime, *, is_live: bool) -> dict:
    start = datetime.fromisoformat(b["startTime"].replace("Z", "+00:00"))
    end   = datetime.fromisoformat(b["endTime"].replace("Z",   "+00:00"))

    actual_end_str = b.get("actualEndTime")
    actual_end = datetime.fromisoformat(actual_end_str.replace("Z", "+00:00")) if actual_end_str else None

    elapsed_sec  = (min(now, end) - start).total_seconds()
    elapsed_pct  = round(min(100, 100 * elapsed_sec / (5 * 3600)))
    rem_min      = max(0, (end - now).total_seconds() / 60) if end > now else 0

    tok   = b.get("tokenCounts", {})
    total = (tok.get("inputTokens", 0)
           + tok.get("outputTokens", 0)
           + tok.get("cacheCreationInputTokens", 0)
           + tok.get("cacheReadInputTokens", 0))

    burn_rate = 0
    if b.get("burnRate"):
        burn_rate = round(b["burnRate"].get("tokensPerMinute", 0) * 60)

    projection = None
    if is_live and b.get("projection"):
        p = b["projection"]
        projection = {
            "total_tokens": p.get("totalTokens", 0),
            "total_cost":   round(p.get("totalCost", 0), 2),
            "remaining_min": p.get("remainingMinutes", 0),
        }

    return {
        "start_time":         b["startTime"],
        "end_time":           b["endTime"],
        "last_entry_time":    actual_end_str,
        "is_active":          is_live and end > now,
        "total_tokens":       total,
        "input_tokens":       tok.get("inputTokens", 0),
        "output_tokens":      tok.get("outputTokens", 0),
        "cache_create_tokens": tok.get("cacheCreationInputTokens", 0),
        "cache_read_tokens":  tok.get("cacheReadInputTokens", 0),
        "cost_usd":           round(b.get("costUSD", 0), 4),
        "models":             b.get("models", []),
        "entry_count":        b.get("entries", 0),
        "elapsed_pct":        elapsed_pct,
        "time_remaining_min": round(rem_min),
        "burn_rate_per_hour": burn_rate,
        "projection":         projection,
    }


# ── HTTP server ───────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_): pass

    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/api/usage":
            data = {
                "accounts":   [get_account_data(a) for a in ACCOUNTS],
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            body = json.dumps(data, default=str).encode()
            self._respond(200, "application/json", body)
        else:
            self.send_response(404)
            self.end_headers()

    def _respond(self, code, ctype, body):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", len(body))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    PORT   = 8765
    server = HTTPServer(("localhost", PORT), Handler)
    print(f"  Claude Code Usage API")
    print(f"  http://localhost:{PORT}/api/usage")
    print(f"  (Frontend: cd web && npm run dev → http://localhost:5173)\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Stopped.")
