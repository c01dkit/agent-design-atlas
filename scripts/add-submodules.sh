#!/usr/bin/env bash
# Add the awesome-agents framework repos as shallow git submodules.
#
# Connectivity: tries a DIRECT github.com connection first; only falls back to a
# proxy if direct fails. The proxy is NOT hardcoded here — it is read from .env
# (HTTP_PROXY=...), from a --proxy flag, or prompted interactively and saved to
# .env. .env is gitignored and never uploaded.
#
# Usage:
#   ./scripts/add-submodules.sh                # auto-detect; prompt for proxy if needed
#   ./scripts/add-submodules.sh --proxy URL    # set & save proxy to .env, then run
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE" && cd .. || exit 1
ROOT="$PWD"
ENV_FILE="$ROOT/.env"
LOG="scripts/submodule-add.log"

save_proxy() {
  local p="$1"
  touch "$ENV_FILE"
  grep -vE '^HTTPS?_PROXY=' "$ENV_FILE" 2>/dev/null > "$ENV_FILE.tmp" || true
  mv "$ENV_FILE.tmp" "$ENV_FILE" 2>/dev/null || true
  printf 'HTTP_PROXY=%s\nHTTPS_PROXY=%s\n' "$p" "$p" >> "$ENV_FILE"
  echo "  -> saved proxy to .env"
}

# load .env (plain VAR=val lines become shell vars; not yet exported to children)
[ -f "$ENV_FILE" ] && . "$ENV_FILE"

# --proxy <url> flag: set & persist
if [ "${1:-}" = "--proxy" ] && [ -n "${2:-}" ]; then HTTP_PROXY="$2"; save_proxy "$2"; fi

CAND="${HTTP_PROXY:-${HTTPS_PROXY:-${http_proxy:-${https_proxy:-}}}}"
# clear proxy from the environment so the direct test is genuinely direct
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy

reach() { # $1 = proxy url ; empty = direct
  if [ -n "${1:-}" ]; then
    curl -fsS -m 12 -x "$1" -o /dev/null https://github.com 2>/dev/null
  else
    curl -fsS -m 12 --noproxy '*' -o /dev/null https://github.com 2>/dev/null
  fi
}

PROXY=""
echo "-> testing direct connection to github.com ..."
if reach ""; then
  echo "  OK: direct connection works, no proxy needed"
else
  echo "  FAIL: direct connection blocked"
  if [ -z "$CAND" ] && [ -t 0 ]; then
    read -r -p "  enter http proxy (e.g. http://127.0.0.1:7890), Enter to skip: " CAND
    [ -n "$CAND" ] && save_proxy "$CAND"
  fi
  if [ -n "$CAND" ]; then
    echo "-> testing proxy $CAND ..."
    if reach "$CAND"; then echo "  OK: proxy reachable"; else echo "  WARN: proxy test failed, trying anyway"; fi
    PROXY="$CAND"
  else
    echo "  WARN: no proxy configured; trying direct anyway. Re-run with --proxy URL if it fails."
  fi
fi
[ -n "$PROXY" ] && export HTTP_PROXY="$PROXY" HTTPS_PROXY="$PROXY" http_proxy="$PROXY" https_proxy="$PROXY"

git config core.longpaths true 2>/dev/null  # some repos contain very long paths (Windows)

: > "$LOG"
log() { echo "$@" | tee -a "$LOG"; }
cleanup() {
  local path="$1"
  git submodule deinit -f "$path" >/dev/null 2>&1
  git rm -f "$path" >/dev/null 2>&1
  rm -rf "$path" ".git/modules/$path" 2>/dev/null
  git config -f .gitmodules --remove-section "submodule.$path" >/dev/null 2>&1
}
add() {
  local path="$1" url="$2" try
  if [ -e "$path/.git" ] || git config -f .gitmodules --get "submodule.$path.url" >/dev/null 2>&1; then
    log "SKIP (exists): $path"; return 0
  fi
  for try in 1 2 3; do
    log "ADD : $path (try $try)"
    if timeout 600 git -c core.longpaths=true submodule add --depth 1 "$url" "$path" >>"$LOG" 2>&1; then
      git config -f .gitmodules "submodule.$path.shallow" true
      log "OK  : $path"; return 0
    fi
    cleanup "$path"; sleep 3
  done
  log "FAIL: $path ($url)"; return 1
}

log "=== framework submodules start ==="
add agents-example/openclaw                https://github.com/openclaw/openclaw
add agents-example/hermes-agent            https://github.com/nousresearch/hermes-agent
add agents-example/llama-agentic-system    https://github.com/meta-llama/llama-agentic-system
add agents-example/llamaindex              https://github.com/jerryjliu/llama_index
add agents-example/langchain               https://github.com/hwchase17/langchain
add agents-example/botpress                https://github.com/botpress/botpress
add agents-example/haystack                https://github.com/deepset-ai/haystack
add agents-example/semantic-kernel         https://github.com/microsoft/semantic-kernel
add agents-example/agent-llm               https://github.com/Josh-XT/Agent-LLM
add agents-example/llm-agents              https://github.com/mpaepper/llm_agents
add agents-example/e2b                     https://github.com/e2b-dev/e2b
add agents-example/dust                    https://github.com/dust-tt/dust
add agents-example/metagpt                 https://github.com/geekan/MetaGPT
add agents-example/lagent                  https://github.com/InternLM/lagent
add agents-example/autogen                 https://github.com/microsoft/autogen
add agents-example/ag2                     https://github.com/ag2ai/ag2
add agents-example/agentverse              https://github.com/openbmb/agentverse
add agents-example/maestro                 https://github.com/Doriandarko/maestro
add agents-example/agentscope              https://github.com/modelscope/agentscope
add agents-example/crewai                  https://github.com/joaomdmoura/crewai
add agents-example/swarm                   https://github.com/openai/swarm
add agents-example/agency-swarm            https://github.com/VRSEN/agency-swarm
add agents-example/upsonic                 https://github.com/upsonic/upsonic
add agents-example/mastra                  https://github.com/mastra-ai/mastra
add agents-example/vectara-agentic         https://github.com/vectara/py-vectara-agentic
add agents-example/agentdock               https://github.com/AgentDock/AgentDock
add agents-example/modus                   https://github.com/hypermodeinc/modus
add agents-example/swarms                  https://github.com/kyegomez/swarms
add agents-example/strands                 https://github.com/strands-agents/sdk-python
add agents-example/voltagent               https://github.com/VoltAgent/voltagent
add agents-example/agentic-context-engine  https://github.com/kayba-ai/agentic-context-engine
add agents-example/astron                  https://github.com/iflytek/astron-agent
add agents-example/ailoy                   https://github.com/brekkylab/ailoy
add agents-example/praisonai               https://github.com/MervinPraison/PraisonAI
add agents-example/agentfield              https://github.com/Agent-Field/agentfield
add agents-example/cortex-mem              https://github.com/sopaco/cortex-mem
add agents-example/pipecat                 https://github.com/pipecat-ai/pipecat
add agents-example/loongflow               https://github.com/baidu-baige/LoongFlow
add agents-example/agentset                https://github.com/agentset-ai/agentset
add agents-example/pilotprotocol           https://github.com/TeoSlayer/pilotprotocol
add agents-example/hcom                    https://github.com/aannoo/hcom
add agents-example/nanobot                 https://github.com/HKUDS/nanobot
add agents-example/hive                    https://github.com/aden-hive/hive
add agents-example/connectonion            https://github.com/openonion/connectonion
add agents-example/swarmclaw               https://github.com/swarmclawai/swarmclaw
add agents-example/smolagents              https://github.com/huggingface/smolagents
add agents-example/open-multi-agent        https://github.com/JackChen-me/open-multi-agent
add agents-example/aeon                    https://github.com/aaronjmars/aeon
add agents-example/cordum                  https://github.com/cordum-io/cordum
log "=== done ==="
log "OK: $(grep -c '^OK  :' "$LOG")  SKIP: $(grep -c '^SKIP' "$LOG")  FAIL: $(grep -c '^FAIL:' "$LOG")"
