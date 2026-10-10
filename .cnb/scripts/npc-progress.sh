#!/usr/bin/env bash
# NPC 任务进展实时上报脚本
#
# 解决的问题：NPC 干活时只在「心里」规划步骤（todo），用户在 Issue / PR 里
# 看不到任何进展，只能干等。本脚本把进展落成**一条可见的进度评论**，并随任务
# 推进**原地刷新**。
#
# 为什么「原地刷新」要绕路：
#   平台限制——**NPC 身份生成的评论不允许再次编辑**，
#   PATCH 返回 403 `forbidden to edit NPC generated content`（实测）。
#   而**流水线 OCI 身份**（`api_trigger` 不传 `npc` 字段）创建的评论**可以被
#   NPC token 编辑**（实测 200）。于是：
#     init   → 派一条**轻量子流水线**（OCI 身份）建进度评论，回传 comment_id
#     update → 主代理**直接** PATCH 那条评论（零等待、零额外构建）
#   一次任务只多花 1 条子流水线，之后每次刷新都是单次 API 调用。
#
# 一个任务一条评论（用户明确要求）：**新任务一律新建进度评论，绝不改写历史评论**。
#   历史那条是上一轮任务的现场记录 —— 原地改写等于篡改记录，用户已明确否掉。
#   所以 init 默认**直接新建**（`NPC_PROGRESS_REUSE` 默认 0），
#   只有显式 `NPC_PROGRESS_REUSE=1` 才会去改写一条历史进度评论
#   （保留给「评论实在太多、想合并」的场景，非默认路径）。
#
#   同一任务内**重复 init 不会重复建**：状态里记了 task_id（CNB_BUILD_ID）——
#   同一个构建再 init 就是续用自己刚建的那条（PATCH），只有**换了任务**
#   （task_id 变了）才新建。update / done 也会校验 task_id，
#   拒绝把另一个任务的进度写进本任务的评论。
#
#   这不等于「评论越积越多」回归：新评论只在**新任务**时产生，
#   一次任务内 update 全程仍只 PATCH 自己那一条（少留评论靠的是
#   「任务内原地刷新 + 降级封顶 + 自测零残留 + 只报里程碑」）。
#
# 降级：子流水线起不来（无触发器权限、跨仓受限、**根组织并发构建超限**、超时、
#   缺 cnb CLI 等）时，自动切到 **append 模式**——追加一条进展评论。
#   append 模式**只报里程碑**：首次、进度每跨 NPC_PROGRESS_APPEND_MILESTONE
#   （默认 25%）一档、以及收尾（done / fail）；其余更新只写状态文件、不发评论。
#   非收尾播报另有条数上限 NPC_PROGRESS_APPEND_MAX（默认 2），
#   所以一个任务在 append 模式下最多 3 条评论（初始 + 最多 1 条里程碑 + 收尾）。
#   ⚠️ 收尾口径里有一条**必须**放行的例外：「已中止（failed）→ 全部完成（done）」
#   的**改判**。某一步标 failed 会把整条置为「已中止」，之后任务换方案跑完并 done ——
#   若把这次 done 也按条数上限挡掉，Issue 上最后留着的就是那条「已中止」，
#   用户会以为整轮都挂了（实测复现过）。所以：首次收尾必发，failed → done 的改判也必发；
#   其余（重复 done、done 之后再 note / done / fail）一律回闸门，防止刷屏。
#   也可用 NPC_PROGRESS_MODE=append 强制走降级路径（便于测试），
#   或用 NPC_PROGRESS_MODE=off 完全关闭（小任务不值得在 Issue 里刷进度时用）。
#
# init 会为「创建可刷新评论」重试若干次（NPC_PROGRESS_INIT_RETRY，默认 2），
# 但**只对瞬时拥塞（并发构建超限）重试**——权限不足、排队超时重试也没用，
# 遇到就直接降级，不白白卡住用户。
#
# 用法：
#   npc-progress.sh init   --title "任务标题" --steps "步骤1|步骤2|步骤3"
#   npc-progress.sh update --step 2 --status running [--note "正在做 X"]
#   npc-progress.sh update --step 2 --status done
#   npc-progress.sh note   "补充说明"
#   npc-progress.sh subagent --sn <构建号> --status running|done|... [--name 名字]
#                            [--task "任务摘要"] [--cpus 2] [--thinking medium]
#                            [--limit 秒]   # 子代理台账：按 sn 原地更新同一行
#   npc-progress.sh done   [--summary "结论"]
#   npc-progress.sh fail   --reason "失败原因"
#   npc-progress.sh preview [--mode inline|append]   # 只渲染、零写请求（自测用）
#   npc-progress.sh show | link | list
#
# 子代理台账（subagents）：把「派了哪些子代理、各自什么状态」记进状态，
#   渲染成**一块清单**（每个子代理一行，按 sn 原地更新），而不是每条心跳往
#   「补充说明」里追加一行。旧写法在 Issue 上长这样：
#     仍在等待子代理 cnb-xxx（已 900s / 上限 2400s，状态 pending）
#     仍在等待子代理 cnb-xxx（已 960s / 上限 2400s，状态 pending）
#     …同一件事刷 19 条，读的人只看到重复。
#   台账只有一份、每个子代理一行：状态、耗时 / 上限、名字、任务摘要；
#   收口后改成「已完成」并保留在清单里（历史可追溯）。耗时由渲染现算，
#   所以进度评论的心跳每次刷新都会让它自己往前走。
#
# --status 取值：pending / running / done / failed / skipped
#
# 进度「详细度」由三样东西构成（都写进同一条评论，零额外评论）：
#   1. 步骤列表        —— 做到哪一步了
#   2. 每步耗时        —— 「用时 5m30s」「进行中，已 12m38s」，看得出哪步卡住
#   3. 「正在做」区块  —— 把当前那一步单独置顶，附该步备注
# 时间戳记在状态文件的 started_at / finished_at / step_started_at / step_done_at。
#
# ⚠️ 耗时**只认真实打点**，缺打点就如实标注，绝不编造：
#   旧版把「标 done 的那一刻」同时当作开始时间补进去，于是从未标过 running 的步骤
#   算出 started == done → 渲染成「用时 0s」。看着像「这一步秒级完成」，
#   其实是**压根没打点** —— 用户已经就这种假数据提过问题（Issue #12：「有的日志
#   任务用时 0s？而且这个任务并不简单」）。
#   现在：开始时间**只在把步骤标成 running 时**写入；没打过点的步骤不显示耗时，
#   而是如实写「未单独计时」。状态里的 timing_version 用来区分两版语义：
#   老状态（无该字段）里 started == done 的一律视为旧版编造，同样按「未单独计时」渲染。
#
# 全局选项（放在子命令前）：
#   --repo <org/repo>   目标仓库（默认 CNB_REPO_SLUG）
#   --issue <n>         目标 Issue（默认 CNB_ISSUE_IID）
#   --pr <n>            目标 PR（默认 CNB_PULL_REQUEST_IID）
#   --state <file>      状态文件路径（默认按 仓库+目标+角色 自动定位）
#   --timeout <秒>      init 等待子流水线的上限（默认 120）
#
# 环境：CNB_TOKEN、CNB_REPO_SLUG、CNB_ISSUE_IID / CNB_PULL_REQUEST_IID
# 依赖：curl、jq、python3、base64（cnb CLI 仅 init 时用于等子流水线）
#
# 调参（都有默认值，一般不用动）：
#   NPC_PROGRESS_REUSE=1            【非默认】允许改写一条历史进度评论（默认 0 = 不改历史）
#   NPC_PROGRESS_REUSE_STALE=1800   仅在 REUSE=1 时生效：僵尸进度评论多久后可被复用（秒）
#   NPC_PROGRESS_APPEND_MAX=2       append 模式「非收尾」播报条数上限
#   NPC_PROGRESS_APPEND_MILESTONE=25  append 模式的进度里程碑（百分比）
#   NPC_PROGRESS_APPEND_MIN_INTERVAL=60  两条 append 播报的最小间隔（秒），0 = 不限
#   NPC_PROGRESS_DRY_RUN=1          自测用：只渲染、不发任何写请求（零评论残留）
set -u -o pipefail

API="${CNB_API_ENDPOINT:-https://api.cnb.cool}"
WEB="${CNB_WEB_ENDPOINT:-https://cnb.cool}"
TOKEN="${CNB_TOKEN:-}"
IMG="${NPC_PROGRESS_IMAGE:-cnbcool/default-npc:latest}"
EVENT="${NPC_PROGRESS_EVENT:-api_trigger_npc_progress}"
STATE_DIR="${NPC_PROGRESS_DIR:-/tmp/npc-progress}"
INIT_TIMEOUT="${NPC_PROGRESS_TIMEOUT:-120}"
POLL_INTERVAL="${NPC_PROGRESS_POLL_INTERVAL:-8}"
FORCE_MODE="${NPC_PROGRESS_MODE:-}"
REUSE="${NPC_PROGRESS_REUSE:-0}"                     # 默认 0：不改历史评论，新任务新建一条
REUSE_SCAN="${NPC_PROGRESS_REUSE_SCAN:-100}"         # （仅 REUSE=1 时）复用扫描的评论条数上限
APPEND_MAX="${NPC_PROGRESS_APPEND_MAX:-2}"           # 非收尾播报条数上限
APPEND_MILESTONE="${NPC_PROGRESS_APPEND_MILESTONE:-25}"  # 进度里程碑（%）
APPEND_MIN_INTERVAL="${NPC_PROGRESS_APPEND_MIN_INTERVAL:-60}"  # 播报最小间隔（秒）
DRY_RUN="${NPC_PROGRESS_DRY_RUN:-0}"                 # 自测：只渲染不发写请求
# 心跳：脱附的后台进程，每隔 HB_INTERVAL 秒**原地刷新那条评论**（PATCH 同一条，
# 不新增评论），让「最后更新 / 已耗时」自己往前走。0 = 关闭。
# 为什么需要它：NPC 在长步骤里（读大文件、等子代理、等 CI）不会频繁 update，
# 评论就整段静止 —— 用户无法区分「还在干活」和「卡死了」（Issue #12 反馈
# 「这个评论的进度都没有动过」）。心跳用「评论自带时间戳自己在走」回答这个问题。
HB_INTERVAL="${NPC_PROGRESS_HEARTBEAT:-60}"          # 心跳间隔（秒），0 = 关闭
HB_MAX_RUNS="${NPC_PROGRESS_HEARTBEAT_MAX_RUNS:-0}"  # 心跳最多刷新几次，0 = 直到收尾
HB_MAX_SECONDS="${NPC_PROGRESS_HEARTBEAT_MAX:-7200}" # 心跳最长存活（秒），兜底防僵尸
VALID_STATUS="pending running done failed skipped"
# 子代理台账的状态取值。与步骤状态是两套：步骤讲「我做到哪」，
# 台账讲「我派出去的每个子代理现在怎样」——所以单独一套，不复用。
VALID_SUB_STATUS="pending running done failed timeout stopped congested unfinished"

# 本轮任务的身份证：默认取 CNB_BUILD_ID（一次召唤 = 一条流水线 = 一个 ID）。
# 用途有两处，都为了「**不许改到别的任务的进度评论**」：
#   1. init 时同一个 task_id 再执行 → 续用自己那条（PATCH），不会重复新建；
#      换了 task_id（= 新任务）→ 一律新建。这就是「新任务新评论」的判据。
#   2. update / done / fail / note 前校验归属：状态文件若是**上一轮任务**留下的，
#      直接报错，绝不把新进度写进旧评论（用户明确要求：不能改以前的）。
TASK_ID="${NPC_PROGRESS_TASK_ID:-${CNB_BUILD_ID:-}}"

die() { printf 'npc-progress: %s\n' "$*" >&2; exit 1; }
warn() { printf 'npc-progress: %s\n' "$*" >&2; }
need() { command -v "$1" >/dev/null 2>&1 || die "缺少命令：$1"; }

# 打印用法：从第 3 行开始的所有注释行（到第一个非注释行为止）。
# 不能写死行号 —— 注释头一长就会被截断，--help 看不到 note/fail/link 等子命令。
usage() {
  awk 'NR < 3 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"
  exit "${1:-0}"
}

# ---------- 目标解析 ----------

TARGET_TYPE="issue"
TARGET_NUMBER=""

resolve_target() {
  local repo_override="$1" issue_override="$2" pr_override="$3"
  REPO="${repo_override:-${CNB_REPO_SLUG:-}}"
  [ -n "$REPO" ] || die "无法确定仓库（缺 CNB_REPO_SLUG，可用 --repo 指定）"

  if [ -n "$pr_override" ]; then
    TARGET_TYPE="pull"; TARGET_NUMBER="$pr_override"
  elif [ -n "$issue_override" ]; then
    TARGET_TYPE="issue"; TARGET_NUMBER="$issue_override"
  elif [ "${CNB_EVENT:-}" = "issue.comment@npc" ] || [ "${CNB_EVENT:-}" = "issues" ]; then
    TARGET_TYPE="issue"; TARGET_NUMBER="${CNB_ISSUE_IID:-}"
  elif [ -n "${CNB_PULL_REQUEST_IID:-}" ]; then
    TARGET_TYPE="pull"; TARGET_NUMBER="$CNB_PULL_REQUEST_IID"
  elif [ -n "${CNB_ISSUE_IID:-}" ]; then
    TARGET_TYPE="issue"; TARGET_NUMBER="$CNB_ISSUE_IID"
  else
    die "无法确定目标 Issue / PR（可用 --issue / --pr 指定）"
  fi
  [ -n "$TARGET_NUMBER" ] || die "目标编号为空（可用 --issue / --pr 指定）"
}

comment_base() {
  if [ "$TARGET_TYPE" = "pull" ]; then
    printf '%s/%s/-/pulls/%s/comments' "$API" "$REPO" "$TARGET_NUMBER"
  else
    printf '%s/%s/-/issues/%s/comments' "$API" "$REPO" "$TARGET_NUMBER"
  fi
}

target_url() {
  if [ "$TARGET_TYPE" = "pull" ]; then
    printf '%s/%s/-/pulls/%s' "$WEB" "$REPO" "$TARGET_NUMBER"
  else
    printf '%s/%s/-/issues/%s' "$WEB" "$REPO" "$TARGET_NUMBER"
  fi
}

state_file() {
  # STATE_OVERRIDE 来自 --state 参数；NPC_PROGRESS_STATE 是**脱附的心跳子进程**
  # 拿回同一个路径的通道（子进程没法继承 shell 变量，--state 又不进 argv）。
  # 顺序不能反：命令行参数优先。
  #
  # ⚠️ DRY_RUN 下**整体挪到 `.dryrun` 后缀**：承诺是「零写请求、零残留」，而状态文件
  # 也是残留 —— 更糟的是它会覆盖**真实任务**的运行态。实测（本仓 2026-10-01）：
  # `NPC_PROGRESS_DRY_RUN=1 init` 打在一个正在跑的任务上，直接把它的
  # title/steps/step_notes 全量重置，comment_id 却留着旧值 —— 那条评论随后就再也
  # 收不了尾了（NPC 改不了已发的评论）。所以 DRY_RUN 不碰真实状态路径。
  local sf
  if [ -n "${STATE_OVERRIDE:-}" ]; then sf="$STATE_OVERRIDE"; else
    if [ -n "${NPC_PROGRESS_STATE:-}" ]; then sf="$NPC_PROGRESS_STATE"; else
      mkdir -p "$STATE_DIR"
      # 按「角色名 + task_id」分文件。
      #
      # 只按角色名分不够：同一个 Issue 上同一角色被召唤两次（= 换一次构建），
      # 两条任务会命中**同一个文件**，后 init 的把前一条的状态与 comment_id 全量覆盖，
      # 前一条从此 update / done / fail 全被 assert_task_owner 拦下，
      # 它那条评论**永久停在「正在跑」**，而且没有自愈路径
      # （重新 init 会新建第二条评论，原来那条仍指不到）。
      #
      # 默认挂载下这一条其实够不到（/tmp 是容器私有、不跨构建共享，实测确认），
      # 但设计意图不该建立在「平台碰巧不给共享目录」上 —— 一旦有人把 STATE_DIR
      # 挪到缓存卷、或平台改为复用容器，症状就是这个无自愈的静默锁死。
      # 带上 task_id 之后，同任务续用同一个文件（续 init 的行为不变），
      # 跨任务天然各写各的。
      local role="${CNB_NPC_NAME:-npc}" task="${TASK_ID:-noid}"
      local key
      key="$(printf '%s/%s__%s_%s__%s' "$STATE_DIR" \
        "$(printf '%s' "$REPO" | tr '/:' '__')" "$TARGET_TYPE" "$TARGET_NUMBER" \
        "$(printf '%s' "$role" | tr '/: ' '___')")"
      sf="${key}__$(printf '%s' "$task" | tr '/: ' '___').json"
      # 向后兼容：带 task_id 之前的老路径是 `<key>.json`。
      # 不加这一段的话，「跑着的任务在升级那一刻丢掉自己的状态」—— 后续 update/done
      # 全部 `load_state_or_die` 报「找不到进度状态」，评论停在那里再也收不了尾。
      # 只在**老文件的 task_id 就是本任务**时认领，避免把上一轮任务的评论接管过来
      # （那是「不许篡改历史」这条硬约束最怕的事）。
      if [ ! -s "$sf" ] && [ -s "${key}.json" ] \
         && [ "$(jq -r '.task_id // ""' "${key}.json" 2>/dev/null)" = "$TASK_ID" ]; then
        sf="${key}.json"
      fi
    fi
  fi
  [ "$DRY_RUN" = "1" ] && sf="${sf}.dryrun"
  printf '%s' "$sf"
}

# ---------- 渲染（交给 python3，避免 bash 处理 UTF-8 的坑） ----------

render_markdown() {
  python3 - "$1" "${2:-inline}" <<'PY'
import datetime, json, sys

path, mode = sys.argv[1], sys.argv[2]
st = json.load(open(path, encoding="utf-8"))
steps = st.get("steps", [])
status = st.get("status", [])
step_notes = st.get("step_notes", {}) or {}
notes = st.get("notes", []) or []
summary = st.get("summary", "")
phase = st.get("phase", "running")

ICON = {"done": "✅", "running": "🔄", "failed": "❌",
        "pending": "⬜", "skipped": "⏭️"}
FINISHED = ("done", "skipped", "failed")

total = len(steps) or 1
done_n = sum(1 for i in range(len(steps))
             if (status[i] if i < len(status) else "pending") in ("done", "skipped"))
filled = int(round(done_n * 10 / total))
bar = "▓" * filled + "░" * (10 - filled)
ratio = int(done_n * 100 / total)

head = {"running": "🚧", "done": "✅", "failed": "❌"}.get(phase, "🚧")
title = st.get("title", "任务进展")

# ---- 时间：用户要的「详细」主要就落在这里 ----
# 光有 `▓▓▓░░░░░░░` 1/4 · 25% 只能看出「还剩几步」，看不出「这一步卡了多久」。
# 所以状态里额外记每步的开始 / 结束时间，渲染出「正在做」「每步用时」「总耗时」。
now = datetime.datetime.now(datetime.timezone.utc)
step_started = st.get("step_started_at") or {}
step_done = st.get("step_done_at") or {}


def parse_ts(value):
    """ISO8601 → 带时区的 datetime；解析不出来返回 None（兼容没有这些字段的老状态文件）。"""
    if not value:
        return None
    try:
        dt = datetime.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt


def human(seconds):
    """秒 → <1s / 45s / 12m30s / 1h05m。"""
    seconds = max(0, int(seconds))
    if seconds < 60:
        # 秒级精度下测出 0 只可能是「同一秒内开始并结束」，写「0s」容易被误读成
        # 「这一步没花时间」；写「<1s」才是它真正的量级。
        return "<1s" if seconds == 0 else f"{seconds}s"
    if seconds < 3600:
        return f"{seconds // 60}m{seconds % 60:02d}s"
    return f"{seconds // 3600}h{(seconds % 3600) // 60:02d}m"


# 状态语义版本：v2 起「开始时间」**只在把步骤标成 running 时**写入。
# 老状态（没有这个字段）里 started == done 的是旧版在标 done 时补的**假时间**，
# 得按「没打过点」渲染，否则会继续吐出「用时 0s」这种误导数据。
TIMING_V2 = isinstance(st.get("timing_version"), int) and st["timing_version"] >= 2


def step_timed(i):
    """第 i 步有没有**真实**打点（即曾经被标成 running）。"""
    started = parse_ts(step_started.get(str(i)))
    if started is None:
        return False
    if not TIMING_V2:
        # 老状态：无法区分「真打过点」与「旧版补的假时间」，用 started == done 判伪。
        done_ts = parse_ts(step_done.get(str(i)))
        if done_ts is not None and done_ts == started:
            return False
    return True


def step_elapsed(i):
    """第 i 步耗时文案：**没打过点就返回空**，绝不编造一个 0s 出来。"""
    if not step_timed(i):
        return ""
    started = parse_ts(step_started.get(str(i)))
    mark = status[i] if i < len(status) else "pending"
    # 退回 pending（重新排队）的步骤不算耗时：它还没在跑，end 取 now 会渲染成
    # 「⬜ A —— 用时 2s」—— 既不像「进行中」也不像「已完成」，读起来自相矛盾。
    # 状态侧也会在标 pending 时清掉计时（见 cmd_update），这里同步兜住。
    if mark == "pending":
        return ""
    ended = parse_ts(step_done.get(str(i))) if mark in FINISHED else now
    if ended is None:
        return ""
    return human((ended - started).total_seconds())


# 从没打过点的步骤数：收尾后统计一次，用于在正文里说明「这些不是 0s，是缺打点」
untimed = [i for i in range(len(steps))
           if (status[i] if i < len(status) else "pending") in ("done", "failed")
           and not step_timed(i)]


total_elapsed = ""
_started = parse_ts(st.get("started_at"))
if _started is not None:
    _ended = parse_ts(st.get("finished_at")) or now
    total_elapsed = human((_ended - _started).total_seconds())

# 标记里带 role 与 phase：复用扫描据此判定「这条是不是我这个角色留下的」「它收尾没有」，
# 而不是去猜正文里有没有「全部完成（」这种字样 —— 任务标题/补充说明里写一句同名文案
# 就会让一条**正在跑**的评论被误判成可复用，被下一个任务原地改掉。
role = (st.get("role") or "NPC").replace("-->", "")
lines = [f"<!-- npc-progress:auto role={role} phase={phase} -->", ""]
seq = st.get("append_seq")
if mode == "append" and seq:
    lines.append(f"<sub>⏱ 进展播报 #{seq} · 以**最新一条**评论为准</sub>")
    lines.append("")
lines.append(f"### {head} {title}")
lines.append("")
# done 的标题别再无条件写「全部完成」：cmd_done 只把 pending / running 收尾，
# **failed 步骤会原样留着**（那是事实，不该被「收尾」洗白）。正文里既有 ❌ 又写
# 「全部完成」，用户读不出到底成没成 —— 实测带一处失败收尾就会出现这种自相矛盾。
# 只看 failed，不看 skipped：跳过是**主动决定**（进度条同样满格，⏭️ 也标得清楚），
# 把它降级会让一次成功的任务显得像没做成。
n_failed = sum(1 for i in range(len(steps))
               if (status[i] if i < len(status) else "pending") == "failed")
if phase == "done":
    if n_failed:
        head_line = (f"`{bar}` **已完成 {len(steps) - n_failed}/{len(steps)} 步"
                     f"（{n_failed} 步失败）**")
    else:
        head_line = f"`{bar}` **全部完成（{len(steps)}/{len(steps)}）**"
elif phase == "failed":
    head_line = f"`{bar}` **已中止（{done_n}/{len(steps)}）**"
else:
    head_line = f"`{bar}` **{done_n}/{len(steps)} · {ratio}%**"
if total_elapsed:
    head_line += f" · 已耗时 {total_elapsed}"
lines.append(head_line)
lines.append("")

# 「正在做」区块：把当前那一步单独拎出来置顶。
# 只给一串 1/4、2/4 时，用户还是不知道 NPC 此刻在干什么 —— 这一步就是补它。
if phase == "running":
    cur = next((i for i in range(len(steps))
                if (status[i] if i < len(status) else "pending") == "running"), None)
    if cur is not None:
        el = step_elapsed(cur)
        suffix = f"（已 {el}）" if el else ""
        lines.append(f"**🔄 正在做：{steps[cur]}**{suffix}")
        note = step_notes.get(str(cur), "")
        if note:
            lines.append(f"> {note}")
        lines.append("")
    else:
        nxt = next((i for i in range(len(steps))
                    if (status[i] if i < len(status) else "pending") == "pending"), None)
        if nxt is not None:
            lines.append(f"**⏭ 下一步：{steps[nxt]}**")
            lines.append("")

for i, s in enumerate(steps):
    mark = status[i] if i < len(status) else "pending"
    note = step_notes.get(str(i), "")
    el = step_elapsed(i)
    parts = []
    if mark == "running":
        parts.append(f"进行中，已 {el}" if el else "进行中")
    elif el:
        parts.append(f"用时 {el}")
    elif mark in ("done", "failed"):
        # 没打过点的步骤**不显示耗时** —— 留空会被当成「没花时间」，
        # 写「0s」更糟（看着像秒级完成）。如实说「未单独计时」，把信息缺口暴露出来。
        parts.append("未单独计时")
    # 进行中那步的说明已经在上面「正在做」区里了，这里不重复
    if note and mark != "running":
        parts.append(note)
    suffix = f" —— {' · '.join(parts)}" if parts else ""
    lines.append(f"- {ICON.get(mark, '⬜')} {s}{suffix}")
# ---- 子代理台账：每个子代理一行，按 sn 原地更新 ----
# 为什么不做成「追加到补充说明」：旧写法每条心跳追加一行「仍在等待子代理 X
# （已 900s / 上限 2400s，状态 pending）」，同一件事刷十几条，读的人只看到重复。
# 用户的原话是「一个子代理就直接显示一个，后面加上它的状态，不需要这样重复地搞」。
# 所以这里渲染成**一份清单**：当前在跑的、之前派过已收尾的，各占一行。
#
# 耗时**在这里现算**（渲染时刻 - started_at），不是写死的字符串 ——
# 这样进度评论的心跳每刷一次，在跑的子代理耗时自己就往前走了。
SUB_ICON = {"pending": "⏳", "running": "🔄", "done": "✅", "failed": "❌",
            "timeout": "⏱️", "stopped": "🛑", "congested": "🚦", "unfinished": "⚠️"}
SUB_LABEL = {"pending": "排队中", "running": "运行中", "done": "已完成",
             "failed": "失败", "timeout": "等待超时（仍在跑）", "stopped": "已回收",
             "congested": "并发超限未开跑", "unfinished": "未收口（父任务已结束）"}
subagents = st.get("subagents") or {}
# 顺序：在跑的排前面（用户最关心），各自内部按开始时间。
sub_rows = []
for sn, sa in subagents.items():
    if not isinstance(sa, dict):
        continue
    s_st = sa.get("status") or "pending"
    started = parse_ts(sa.get("started_at"))
    finished = parse_ts(sa.get("finished_at"))
    el = ""
    if started is not None:
        end = finished if finished is not None else now
        el = human((end - started).total_seconds())
    limit = sa.get("limit") or ""
    over = ""
    if s_st in ("running", "pending") and started is not None and limit:
        try:
            if (now - started).total_seconds() > float(limit):
                over = f"（已超上限 {human(limit)}）"
        except (TypeError, ValueError):
            pass
    sub_rows.append((0 if s_st in ("running", "pending") else 1,
                     str(sa.get("started_at") or ""), sn, s_st, el, limit, over, sa))
sub_rows.sort(key=lambda r: (r[0], r[1]))
if sub_rows:
    n_live = sum(1 for r in sub_rows if r[3] in ("running", "pending"))
    n_done = sum(1 for r in sub_rows if r[3] in ("done", "failed", "timeout",
                                                 "stopped", "congested", "unfinished"))
    head_s = f"**🤖 子代理（共 {len(sub_rows)} 个"
    if n_live:
        head_s += f" · 进行中 {n_live}"
    if n_done:
        head_s += f" · 已收口 {n_done}"
    head_s += "）**"
    lines += ["", head_s, ""]
    for _o, _st_ts, sn, s_st, el, limit, over, sa in sub_rows:
        parts = []
        if s_st in ("running", "pending"):
            # 在跑：给「已耗时 / 上限」，用户据此判断是不是快到了
            elo = f"已 {el}" if el else "已 <1s"
            if limit:
                parts.append(f"{elo} / 上限 {human(limit)}{over}")
            else:
                parts.append(elo)
        elif el:
            parts.append(f"用时 {el}")
        parts.append(SUB_LABEL.get(s_st, s_st))
        if sa.get("cpus"):
            parts.append(f"{sa['cpus']} 核")
        if sa.get("thinking"):
            parts.append(f"思考 {sa['thinking']}")
        nm = sa.get("name") or ""
        nm_s = f"「{nm}」" if nm else ""
        task = (sa.get("task") or "").replace("\n", " ").strip()
        tail = f" — {task}" if task else ""
        lines.append(f"- {SUB_ICON.get(s_st, '⬜')} `{sn}` {nm_s}"
                     f"{' · '.join(p for p in parts if p)}{tail}")
    if n_live:
        lines.append("")
        try:
            _hb = int(st.get("hb_interval") or 0)
        except (TypeError, ValueError):
            _hb = 0
        _how = f"（每 {_hb}s 一次心跳）" if _hb > 0 else "（下一次进度刷新时）"
        lines.append(f"<sub>进行中子代理的耗时随评论刷新自动往前走{_how}；"
                     f"已收口的保留在清单里，便于追溯。</sub>")

if notes:
    lines += ["", "**补充说明**", ""]
    # 只显示最近 4 条（防止被循环调用撑爆），但截断了要说出来 ——
    # 悄悄少几条，读的人会把「看到的」当成全部（Issue 里正是靠这些说明留里程碑）。
    for n in notes[-4:]:
        lines.append(f"- {n}")
    if len(notes) > 4:
        lines.append(f"- …（仅显示最近 4 条，共 {len(notes)} 条）")
if untimed:
    # 用户在 Issue #12 问过「有的任务用时 0s？而且这个任务并不简单」——
    # 根因正是缺打点被渲染成 0s。这里把缺口显式写出来，避免同一个误读再发生。
    lines += ["", f"<sub>⚠️ {len(untimed)} 步未单独计时（没标过「进行中」）——"
                  f"是缺打点，不代表耗时 0s；总耗时仍然有效。</sub>"]
if summary:
    lines += ["", f"> **结论**：{summary}"]
lines.append("")
# 「最后更新」时刻：用户判断「这条评论是活的还是卡住了」的最直接依据。
# 旧版渲染里有它，后来被删掉了 —— 于是评论一旦长时间不 update，就完全看不出
# 是「还在跑」还是「早就断了」，用户只能来问「这个进度都没有动过呀」（Issue #12）。
# 配合心跳（见 cmd_heartbeat），这个时间戳会**自己往前走**，无需 NPC 干预。
ts = datetime.datetime.now(
    datetime.timezone(datetime.timedelta(hours=8))).strftime("%Y-%m-%d %H:%M:%S")
who = st.get("role") or "NPC"
hb = st.get("hb_interval") or 0
try:
    hb = int(hb)
except (TypeError, ValueError):
    hb = 0
if mode == "append":
    hint = f"{who} 自动追加的进展播报"
elif hb > 0 and phase == "running":
    # 心跳开着：明确告诉用户「这个时间戳会自动刷新」，静止就是真卡住了
    hint = f"每 {hb}s 自动原地刷新（心跳）"
else:
    hint = f"{who} 自动**原地刷新**，无需手动操作"
lines.append(f"<sub>最后更新 {ts}（UTC+8） · {hint}</sub>")
sys.stdout.write("\n".join(lines))
PY
}

# ---------- 评论读写（裸 REST，避免依赖 cnb CLI 的封装差异） ----------

post_comment() {
  # post_comment <markdown> → 打印 comment id
  need curl; need jq
  if [ "$DRY_RUN" = "1" ]; then
    warn "[dry-run] 本应创建评论（$# 段正文已渲染）：\n$(printf '%s' "$1" | head -c 400)"
    printf 'dry-run-%s' "$(date +%s)"
    return 0
  fi
  local body_file resp id
  body_file="$(mktemp)"
  jq -n --arg b "$1" '{body:$b}' > "$body_file"
  resp="$(curl -sS --max-time 60 -X POST "$(comment_base)" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -H "Accept: application/vnd.cnb.api+json" \
    --data-binary @"$body_file" 2>&1)"
  rm -f "$body_file"
  id="$(printf '%s' "$resp" | jq -r '.id // .data.id // empty' 2>/dev/null)"
  if [ -z "$id" ]; then
    warn "创建评论失败：$(printf '%s' "$resp" | head -c 300)"
    return 1
  fi
  printf '%s' "$id"
}

patch_comment() {
  # patch_comment <comment_id> <markdown>
  need curl; need jq
  if [ "$DRY_RUN" = "1" ]; then
    warn "[dry-run] 本应原地刷新评论 $1：\n$(printf '%s' "$2" | head -c 400)"
    return 0
  fi
  local body_file resp
  body_file="$(mktemp)"
  jq -n --arg b "$2" '{body:$b}' > "$body_file"
  resp="$(curl -sS --max-time 60 -X PATCH "$(comment_base)/$1" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -H "Accept: application/vnd.cnb.api+json" \
    --data-binary @"$body_file" 2>&1)"
  rm -f "$body_file"
  if printf '%s' "$resp" | jq -e '.id // .data.id' >/dev/null 2>&1; then
    LAST_PATCH_RESP=""
    return 0
  fi
  LAST_PATCH_RESP="$resp"
  warn "原地更新失败：$(printf '%s' "$resp" | head -c 300)"
  return 1
}

# 判断「上一次 PATCH 失败是不是不可恢复」：评论被删（404）或无权限（403）。
# 平台实测返回体形如 {"errcode":2003022,"errmsg":"forbidden to edit NPC generated content"}
# 或 {"errcode":5}（404）。按 errcode / errmsg **双判**：平台改文案时至少还有一半能兜住。
# 判不出来时返回「非致命」—— 宁可保持原地刷新（大不了下次再试），也不要一次性
# 把任务永久降级成追加（追回的评论删不掉，越降越糟）。
LAST_PATCH_RESP=""
last_patch_fatal() {
  local r="${LAST_PATCH_RESP:-}"
  [ -n "$r" ] || return 1
  if printf '%s' "$r" | grep -qE 'forbidden to edit|no permission|无权限|not allowed to edit'; then
    return 0
  fi
  case "$(printf '%s' "$r" | jq -r '.errcode // .data.errcode // empty' 2>/dev/null)" in
    5|404|2003022|2003023|40003) return 0 ;;
  esac
  return 1
}

# ---------- 历史复用（非默认，仅 NPC_PROGRESS_REUSE=1 时走到） ----------
#
# 默认路径**不**进这里：新任务一律新建评论（用户要求，历史评论不许改）。
# 保留这段是为了「评论实在太多、想把进度合并成一条」的显式场景。

hunt_reuse_target() {
  # hunt_reuse_target <新正文> → 打印被成功改写的 comment id（空 = 无可复用）
  # ⚠️ 只在 REUSE=1 时被调用（见 cmd_init）；默认 0 时历史评论一个都不碰。
  #
  # 可复用的进度评论要满足三个条件：
  #   1. 正文带统一标记 `<!-- npc-progress:auto -->`（只认进度评论，不碰正常讨论）；
  #   2. **不是 NPC 身份**发的（平台禁止 NPC 改 NPC 评论，PATCH 必 403 —— 实测）；
  #   3. 已经收尾（「全部完成」/「已中止」），
  #      或者早于 NPC_PROGRESS_REUSE_STALE（默认 1800s）没更新过 ——
  #      后者兜的是「上一次任务没跑完就没了」留下的僵尸进度评论；
  #      设这个时间闸是为了不误改**正在跑**的并发任务。
  #
  # 扫描顺序 `sort=-updated`：最近动过的那条优先，评论位置稳定、不来回跳。
  # 认领方式是「直接用新正文 PATCH 试写」——找与认领合成一步，不额外发请求；
  # 候选跨页收集后去重（分页边界上同一条可能被重复返回）。
  local md="$1" page resp ids cnt all_ids id
  [ "$REUSE" = "1" ] || return 0
  [ "$DRY_RUN" = "1" ] && return 0

  # 分页上限按 REUSE_SCAN（默认 100）算，不再硬编码 3 页。
  # 旧版写死 3 页、同时把「返回条数不足 100 就停」当结束条件 ——
  # 平台若把 page_size 限制到更小（如 30），第一页就 <100，扫描只覆盖 30 条，
  # 老的可复用评论永远找不到，于是每轮任务都新建一条，评论区重新越积越多。
  local page_size=100 max_pages
  max_pages=$(( (REUSE_SCAN + page_size - 1) / page_size ))
  [ "$max_pages" -ge 1 ] || max_pages=1
  page=1
  all_ids=""
  while [ "$page" -le "$max_pages" ]; do
    resp="$(curl -sS --max-time 60 \
      "$(comment_base)?sort=-updated&page=${page}&page_size=100" \
      -H "Authorization: Bearer ${TOKEN}" \
      -H "Accept: application/vnd.cnb.api+json" 2>/dev/null)" || break
    cnt="$(printf '%s' "$resp" | jq 'if type == "array" then length else 0 end' 2>/dev/null || echo 0)"
    ids="$(printf '%s' "$resp" | jq -r \
      --argjson stale "${NPC_PROGRESS_REUSE_STALE:-1800}" \
      --arg role "${CNB_NPC_NAME:-NPC}" '
      (if type == "array" then . else [] end)[]
      | select((.body // "") | contains("<!-- npc-progress:auto"))
      | select(((.author.username // "") | test("CodeBuddy|npc"; "i") | not))
      | . as $c
      | (($c.body // "") | capture("npc-progress:auto(?<meta>[^>]*)") | .meta) as $meta
      # 归属：标记里写了 role 且不是本角色 → 不碰（同 Issue 上并发多任务时防止互踩）。
      # 旧格式标记没有 role，按「可复用」处理以兼容历史评论。
      # 归属：用 contains 而不是正则 —— 角色名里有 `.`（deepseek-v4.1-flash-max），
      # 当正则用会把 `.` 解释成通配符（甚至转义错误），contains 是字面比较，稳。
      | select((($meta | contains("role=")) | not) or ($meta | contains("role=" + $role)))
      # 已收尾：优先看结构化 phase；旧格式回落到正文子串
      | select(
          ($meta | test("phase=(done|failed)"))
          or (($meta | test("phase=")) | not)
             and (($c.body // "") | (contains("全部完成（") or contains("已中止（")))
          or ( (($c.updated_at // "") | fromdateiso8601? // (now)) < (now - $stale) )
        )
      | .id' 2>/dev/null)"
    [ -n "$ids" ] && all_ids="${all_ids}${ids}"$'\n'
    # 结束条件用「本页返回 0 条」而不是「不足页大小」：
    # 后者在平台 page_size 被压小时会提前退出，漏掉后面的评论。
    [ "${cnt:-0}" -gt 0 ] || break
    page=$((page + 1))
  done

  while IFS= read -r id; do
    [ -n "$id" ] || continue
    if patch_comment "$id" "$md"; then
      printf '%s' "$id"
      return 0
    fi
  done < <(printf '%s' "$all_ids" | awk 'NF && !seen[$0]++')
  return 0
}

# ---------- OCI 子流水线：创建「可被 NPC 原地刷新」的评论 ----------

child_config() {
  cat <<YAML
\$:
  ${EVENT}:
    - # 进度子流水线只做「POST 一条评论」，是最轻的负载。
      # 走默认 8 核 16G 纯属浪费——核时按 cpus 计费，而根组织并发额度也只有 64 条，
      # 规格压下来后同一批任务占的资源显著变小。压到 1 核 2G 足够
      #（与主容器 4 核的定位无关：这条子流水线只 POST 一条评论）。
      runner:
        # 字面量数字：cpus 的 Schema 是 Number，写成变量引用会变字符串导致类型校验失败
        cpus: 1
      docker:
        image: ${IMG}
      stages:
        - name: create progress comment
          script: |
            set -u
            TARGET_TYPE="\${NPC_PROGRESS_TARGET_TYPE:-issue}"
            if [ "\$TARGET_TYPE" = "pull" ]; then
              URL="\${CNB_API_ENDPOINT:-https://api.cnb.cool}/\${CNB_REPO_SLUG}/-/pulls/\${NPC_PROGRESS_TARGET}/comments"
            else
              URL="\${CNB_API_ENDPOINT:-https://api.cnb.cool}/\${CNB_REPO_SLUG}/-/issues/\${NPC_PROGRESS_TARGET}/comments"
            fi
            # 正文经 env 下发，用 jq -Rs 做 JSON 转义，避免换行 / 引号破坏请求
            printf '%s' "\${NPC_PROGRESS_BODY_MD:-}" | jq -Rs '{body:.}' > /tmp/body.json
            RESP=\$(curl -sS --max-time 60 -X POST "\$URL" \\
              -H "Authorization: Bearer \${CNB_TOKEN}" \\
              -H "Content-Type: application/json" \\
              -H "Accept: application/vnd.cnb.api+json" \\
              --data-binary @/tmp/body.json)
            ID=\$(printf '%s' "\$RESP" | jq -r '.id // .data.id // empty' 2>/dev/null)
            printf 'NPC_PROGRESS_ID_B64:'
            printf '%s' "\$ID" | base64 -w0 2>/dev/null || printf '%s' "\$ID" | base64 | tr -d '\\n'
            printf ':END\\n'
            [ -n "\$ID" ] || { echo "create comment failed: \$(printf '%s' "\$RESP" | head -c 400)"; exit 1; }
YAML
}

create_via_pipeline() {
  # create_via_pipeline <markdown-body> → 打印 comment id
  # 关键：请求体**不带 npc 字段**，让评论归属流水线 OCI 身份，
  # 从而可被 NPC token 后续 PATCH 原地刷新。
  need curl; need jq
  # dry-run：连子流水线都不触发（自测要零副作用，不能留下任何构建与评论）
  if [ "$DRY_RUN" = "1" ]; then
    warn "[dry-run] 本应触发进度子流水线创建评论（已跳过）"
    return 1
  fi
  command -v cnb >/dev/null 2>&1 || { warn "缺 cnb CLI，无法等子流水线"; return 1; }

  local body="$1" cfg resp sn waited status sid out
  local payload
  cfg="$(child_config)"
  payload="$(jq -n \
    --arg event "$EVENT" \
    --arg cfg "$cfg" \
    --arg target "$TARGET_NUMBER" \
    --arg ttype "$TARGET_TYPE" \
    --arg body "$body" \
    '{event:$event, config:$cfg, sync:false,
      title:"[npc-progress] create progress comment",
      env:{NPC_PROGRESS_TARGET:$target, NPC_PROGRESS_TARGET_TYPE:$ttype,
           NPC_PROGRESS_BODY_MD:$body}}')"

  # 分支兜底（同 subagent.sh）：PR / Fork 场景下 CNB_BRANCH 可能是临时引用，
  # 直接触发会因取不到 SHA 失败。候选顺序：当前分支 → 默认分支 → PR 目标/源分支。
  # 子流水线配置是内联下发的，走哪个分支检出源码不影响执行。
  local cand branch_list=()
  for cand in "${CNB_BRANCH:-}" "${CNB_DEFAULT_BRANCH:-}" \
              "${CNB_PULL_REQUEST_TARGET_BRANCH:-}" "${CNB_PULL_REQUEST_BRANCH:-}"; do
    [ -n "$cand" ] || continue
    local dup=0
    for local_existing in ${branch_list[@]+"${branch_list[@]}"}; do
      [ "$local_existing" = "$cand" ] && dup=1 && break
    done
    [ "$dup" = "1" ] && continue
    # cnb CLI 查到 404 也返回退出码 0，必须判响应体里的 status
    if [ "$(cnb git get-branch --repo "$REPO" --branch "$cand" -v 2>/dev/null \
            | jq -r '.status // empty' 2>/dev/null)" = "200" ]; then
      branch_list+=("$cand")
    fi
  done
  [ "${#branch_list[@]}" -gt 0 ] || branch_list=("${CNB_BRANCH:-main}")

  sn=""; local errmsg=""
  for cand in "${branch_list[@]}"; do
    resp="$(printf '%s' "$payload" | jq -c --arg b "$cand" '.branch = $b' \
      | curl -sS --max-time 60 -X POST "$API/$REPO/-/build/start" \
        -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
        --data @- 2>&1)"
    sn="$(printf '%s' "$resp" | jq -r '.sn // empty' 2>/dev/null)"
    if [ -n "$sn" ]; then
      # 构建可能已创建但因并发超限随即失败，这里把 errMsg 也带出来便于定位
      errmsg="$(printf '%s' "$resp" | jq -r '.errMsg // .errmsg // empty' 2>/dev/null)"
      break
    fi
    errmsg="$(printf '%s' "$resp" | jq -r '.errMsg // .errmsg // .' 2>/dev/null)"
  done
  if [ -z "$sn" ]; then
    warn "触发进度子流水线被拒绝：$(printf '%s' "$errmsg" | head -c 300)"
    return 1
  fi
  warn "进度子流水线已启动：$sn"

  waited=0; status=""
  while :; do
    status="$(cnb build get-build-status --repo "$REPO" --sn "$sn" -v 2>/dev/null \
      | jq -r '.data.status // empty' 2>/dev/null)"
    case "$status" in
      success|error|cancel|failed) break ;;
    esac
    if [ "$waited" -ge "$INIT_TIMEOUT" ]; then
      warn "等待子流水线超时（${INIT_TIMEOUT}s），放弃原地刷新"
      return 1   # 排队太久：重试只会更慢，直接降级
    fi
    sleep "$POLL_INTERVAL"; waited=$((waited + POLL_INTERVAL))
  done

  if [ "$status" != "success" ]; then
    local emsg
    emsg="$(cnb build get-build-status --repo "$REPO" --sn "$sn" -v 2>/dev/null \
      | jq -r '.data.errMsg // empty' 2>/dev/null | tr '\n' ' ')"
    warn "进度子流水线未成功（status=$status）${emsg:+：$emsg}"
    warn "构建日志：$WEB/$REPO/-/build/logs/$sn"
    # 退出码 2 = 「瞬时拥塞，值得重试」（并发构建超限）；
    # 其余（权限不足、配置错误等）重试也没用，交给上层直接降级。
    if printf '%s' "$emsg" | grep -q "并发构建数量超出根组织限制\|concurrent builds has exceeded"; then
      return 2
    fi
    return 1
  fi

  sid="$(cnb build get-build-status --repo "$REPO" --sn "$sn" -v 2>/dev/null \
    | jq -r --arg sn "$sn" '.data.pipelinesStatus[$sn + "-001"].stages[]?
        | select(.name == "create progress comment") | .id' 2>/dev/null | head -n1)"
  [ -n "$sid" ] || { warn "未找到 create progress comment 阶段"; return 1; }

  out="$(cnb build get-build-stage --repo "$REPO" --sn "$sn" \
      --pipelineId "$sn-001" --stageId "$sid" -v 2>/dev/null \
    | jq -r '.data.content[]?' 2>/dev/null \
    | python3 -c '
import base64, re, sys
pat = re.compile(r"NPC_PROGRESS_ID_B64:([A-Za-z0-9+/=]*):END")
payload = None
for line in sys.stdin:
    for m in pat.finditer(re.sub(r"\x1b\[[0-9;]*m", "", line)):
        payload = m.group(1)
sys.stdout.write(base64.b64decode(payload).decode("utf-8") if payload else "")
')"
  [ -n "$out" ] || { warn "子流水线未回传评论 ID"; return 1; }
  printf '%s' "$out"
}

# ---------- 状态读写 ----------

# 原子写入：先写临时文件再 mv 替换。
# 直接 `> file` 会在「写到一半被中断 / 磁盘抖动」时留下半截 JSON；而读侧只要
# 非空就当合法（旧版行为），于是后续 jq 取值全部变空、渲染出空正文、
# 却照样把一条**长度为 0 的评论**发进 Issue（评论删不掉），更新还返回 0。
save_state() {
  local f="$1" tmp
  tmp="$(mktemp "${f}.XXXXXX" 2>/dev/null)" || tmp="${f}.tmp.$$"
  printf '%s' "$2" > "$tmp" || { rm -f "$tmp"; die "写入进度状态失败：$f"; }
  mv -f "$tmp" "$f" || { rm -f "$tmp"; die "替换进度状态失败：$f"; }
}

load_state_or_die() {
  local sf="$1"
  [ -s "$sf" ] || die "找不到进度状态（先执行 init）：$sf"
  # 非空还不够：状态文件必须是合法 JSON 且是对象，否则后续 jq 全空、
  # 渲染出空正文 → 发空评论。宁可在这里死掉，也不要把空评论写进 Issue。
  jq -e 'type == "object"' "$sf" >/dev/null 2>&1 \
    || die "进度状态文件已损坏（非合法 JSON 对象）：$sf（删除后重新 init 即可）"
}

# 归属校验：状态文件必须是**本轮任务**的，否则拒绝写入。
#
# 为什么必须拦：状态文件按「仓库+目标+角色」定位，同一个 Issue 上同一角色被召唤两次
# 会命中同一个文件。若上一轮任务没清掉、本轮又漏了 init，update 就会 PATCH
# **上一轮那条评论** —— 等于篡改历史记录，正是用户明确否掉的行为。
# 两边 task_id 都为空时无法判定（如本地手跑），此时不拦，避免误伤。
assert_task_owner() {
  local sf="$1" owner
  owner="$(jq -r '.task_id // ""' "$sf" 2>/dev/null)"
  [ -n "$owner" ] || return 0
  [ -n "$TASK_ID" ] || return 0
  [ "$owner" = "$TASK_ID" ] && return 0
  die "进度状态文件属于另一个任务（task_id=$owner，当前=$TASK_ID）——
       这是上一轮任务留下的，不能把新进度写进旧评论（历史不可改）。
       （状态文件按「角色 + task_id」分文件，正常不会命中这一条；
       看到它说明状态文件被手工挪过，或有人在同一个容器里显式传了不同的
       NPC_PROGRESS_TASK_ID。要给本轮建进度评论就执行 init。）"
}

# 校验 --status 取值
validate_status() {
  case " $VALID_STATUS " in
    *" $1 "*) return 0 ;;
    *) die "非法 --status：$1（可选：$VALID_STATUS）" ;;
  esac
}

# 校验子代理台账的 --status 取值
validate_sub_status() {
  case " $VALID_SUB_STATUS " in
    *" $1 "*) return 0 ;;
    *) die "非法 --status：$1（子代理台账可选：$VALID_SUB_STATUS）" ;;
  esac
}

# 子代理台账里「已经收口」的状态：这些要记结束时间，渲染成「已完成」类文案
sub_status_final() {
  case "$1" in
    done|failed|timeout|stopped|congested|unfinished) return 0 ;;
    *) return 1 ;;
  esac
}

append_post() {
  # append_post <state_file>：追加播报（内容去重 → 里程碑 → 上限/间隔 → 发布）
  #
  # 门槛按顺序判，任一条不过就**只更新状态文件、不发评论**：
  #   1. 去重：状态签名与上次一致 → 不发（摘要取自状态，不拿渲染结果算 ——
  #      后者含序号与时间戳，必然每次不同）；
  #   2. 里程碑：进度未跨过 NPC_PROGRESS_APPEND_MILESTONE（默认 25%）→ 不发；
  #   3. 条数上限：非收尾播报已达 NPC_PROGRESS_APPEND_MAX（默认 2）→ 不发；
  #   4. 最小间隔：距上一条未满 NPC_PROGRESS_APPEND_MIN_INTERVAL（默认 60s）→ 不发。
  # 收尾（done / failed）只受去重约束，永远发得出去 —— 用户必须能看到结论。
  local sf="$1" signature digest last md new_id seq phase total done_n percent
  local last_pct last_at now prev_phase
  # 结构化标记里带 phase，复用扫描要用；渲染取状态里的值，这里只做兜底
  [ -n "$(jq -r '.role // empty' "$sf")" ] || \
    save_state "$sf" "$(jq -c --arg r "${CNB_NPC_NAME:-NPC}" '.role = $r' "$sf")"

  signature="$(jq -c '{title, steps, status, step_notes, notes, summary, phase, subagents}' "$sf")"
  digest="$(printf '%s' "$signature" | sha256sum | cut -d' ' -f1)"
  last="$(jq -r '.last_append_digest // ""' "$sf")"
  if [ "$digest" = "$last" ]; then
    return 0   # 内容无变化：不新增评论
  fi

  phase="$(jq -r '.phase // "running"' "$sf")"
  total="$(jq -r '(.steps | length)' "$sf")"
  done_n="$(jq -r '[.status[] | select(. == "done" or . == "skipped")] | length' "$sf")"
  if [ "$total" -gt 0 ]; then percent=$(( done_n * 100 / total )); else percent=0; fi

  # 「收尾播报永远发得出去」只该对**第一次**收尾成立。旧版把 phase != running
  # 整块跳过闸门，于是 `update --status failed` 逐条打点、收尾后再连发几次
  # done/note 都能各追加一条，一个任务能刷出十几条评论（平台删不掉）。
  # 无条件放行的只有**首次收尾**：上一次成功播报还是 running（或还没收尾过）。
  # 之后（done → 补 note / 重复 done / 再标 fail）一律回到闸门内，
  # 否则收尾之后随便调几次都能各追加一条，一个任务能刷出十几条评论（删不掉）。
  prev_phase="$(jq -r '.last_published_phase // ""' "$sf")"
  local first_final=0
  if [ "$phase" != "running" ] \
     && [ "$prev_phase" != "done" ] && [ "$prev_phase" != "failed" ]; then
    first_final=1
  fi
  # 「改判」也要必发：某步 failed 会把整条置为「已中止」并播报出去，之后任务换方案
  # 跑完再 done —— 这是**结论变了**，不是重复收尾。挡掉它，Issue 上最后留着的就是
  # 那条「❌ 已中止」，用户以为整轮挂了（实测复现：4/4 全绿却看不到那句结论）。
  # 只放行 failed → done 这一个方向；done 之后再 failed / 重复 done 仍回闸门，
  # 收尾封顶这条硬约束因此没有被削弱。
  local rejudged=0
  if [ "$phase" = "done" ] && [ "$prev_phase" = "failed" ]; then
    rejudged=1
  fi
  if [ "$first_final" = "0" ] && [ "$rejudged" = "0" ]; then
    seq="$(jq -r '.append_seq // 0' "$sf")"
    if [ "$seq" -ge "$APPEND_MAX" ]; then
      warn "append 播报已达上限（$APPEND_MAX 条），后续只更新状态文件（收尾仍会发）"
      return 0
    fi
    last_pct="$(jq -r '.last_append_percent // -1' "$sf")"
    if [ "$last_pct" -ge 0 ] \
       && [ "$(( percent - last_pct ))" -lt "$APPEND_MILESTONE" ]; then
      warn "进度 ${percent}%（距上次播报 ${last_pct}%）未跨 ${APPEND_MILESTONE}% 里程碑，暂不播报"
      return 0
    fi
    last_at="$(jq -r '.last_append_at // 0' "$sf")"
    now="$(date +%s)"
    if [ "$last_at" -gt 0 ] && [ "$APPEND_MIN_INTERVAL" -gt 0 ] \
       && [ "$(( now - last_at ))" -lt "$APPEND_MIN_INTERVAL" ]; then
      warn "距上次播报不足 ${APPEND_MIN_INTERVAL}s，暂不播报（避免刷屏）"
      return 0
    fi
  fi

  # 先把「上一次播报」的计数取出来存档：发送失败时要回滚到这组值。
  # ⚠️ 必须在 save_state 之前取 —— 之后再读拿到的就是刚写进去的新值了。
  local prev_seq prev_pct prev_at
  prev_seq="$(jq -r '.append_seq // 0' "$sf")"
  prev_pct="$(jq -r '.last_append_percent // -1' "$sf")"
  prev_at="$(jq -r '.last_append_at // 0' "$sf")"
  seq=$(( prev_seq + 1 ))
  now="$(date +%s)"
  save_state "$sf" "$(jq -c --argjson q "$seq" --argjson p "$percent" --argjson t "$now" \
    '.append_seq = $q | .last_append_percent = $p | .last_append_at = $t' "$sf")"
  md="$(render_markdown "$sf" append)"
  if [ -z "$md" ]; then
    warn "渲染结果为空，已放弃本次播报（避免发出空评论）"
    return 1
  fi
  # 计数器**先回滚再发**：旧版先落盘 append_seq/percent/at，POST 失败就永久
  # 吞掉这个里程碑 —— 之后进度再往前跨档也不会重发，用户永远看不到那 25%/50%。
  if ! new_id="$(post_comment "$md")"; then
    # 回滚到「上一次成功播报」的计数（prev_seq / prev_pct / prev_at 在写之前存过档）；
    # 否则这次失败的里程碑会被永久吞掉，之后进度再跨档也不会重发。
    save_state "$sf" "$(jq -c --argjson q "$prev_seq" --argjson p "$prev_pct" \
      --argjson t "$prev_at" \
      '.append_seq = $q | .last_append_percent = $p | .last_append_at = $t' "$sf")"
    warn "播报发送失败，已回滚计数（本次里程碑稍后会重试）"
    return 1
  fi
  save_state "$sf" "$(jq -c --arg cid "$new_id" --arg d "$digest" --arg p "$phase" --argjson t "$now" \
    '.last_comment_id = $cid | .last_append_digest = $d | .last_append_at = $t
     | .last_published_phase = $p' "$sf")"
  return 0
}

refresh() {
  # refresh <state_file>：原地刷新（单条评论反复更新）；失败自动降级为追加
  local sf="$1" mode cid md
  mode="$(jq -r '.mode // "inline"' "$sf")"

  case "$mode" in
    off) return 0 ;;
    inline)
      cid="$(jq -r '.comment_id // ""' "$sf")"
      if [ -n "$cid" ]; then
        md="$(render_markdown "$sf" inline)"
        if [ -z "$md" ]; then
          warn "渲染结果为空，已放弃本次刷新（避免发出空评论）"
          return 1
        fi
        if patch_comment "$cid" "$md"; then
          return 0
        fi
        # 降级是**单向**的：一旦切到 append，后面每次都追加评论（平台删不掉），
        # 所以只对「确定不可恢复」的失败降级 —— 评论被删（404）/ 无权限（403）。
        # 瞬时 5xx / 超时重试一次再决定，别让一次网络抖动把 1 条评论变成 N 条。
        if patch_comment "$cid" "$md"; then
          return 0
        fi
        if ! last_patch_fatal; then
          # 注释里一直写着「只对 403/404 降级」，实现却对**任何**失败都降级 ——
          # 实测：让 PATCH 恒返回 500，一次 update 就把本任务永久切成 append。
          # 这里改成「非致命失败保持 inline，交给下一次 update 再试」。
          warn "原地刷新暂时失败（非 403/404，保持原地刷新模式，下次更新会再试）"
          return 0
        fi
        warn "原地刷新失败（评论被删或无权限，重试后仍失败），本节起改用「追加播报」模式"
      fi
      save_state "$sf" "$(jq -c '.mode = "append"' "$sf")"
      append_post "$sf"
      ;;
    append) append_post "$sf" ;;
    *)
      # 未知 mode（状态文件被手工改坏 / 版本降级）：不能当 append 处理，
      # 否则每次 refresh 都追加一条，评论瞬间刷屏。
      die "进度状态里的 mode 取值无法识别：$mode（应为 inline / append / off，删除状态文件后重新 init）"
      ;;
  esac
}

# ---------- 子命令 ----------

cmd_init() {
  local title="" steps_raw="" quiet=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --title) title="$2"; shift 2 ;;
      --steps) steps_raw="$2"; shift 2 ;;
      --steps-file) steps_raw="$(cat "$2")"; shift 2 ;;
      --quiet) quiet=1; shift ;;
      *) die "init 未知参数：$1" ;;
    esac
  done
  [ -n "$title" ] || die "init 需要 --title"
  [ -n "$steps_raw" ] || die "init 需要 --steps"

  local sf steps_json st md cid mode reused owned reuse_hist
  sf="$(state_file)"
  steps_json="$(printf '%s\n' "$steps_raw" | tr '|' '\n' \
    | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' | grep -v '^$' \
    | jq -R . | jq -sc .)"
  [ "$(printf '%s' "$steps_json" | jq 'length')" -gt 0 ] || die "步骤列表为空"

  # 本轮任务是否已经 init 过？判据是 task_id（默认 CNB_BUILD_ID）。
  #   owned=1 → 同一次任务的第二次 init：续用自己刚建的那条（PATCH），不重复新建；
  #   owned=0 → 换了任务（或是上一轮任务留下的状态）：一律**新建**，
  #             绝不改写历史评论（用户明确要求）。
  owned=""; local owned_task=""
  if [ -s "$sf" ] && [ -n "$TASK_ID" ]; then
    owned_task="$(jq -r '.task_id // ""' "$sf" 2>/dev/null)"
    [ "$owned_task" = "$TASK_ID" ] && owned=1
  fi

  st="$(jq -n \
    --arg repo "$REPO" --arg ttype "$TARGET_TYPE" --arg tnum "$TARGET_NUMBER" \
    --arg title "$title" --arg ts "$(date -u +%FT%TZ)" \
    --arg role "${CNB_NPC_NAME:-NPC}" --arg task "$TASK_ID" \
    --argjson steps "$steps_json" \
    '{repo:$repo, target_type:$ttype, target_number:$tnum, title:$title,
      role:$role, task_id:$task, steps:$steps,
      status:($steps | map("pending")), step_notes:{}, timing_version:2,
      notes:[], summary:"", phase:"running", mode:"inline", append_seq:0,
      subagents:{},
      comment_id:"", created_at:$ts, updated_at:$ts,
      started_at:$ts, finished_at:"", step_started_at:{}, step_done_at:{}}')"

  # ⚠️ 顺序是硬约束：续 init 要「认领旧评论 + 沿用旧计数」，所以这些值必须
  # **在 save_state 覆盖状态之前**读出来。旧实现把读取放在 save_state 之后，
  # 读到的全是刚写进去的默认值（append_seq=0 / last_published_phase=""）——
  # 于是续 init 会把 append 的播报计数清零、把「首次收尾」判据重置，
  # 一个任务能刷出远超封顶的评论（而平台删不掉评论，这是不可逆的）。
  cid=""; mode="inline"; reused=0
  local prev_append_seq=0 prev_append_pct=-1 prev_append_at=0
  local prev_append_digest="" prev_pub_phase="" prev_cid="" own_cid="" own_mode=""
  local prev_subagents="{}"
  if [ -n "$owned" ]; then
    # 子代理台账也要续用：同一任务里再 init（NPC 重规划步骤是常见动作）时
    # 把台账清零，清单上已经派过的子代理会**整块消失** —— 而用户明确要求
    # 「之前申请过子代理的，只要这个代理里面有的，那就显示上」。台账是**记录**，
    # 不随步骤重排而清空。
    prev_subagents="$(jq -c '.subagents // {}' "$sf")"
    prev_append_seq="$(jq -r '.append_seq // 0' "$sf")"
    prev_append_pct="$(jq -r '.last_append_percent // -1' "$sf")"
    prev_append_at="$(jq -r '.last_append_at // 0' "$sf")"
    prev_append_digest="$(jq -r '.last_append_digest // ""' "$sf")"
    prev_pub_phase="$(jq -r '.last_published_phase // ""' "$sf")"
    prev_cid="$(jq -r '.last_comment_id // ""' "$sf")"
    own_cid="$(jq -r '.comment_id // ""' "$sf")"
    own_mode="$(jq -r '.mode // "inline"' "$sf")"
  fi

  # 同任务的第二次 init：把旧状态里那条评论直接认领过来（下面的「续用」分支会 PATCH 它）；
  # 播报计数一并沿用，别把封顶的账本抹掉。换了任务就不认领 —— 旧评论属于历史，留着。
  if [ -n "$owned" ]; then
    st="$(printf '%s' "$st" | jq -c \
      --arg cid "$own_cid" --arg m "$own_mode" \
      --argjson q "$prev_append_seq" --argjson p "$prev_append_pct" --argjson t "$prev_append_at" \
      --arg d "$prev_append_digest" --arg ph "$prev_pub_phase" \
      --argjson subs "$prev_subagents" \
      '.comment_id = $cid | .mode = $m | .last_comment_id = $cid
       | .append_seq = $q | .last_append_percent = $p | .last_append_at = $t
       | .last_append_digest = $d | .last_published_phase = $ph
       | .subagents = $subs')"
  fi
  save_state "$sf" "$st"

  if [ "$FORCE_MODE" = "off" ]; then
    save_state "$sf" "$(jq -c '.mode = "off"' "$sf")"
    printf '进度上报已关闭（off 模式），状态仍记录在：%s\n' "$sf"
    return 0
  fi
  # 0) 同任务的续 init：直接续用自己那条，不新建、不碰任何历史评论。
  #    上一轮已降级成 append 的也照旧续 append —— 否则续 init 会再多建一条评论。
  if [ -n "$owned" ]; then
    # 注意：别用 prev_cid 这个名字 —— 外层已经有一个（last_comment_id），
    # 内层 local 会把它遮蔽掉，append 分支就拿到错的值了。
    local cur_mode cur_cid
    cur_mode="$own_mode"
    cur_cid="$own_cid"
    case "$cur_mode" in
      off) mode="off" ;;
      append)
        # 继续追加播报：本轮不再新建「可刷新评论」，沿用 append 的计数器
        mode="append"
        reused=1
        save_state "$sf" "$(jq -c '.mode = "append"' "$sf")"
        ;;
      inline)
        if [ -n "$cur_cid" ]; then
          cid="$cur_cid"; reused=1
          if [ -n "$TOKEN" ] && [ "$DRY_RUN" != "1" ]; then
            patch_comment "$cid" "$(render_markdown "$sf" inline)" \
              || warn "续 init 时刷新既有评论失败（后续 update 会再试）"
          fi
        fi
        ;;
    esac
  fi
  if [ "$mode" = "off" ]; then
    printf '进度上报保持关闭（off 模式）：%s\n' "$sf"
    return 0
  fi
  if [ "$mode" = "append" ]; then
    # 续 append：**不能**把播报计数清零 —— 否则续 init 会白占一条播报额度，
    # 上限封顶失效。这里把上次的计数整体带过来，仍由 append 闸门决定发不发。
    save_state "$sf" "$(jq -c \
      --argjson seq "$prev_append_seq" --argjson pct "$prev_append_pct" \
      --argjson at "$prev_append_at" --arg d "$prev_append_digest" \
      --arg lp "$prev_pub_phase" --arg lc "$prev_cid" \
      '.append_seq = $seq | .last_append_percent = $pct | .last_append_at = $at
       | .last_append_digest = $d | .last_published_phase = $lp
       | .last_comment_id = $lc' "$sf")"
    append_post "$sf" || die "创建进度评论失败"
    cid="$(jq -r '.last_comment_id // ""' "$sf")"
    [ -n "$cid" ] || die "创建进度评论失败"
    save_state "$sf" "$(jq -c --arg cid "$cid" --arg ts "$(date -u +%FT%TZ)" \
      '.comment_id = $cid | .last_comment_id = $cid | .updated_at = $ts' "$sf")"
    [ "$quiet" = "0" ] && printf '进度评论已续用本任务那条（append 模式）：%s  (id=%s)\n' \
      "$(target_url)" "$cid"
    return 0
  fi
  # 1) 只有显式 NPC_PROGRESS_REUSE=1 才去改写一条历史进度评论（非默认）。
  #    默认 0 = 一个任务一条新评论，历史评论一个都不碰。
  reuse_hist=0
  if [ -z "$cid" ] && [ -z "$FORCE_MODE" ] && [ -n "$TOKEN" ] && [ "$REUSE" = "1" ]; then
    md="$(render_markdown "$sf" inline)"
    cid="$(hunt_reuse_target "$md")"
    [ -n "$cid" ] && { reused=1; reuse_hist=1; }
  fi
  if [ -z "$cid" ] && [ -z "$FORCE_MODE" ] && [ -n "$TOKEN" ]; then
    md="$(render_markdown "$sf" inline)"
    local attempt=0 max_attempt="${NPC_PROGRESS_INIT_RETRY:-2}" rc=0
    while :; do
      cid="$(create_via_pipeline "$md")" && break
      rc=$?
      cid=""
      # 只有「瞬时拥塞（并发超限）」才重试；权限不足 / 排队超时重试也没用
      if [ "$rc" -ne 2 ]; then break; fi
      attempt=$((attempt + 1))
      if [ "$attempt" -gt "$max_attempt" ]; then break; fi
      warn "第 ${attempt} 次重试创建进度评论（等待 ${NPC_PROGRESS_RETRY_WAIT:-10}s）..."
      sleep "${NPC_PROGRESS_RETRY_WAIT:-10}"
    done
  fi
  if [ -z "$cid" ]; then
    mode="append"
    warn "改用「追加播报」模式（每次更新追加一条评论；内容相同时自动跳过）"
    append_post "$sf" || die "创建进度评论失败"
    cid="$(jq -r '.last_comment_id // ""' "$sf")"
    [ -n "$cid" ] || die "创建进度评论失败"
  fi
  save_state "$sf" "$(jq -c --arg cid "$cid" --arg m "$mode" --argjson ru "$reused" \
    --arg ts "$(date -u +%FT%TZ)" \
    '.comment_id = $cid | .mode = $m | .reused = $ru
     | .last_comment_id = $cid | .updated_at = $ts' "$sf")"

  # 评论已就位 → 起心跳（脱附、只 PATCH 这一条）。
  # 放在这里而不是更早：心跳要读到 .comment_id 才能刷新；放更早会空转。
  # off / append 模式下心跳内部会自己拒绝启动（append 刷一次就多一条评论）。
  cmd_heartbeat start >/dev/null 2>&1 || \
    warn "心跳未启动（进度仍可用，只是不会自动刷新；设 NPC_PROGRESS_HEARTBEAT=0 可静默关闭）"

  if [ "$quiet" = "0" ]; then
    if [ "$reuse_hist" = "1" ]; then
      printf '进度评论已改写历史那条（NPC_PROGRESS_REUSE=1，非默认）：%s  (id=%s, mode=%s)\n' \
        "$(target_url)" "$cid" "$mode"
    elif [ "$reused" = "1" ]; then
      printf '进度评论已续用本任务那条（未新增）：%s  (id=%s, mode=%s)\n' \
        "$(target_url)" "$cid" "$mode"
    else
      printf '进度评论已创建（新任务新建，未改动任何历史评论）：%s  (id=%s, mode=%s)\n' \
        "$(target_url)" "$cid" "$mode"
    fi
  fi
}

cmd_update() {
  local step="" status="" note="" note_given=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --step) step="$2"; shift 2 ;;
      --status) status="$2"; shift 2 ;;
      --note) note="$2"; note_given=1; shift 2 ;;
      *) die "update 未知参数：$1" ;;
    esac
  done
  [ -n "$step" ] || die "update 需要 --step"
  [ -n "$status" ] || status="done"
  validate_status "$status"

  local sf total
  sf="$(state_file)"
  load_state_or_die "$sf"
  # 归属校验：状态若是上一轮任务留下的 → 报错，绝不把新进度写进旧评论
  assert_task_owner "$sf"
  total="$(jq -r '.steps | length' "$sf")"
  # 注意三个坑（旧版全中）：
  #   1. `08` / `010` 这类前导零会被当成**八进制**：`[ 08 -gt 0 ]` 直接报
  #      "value too great for base" 并终止脚本；`010` 更隐蔽 —— 它等于 8，
  #      于是第 10 步更新静默改到了第 8 步；
  #   2. 超长数字（如 999999999999999999999）会让 `[ ]` 报 "integer expression
  #      expected" 后继续往下跑，算出的下标溢出成随机大数；
  #   3. 因此这里同时限制「无前导零」与「长度 ≤ 6」。
  case "$step" in
    ''|0*|*[!0-9]*) die "--step 必须是正整数且无前导零，收到：$step" ;;
  esac
  case "$step" in *[0-9][0-9][0-9][0-9][0-9][0-9][0-9]*) die "--step 过大：$step" ;; esac
  if [ "$step" -lt 1 ] || [ "$step" -gt "$total" ]; then
    die "--step 超出范围：$step（共 $total 步）"
  fi

  local idx
  idx=$((step - 1))
  local st
  # 每步的开始 / 结束时间：渲染靠它算「已 12m30s」「用时 3m04s」。
  # 光有 1/4、2/4 这类计数，用户看不出是哪一步卡住了 —— 时间才是「详细」的关键。
  #
  # ⚠️ 开始时间**只在把步骤标成 running 时**写入（timing_version=2，见下面 jq）。
  # 旧版在**任何** update 里都补 started_at（`// $ts`），于是「直接标 done」的步骤
  # 拿到 started == done，渲染成「用时 0s」—— 看着像秒级完成，其实是没打点，
  # 用户已经在 Issue #12 就此提过问。缺打点要如实暴露，不能编个 0s 糊过去。
  # 仍在 running 时用 `// $ts` 保留首次开始时间：running → done 不重置，耗时连续。
  st="$(jq -c --argjson i "$idx" --arg s "$status" \
    --argjson note_given "$note_given" --arg n "$note" \
    --arg ts "$(date -u +%FT%TZ)" '
      .status[$i] = $s
      # 从旧版状态升级时，先清掉旧版在标 done 时补的**假开始时间**（started == done）。
      # 不清的话它们会被 v2 当成「真打过点」，渲染成 <1s —— 换个数字继续误导。
      | (.step_done_at // {}) as $dn
      | if ((.timing_version // 0) | if type == "number" then . else 0 end) < 2 then
          .step_started_at = ((.step_started_at // {})
            | to_entries | map(select(.value != ($dn[.key] // ""))) | from_entries)
        else . end
      | .timing_version = 2
      # 备注的存续：给了新备注就覆盖；没给就**保留原有备注**。
      # 旧版在标 done / skipped 时把备注清空（else ""），于是「running 时写的
      # --note 是这一步唯一的说明」这种最常见用法，一旦收尾就从评论上消失 ——
      # 而收尾那条正是用户最后通读的那条。备注是给人看的过程说明，不是运行态字段，
      # 不该随状态迁移被抹掉；要改就显式再传一次 --note。
      | .step_notes[($i | tostring)] = (.step_notes[($i | tostring)] // "")
      | (if $note_given == 1 then .step_notes[($i | tostring)] = $n else . end)
      | if $s == "running" then
          .step_started_at = ((.step_started_at // {}) | .[($i | tostring)] = (.[($i | tostring)] // $ts))
          | .step_done_at = ((.step_done_at // {}) | del(.[($i | tostring)]))
        elif $s == "done" or $s == "skipped" or $s == "failed" then
          # 结束时间照记；开始时间**不补** —— 没打过点就让渲染如实说「未单独计时」
          .step_done_at = ((.step_done_at // {}) | .[($i | tostring)] = $ts)
        elif $s == "pending" then
          # 退回排队：这一步不再「进行中」，计时整体清零。留着的话渲染成
          # 「⬜ A —— 用时 2s」，读起来像「已完成、花了 2s」，与状态自相矛盾。
          # 之后重新标 running 会重新起算 —— 重新排队本来就该重算。
          .step_started_at = ((.step_started_at // {}) | del(.[($i | tostring)]))
          | .step_done_at = ((.step_done_at // {}) | del(.[($i | tostring)]))
        else . end
      | .updated_at = $ts
      | if $s == "failed" then .phase = "failed"
        elif .phase == "failed" and $s != "failed" then .phase = "running"
        else . end
    ' "$sf")"
  save_state "$sf" "$st"
  refresh "$sf" || die "更新进度失败"
  printf '进度已更新：step %s → %s\n' "$step" "$status"
  # 打点纪律提示：直接标 done（从未标过 running）的步骤没有真实耗时，
  # 渲染成「未单独计时」。在调用方就能看到的地方点一句，比事后翻评论更快纠正。
  if [ "$status" = "done" ] || [ "$status" = "failed" ]; then
    if ! jq -e --argjson i "$idx" \
        '(.step_started_at // {})[($i | tostring)] != null' "$sf" >/dev/null 2>&1; then
      warn "第 $step 步从未标过 running，本轮没有真实耗时（渲染为「未单独计时」）。" \
           "想让耗时可信，请**先** \`update --step $step --status running\`，做完再标 done。"
    fi
  fi
}

close_live_subagents() {
  # 收尾（done / fail）时把清单里仍在跑的子代理标成 unfinished。
  #
  # 为什么不直接不管：进度评论收尾后不会再刷新，那几行会**永久停在「运行中」**——
  # 用户读最后那条评论时看到「还有子代理在跑」，实际整轮已经结束了（自相矛盾）。
  # 也不标 done：它们确实没被等到，谎报「已完成」比留白更糟。
  local sf="$1" st="${2:-}"
  [ -n "$st" ] || st="$(cat "$sf")"
  local n
  n="$(printf '%s' "$st" | jq '[ (.subagents // {}) | to_entries[]
        | select(.value.status == "running" or .value.status == "pending") ] | length' 2>/dev/null || echo 0)"
  case "$n" in ''|*[!0-9]*) n=0 ;; esac
  [ "$n" -gt 0 ] || { printf '%s' "$st"; return 0; }
  printf '%s' "$st" | jq -c --arg ts "$(date -u +%FT%TZ)" '
    .subagents = ((.subagents // {}) | with_entries(
      if (.value.status == "running" or .value.status == "pending")
      then .value.status = "unfinished" | .value.finished_at = (.value.finished_at // $ts)
      else . end))'
}

cmd_subagent() {
  # 子代理台账：**按 sn 原地更新同一行**。
  #
  # 为什么是这个形状（用户直接提的需求）：
  #   「一个子代理就直接显示一个，然后后面加上它的状态，不需要这样重复地搞」
  #   —— 现在有多少个子代理、名字是什么、时间 / 上限 / 状态，各占一行；
  #   「之前申请过子代理的，只要是这个代理里面有的，那就显示上，只不过状态要显示已完成」
  #   —— 所以收口不删行，改状态、保留在清单里；
  #   「最好把它的任务也给概括地写上」—— 记 task 摘要一起渲染。
  #
  # 调用方是 subagent.sh（派发 / 每次心跳 / 收口各写一次），
  # 所以本子命令必须**幂等**：同一个 sn 反复写只更新那一行，不追加。
  local sn="" status="" name="" task="" cpus="" thinking="" limit="" started="" quiet=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --sn) sn="$2"; shift 2 ;;
      --status) status="$2"; shift 2 ;;
      --name) name="$2"; shift 2 ;;
      --task) task="$2"; shift 2 ;;
      --cpus) cpus="$2"; shift 2 ;;
      --thinking) thinking="$2"; shift 2 ;;
      --limit) limit="$2"; shift 2 ;;
      --started) started="$2"; shift 2 ;;
      --quiet) quiet=1; shift ;;
      *) die "subagent 未知参数：$1" ;;
    esac
  done
  [ -n "$sn" ] || die "subagent 需要 --sn"
  [ -n "$status" ] || status="running"
  validate_sub_status "$status"
  case "$limit" in
    ''|*[!0-9]*) limit="" ;;
  esac

  local sf
  sf="$(state_file)"
  load_state_or_die "$sf"
  # 归属校验：状态若是上一轮任务留下的 → 报错，绝不把新进度写进旧评论
  assert_task_owner "$sf"

  # ---- 限流与「首次必写」 ----
  #
  # 调用方（subagent.sh）在派发、每次心跳、收口各写一次。心跳每 60s 一轮，
  # 没必要每轮都打一次 API —— 但两种情形**必须放行**：
  #   1. 终态（收口那一笔）：被吞掉的话清单里就永远停在「运行中」；
  #   2. **台账里还没有这个 sn**（首次写入）：name / task / cpus / thinking
  #      只在派发那一次传得进来，心跳不知道这些（它只有 sn 与状态）。
  #      首次被限流吞掉的话，那一行会永远缺名字与任务摘要 —— 实测踩到过：
  #      派发后立刻进入等待，心跳比首次写早落地，清单上是「✅ 用时 <1s · 已完成」，
  #      既没名字也没任务。
  # 判定「首次」得看状态文件 —— 只有进度脚本自己看得见，所以限流放在这里。
  local is_new=0
  if [ "$(jq -r --arg sn "$sn" '.subagents[$sn] // "none" | if . == "none" then "new" else "old" end' "$sf")" = "new" ]; then
    is_new=1
  fi
  local final=0
  sub_status_final "$status" && final=1
  local mark="${NPC_PROGRESS_SUBAGENT_MARK:-${STATE_DIR}/subagent-throttle-${TASK_ID:-noid}-${sn}}"
  local now
  now="$(date +%s)"
  if [ "$is_new" = "0" ] && [ "$final" = "0" ]; then
    local last=0
    [ -s "$mark" ] && last="$(cat "$mark" 2>/dev/null || echo 0)"
    case "$last" in ''|*[!0-9]*) last=0 ;; esac
    if [ "$(( now - last ))" -lt "${NPC_PROGRESS_SUBAGENT_INTERVAL:-60}" ]; then
      return 0   # 限流：同一行 60s 内只刷一次（状态没变，评论上也看不出差别）
    fi
  fi
  # ⚠️ 节流标记要**无条件**更新，包括这次是被放行的「首次 / 终态」。
  # 旧写法把写标记塞在限流的 if 里，于是首次写入根本不落标记 —— 下一次中间态
  # 刷新看到「没有标记」，就白放行一次。实测：间隔设 9999s，连着写两次仍然都落地。
  printf '%s' "$now" > "$mark" 2>/dev/null || true

  local ts
  ts="$(date -u +%FT%TZ)"
  [ -n "$started" ] || started="$ts"

  # upsert：已存在就只更新传入的字段（**保留 started_at** —— 那是「已耗时」的起点，
  # 每次心跳都重置的话耗时永远显示 0，等于把用户最想看的那个数弄丢了）。
  local st
  st="$(jq -c --arg sn "$sn" --arg s "$status" --arg n "$name" --arg t "$task" \
    --arg c "$cpus" --arg th "$thinking" --argjson limit "${limit:-0}" \
    --arg ts "$ts" --arg started "$started" --argjson final "$final" '
      .subagents = (.subagents // {})
      | .subagents[$sn] = ((.subagents[$sn] // {}) + {
          status: $s,
          name: (if $n != "" then $n else (.subagents[$sn].name // "") end),
          task: (if $t != "" then $t else (.subagents[$sn].task // "") end),
          cpus: (if $c != "" then $c else (.subagents[$sn].cpus // "") end),
          thinking: (if $th != "" then $th else (.subagents[$sn].thinking // "") end),
          limit: (if $limit > 0 then $limit else (.subagents[$sn].limit // 0) end),
          started_at: (.subagents[$sn].started_at // $started),
          updated_at: $ts
        })
      | if $final == 1 then .subagents[$sn].finished_at = $ts else . end
      | .updated_at = $ts' "$sf")"
  save_state "$sf" "$st"
  refresh "$sf" || die "子代理台账刷新失败"
  [ "$quiet" = "1" ] || printf '子代理台账已更新：%s → %s\n' "$sn" "$status"
}

cmd_note() {
  local text="${1:-}"
  [ -n "$text" ] || die "note 需要文本"
  local sf st
  sf="$(state_file)"
  load_state_or_die "$sf"
  # 归属校验：状态若是上一轮任务留下的 → 报错，绝不把新进度写进旧评论
  assert_task_owner "$sf"
  st="$(jq -c --arg t "$text" --arg ts "$(date -u +%FT%TZ)" \
    '.notes += [$t] | .updated_at = $ts' "$sf")"
  save_state "$sf" "$st"
  refresh "$sf" || die "追加说明失败"
  printf '说明已写入进度评论\n'
}

cmd_done() {
  local summary=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --summary) summary="$2"; shift 2 ;;
      *) die "done 未知参数：$1" ;;
    esac
  done
  local sf st
  sf="$(state_file)"
  load_state_or_die "$sf"
  # 归属校验：状态若是上一轮任务留下的 → 报错，绝不把新进度写进旧评论
  assert_task_owner "$sf"
  st="$(jq -c --arg s "$summary" --arg ts "$(date -u +%FT%TZ)" '
      .status = [.status[] | if . == "pending" or . == "running" then "done" else . end]
      # 这里**不**清 step_notes：那是每步的过程说明，收尾后评论还在被人看，
      # 抹掉等于把用户唯一能读到的细节删了（旧版每步备注到收尾就全没了）。
      | .phase = "done" | .summary = $s | .updated_at = $ts
      | .finished_at = $ts
      # 剩余步骤被一并收尾：凡是有过开始时间的，都用收尾时刻补齐结束时间，
      # 否则「全部完成」时最后几步的耗时会整列空着。
      | .step_done_at = ((.step_done_at // {}) + (
          (((.step_started_at // {}) | keys) - ((.step_done_at // {}) | keys))
          | map({key: ., value: $ts}) | from_entries))' "$sf")"
  st="$(close_live_subagents "$sf" "$st")"
  save_state "$sf" "$st"
  refresh "$sf" || die "收尾刷新失败"
  # 收尾即停心跳：状态已是 phase=done，心跳自己下一轮也会退出；
  # 这里主动停掉，是为了不留下一个要等一个间隔才退出的空转进程。
  cmd_heartbeat stop >/dev/null 2>&1 || true
  refresh_after_finish "$sf"
  printf '进度已收尾：%s\n' "$(target_url)"
}

cmd_fail() {
  local reason=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --reason) reason="$2"; shift 2 ;;
      *) die "fail 未知参数：$1" ;;
    esac
  done
  local sf st
  sf="$(state_file)"
  load_state_or_die "$sf"
  # 归属校验：状态若是上一轮任务留下的 → 报错，绝不把新进度写进旧评论
  assert_task_owner "$sf"
  st="$(jq -c --arg r "$reason" --arg ts "$(date -u +%FT%TZ)" '
      .phase = "failed" | .summary = "" | .notes += [$r] | .updated_at = $ts
      | .finished_at = (.finished_at // $ts)' "$sf")"
  st="$(close_live_subagents "$sf" "$st")"
  save_state "$sf" "$st"
  # 不能 `|| true`：收尾播报是「结论必须让用户看到」的那一条，
  # 发送失败必须反映到退出码上，调用方才知道要重试。
  refresh "$sf" || die "失败收尾播报未发出（状态已标记 failed，可重跑 fail 重试）"
  cmd_heartbeat stop >/dev/null 2>&1 || true
  refresh_after_finish "$sf"
  printf '进度已标记失败\n'
}

cmd_list() {
  # 只读：列出目标 Issue / PR 上所有进度评论（含 NPC 改不了的那种），
  # 供维护者一眼看清要清理哪些。**不做任何写操作**。
  need curl; need jq
  local page resp rows cnt all_rows
  all_rows=""
  # 注意：不能复用 hunt_reuse_target 里的局部变量名（它是另一个函数的局部量），
  # 这里必须自己声明，否则 set -u 下直接 unbound。
  local list_size list_max
  list_size=100
  list_max=$(( (REUSE_SCAN + list_size - 1) / list_size ))
  [ "$list_max" -ge 1 ] || list_max=1
  for page in $(seq 1 "$list_max"); do
    resp="$(curl -sS --max-time 60 \
      "$(comment_base)?sort=-created&page=${page}&page_size=${list_size}" \
      -H "Authorization: Bearer ${TOKEN}" \
      -H "Accept: application/vnd.cnb.api+json" 2>/dev/null)" || break
    cnt="$(printf '%s' "$resp" | jq 'if type == "array" then length else 0 end' 2>/dev/null || echo 0)"
    rows="$(printf '%s' "$resp" | jq -r '
      (if type == "array" then . else [] end)[]
      # 前缀匹配：标记现为 `<!-- npc-progress:auto role=... phase=... -->`。
      # 旧写法要求 `auto` 后面紧跟 ` -->`，于是**当前版本自己发的评论一条都列不出来**
      # （维护者据此清理残留，等于瞎着眼清理）。
      | select((.body // "") | contains("<!-- npc-progress:auto"))
      | "  \(.created_at)  \(.author.username)  id=\(.id)  " +
        (if ((.author.username // "") | test("CodeBuddy|npc"; "i")) then "（NPC 身份，改不掉）" else "（可复用/可改写）" end)
      ' 2>/dev/null)"
    [ -n "$rows" ] && all_rows="${all_rows}${rows}"$'\n'
    [ "${cnt:-0}" -gt 0 ] || break
  done
  local uniq
  uniq="$(printf '%s' "$all_rows" | awk 'NF && !seen[$0]++')"
  [ -n "$uniq" ] && printf '%s\n' "$uniq"
  printf '\n共 %s 条进度评论 · 目标：%s\n' "$(printf '%s' "$uniq" | grep -c . || true)" "$(target_url)"
  printf '说明：平台未开放删除评论的 OpenAPI，NPC 也改不了 NPC 身份的评论；\n'
  printf '      每个任务的 OCI 评论都是那一轮的过程记录，默认不再被改写（互相不覆盖）；\n'
  printf '      NPC 身份的残留需维护者在网页端手动删除（负责人 / 管理员可删）。\n'
}

# 心跳：脱附后台进程，定时原地刷新同一条评论（PATCH，绝不新增评论）。
#
# 解决什么：NPC 一旦进到长步骤（读大文件、等子代理、等 CI），就不会再调 update，
# 评论整段静止 —— 用户无法区分「还在干活」和「已经断了」，只能来问
# 「这个评论的进度都没有动过呀」（Issue #12）。心跳让「最后更新 / 已耗时」
# 自己往前走：**时间戳在动 = 活着，不动 = 真卡住**。
#
# 为什么必须脱附（setsid + nohup + 重定向 + </dev/null）：父 shell 退出时若还挂着
# 子进程，平台会认为阶段没结束，把整条流水线拖住。实测（本仓子代理探针）：
# setsid 脱附后阶段照常 9s 结束，后台进程继续活着。
#
# 安全边界（每条都对应一个真实故障）：
#   1. **心跳绝不写状态文件**：只读状态、只 PATCH 评论。主代理随时在 save_state，
#      心跳若也写，两边会互相覆盖 —— 状态一乱，进度评论就跟着乱。
#   2. **只在 inline 模式、phase=running 时刷**：append 模式刷一次就多一条评论
#      （平台删不掉）；收尾后立刻退出。
#   3. **PATCH 失败静默跳过**：心跳不该因一次网络抖动把模式降级成 append
#      （降级是单向的，那会污染评论计数）。refresh 里那套降级逻辑只归主代理用。
#   4. **最长存活 HB_MAX_SECONDS 兜底**：万一收尾没跑到（流水线被杀），
#      心跳也不会永远刷下去 —— 到点自己退出。
#   5. **PID 记在旁路文件**（<state>.hb.pid，不塞进状态文件）：收尾时据此干净停掉。
#      PID 由子进程自己写（`$$`），比父 shell 的 `$!` 可靠 —— 中间还隔着 setsid/nohup/env。
cmd_heartbeat() {
  local action="start"
  while [ $# -gt 0 ]; do
    case "$1" in
      start|stop|restart) action="$1"; shift ;;
      --foreground) action="foreground"; shift ;;
      *) die "heartbeat 未知参数：$1" ;;
    esac
  done

  local sf hbpid_file
  sf="$(state_file)"
  hbpid_file="$(state_file).hb.pid"

  case "$action" in
    stop)
      stop_heartbeat "$hbpid_file"
      # 收尾后页脚不该再说「会自动刷新」—— 清掉标记，文案回到普通描述
      [ -s "$sf" ] && save_state "$sf" "$(jq -c '.hb_interval = 0' "$sf")" 2>/dev/null || true
      printf '心跳已停止\n'
      return 0
      ;;
    foreground)
      heartbeat_loop "$sf"      # 前台跑（自测用，不脱附）
      return $?
      ;;
  esac

  # start / restart：先停旧的（幂等 —— 重复调用不会跑出两个心跳）
  stop_heartbeat "$hbpid_file"
  [ -s "$sf" ] || die "找不到进度状态（先执行 init）：$sf"
  # DRY_RUN 是「零写请求」的强承诺：心跳会 PATCH，必须一并关掉，
  # 否则自测就不再是零残留（失败时还会在 mock/Issue 上留下痕迹）。
  if [ "$DRY_RUN" = "1" ]; then
    printf 'DRY_RUN=1：不启动心跳（零写请求）\n'
    return 0
  fi
  case "$HB_INTERVAL" in ''|*[!0-9]*) HB_INTERVAL=60 ;; esac
  if [ "$HB_INTERVAL" -le 0 ]; then
    printf '心跳已关闭（NPC_PROGRESS_HEARTBEAT=%s）\n' "$HB_INTERVAL"
    return 0
  fi
  case "$(jq -r '.mode // "inline"' "$sf")" in
    inline) ;;
    *) printf '非 inline 模式（%s），不启动心跳\n' "$(jq -r '.mode' "$sf")"; return 0 ;;
  esac

  # 把心跳间隔记进状态：渲染用它决定页脚文案（「每 60s 自动原地刷新（心跳）」）。
  # 这行由**主代理进程**执行（与 update 同一时序），不涉及与心跳进程的竞争。
  save_state "$sf" "$(jq -c --argjson i "$HB_INTERVAL" '.hb_interval = $i' "$sf")"

  local hbdir
  hbdir="$(dirname "$sf")"
  # 子进程自己写 PID（父 shell 的 $! 隔着 setsid/nohup/env 不可靠）
  # ⚠️ 必须把状态文件路径**显式**传给子进程（两个变量都要）：
  # 子进程会重新执行 state_file()，而它只认 STATE_OVERRIDE —— 只传
  # NPC_PROGRESS_HB_STATE 的话，`--state <其他路径>` 的调用会**重算成默认路径**，
  # 于是心跳 PATCH 的是另一个状态文件里的 comment_id：
  #   * 轻则「写错评论」——去改同 Issue 下另一个角色/任务的进度评论（正是
  #     「不许篡改历史评论」这条硬约束最怕的事，而且它发生在后台、主流程看不见）；
  #   * 重则默认路径无文件 → 心跳直接静默退出，评论永不刷新，用户又回到
  #     「分不清是活着还是卡住」。
  # 实测（mock）：只传 HB_STATE 时会打出 `PATCH comments/OTHER-CID`。
  setsid nohup env \
      NPC_PROGRESS_DIR="$STATE_DIR" \
      NPC_PROGRESS_TASK_ID="${TASK_ID:-}" \
      NPC_PROGRESS_HB_STATE="$sf" \
      NPC_PROGRESS_STATE="$sf" \
      NPC_PROGRESS_HEARTBEAT="$HB_INTERVAL" \
      NPC_PROGRESS_HEARTBEAT_MAX_RUNS="$HB_MAX_RUNS" \
      NPC_PROGRESS_HEARTBEAT_MAX="$HB_MAX_SECONDS" \
      NPC_PROGRESS_HB_PIDFILE="$hbpid_file" \
      NPC_PROGRESS_HB_SCRIPT="$0" \
      bash -c 'echo $$ > "$NPC_PROGRESS_HB_PIDFILE"; exec bash "$NPC_PROGRESS_HB_SCRIPT" heartbeat --foreground' \
      >>"$hbdir/heartbeat.log" 2>&1 </dev/null &
  disown 2>/dev/null || true

  # 等它把 PID 写出来（最多 3s），写不出也不阻塞主流程
  local i=0
  while [ "$i" -lt 30 ] && [ ! -s "$hbpid_file" ]; do sleep 0.1; i=$((i + 1)); done
  if [ -s "$hbpid_file" ]; then
    printf '心跳已启动：每 %ss 原地刷新一次（pid=%s）\n' "$HB_INTERVAL" "$(cat "$hbpid_file")"
  else
    warn "心跳进程未回报 PID（日志：$hbdir/heartbeat.log），进度仍可用，只是不会自动刷新"
  fi
}

stop_heartbeat() {
  # stop_heartbeat <pidfile>：停掉心跳进程并删除 PID 文件（幂等）
  local hbpid_file="$1" pid
  [ -n "$hbpid_file" ] || return 0
  pid="$(cat "$hbpid_file" 2>/dev/null || echo 0)"
  rm -f "$hbpid_file"
  case "$pid" in ''|*[!0-9]*) return 0 ;; esac
  [ "$pid" -gt 1 ] 2>/dev/null || return 0
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
  fi
  return 0
}

heartbeat_loop() {
  # 心跳主循环（脱附进程里跑）。每轮都**重读状态文件**：
  # 只要它说「已收尾」或「不是 inline」，就退出 —— 这是收尾能立刻生效的关键。
  # ⚠️ 本函数只读状态文件，绝不写（写会与主代理的 save_state 互相覆盖）。
  local sf="$1"
  [ -n "$sf" ] || sf="${NPC_PROGRESS_HB_STATE:-}"
  [ -n "$sf" ] && [ -s "$sf" ] || return 0
  local interval="${NPC_PROGRESS_HEARTBEAT:-60}"
  local max_runs="${NPC_PROGRESS_HEARTBEAT_MAX_RUNS:-0}"
  local max_secs="${NPC_PROGRESS_HEARTBEAT_MAX:-7200}"
  local started now runs=0 phase mode

  case "$interval" in ''|*[!0-9]*) interval=60 ;; esac
  [ "$interval" -gt 0 ] || return 0
  case "$max_runs" in ''|*[!0-9]*) max_runs=0 ;; esac
  case "$max_secs" in ''|*[!0-9]*) max_secs=7200 ;; esac
  started="$(date +%s)"

  sleep "$interval"      # 刚 init 过，先让出一拍，别白刷
  while :; do
    now="$(date +%s)"
    if [ "$max_secs" -gt 0 ] && [ "$(( now - started ))" -ge "$max_secs" ]; then
      return 0   # 兜底：到最长存活，自己退出（防止收尾没跑到就永远刷）
    fi
    [ -s "$sf" ] || return 0
    phase="$(jq -r '.phase // "running"' "$sf" 2>/dev/null)"
    [ "$phase" = "running" ] || return 0
    mode="$(jq -r '.mode // "inline"' "$sf" 2>/dev/null)"
    [ "$mode" = "inline" ] || return 0

    heartbeat_refresh "$sf" || true

    runs=$(( runs + 1 ))
    if [ "$max_runs" -gt 0 ] && [ "$runs" -ge "$max_runs" ]; then
      return 0
    fi
    sleep "$interval"
  done
}

heartbeat_refresh() {
  # 心跳的刷新动作：PATCH 同一条评论（render 时会按「现在」重算已耗时/最后更新）。
  # 失败**静默跳过**：不降级、不写状态、不打扰主流程。
  local sf="$1" cid md phase
  cid="$(jq -r '.comment_id // ""' "$sf" 2>/dev/null)"
  [ -n "$cid" ] || return 0
  # ⚠️ 渲染**之前**再确认一次任务还在跑。
  #
  # 心跳与 done 是两条独立连接，各写一次 PATCH。真机复现（本仓 2026-10-01，
  # 心跳侧人为延迟 ≥0.1s 时 3/3 命中）：done 先落地、心跳的旧快照
  # （phase=running、无结论）后落地 —— 结果状态文件是 done、评论正文却永久停在
  # 「🔄 正在跑」，**没有任何自愈机会**（心跳下一轮读到 phase≠running 就退出了，
  # 而 done 已经跑完不会再发）。
  #
  # 这里收窄窗口：读到不是 running 就放弃本次刷新。仍有极小的 TOCTOU 剩余窗口，
  # 所以收尾侧还要补一发（见 refresh_after_finish）——
  # 「窗口收窄」挡绝大多数，「补发」兜住残余，后者不依赖时序假设。
  phase="$(jq -r '.phase // "running"' "$sf" 2>/dev/null)"
  [ "$phase" = "running" ] || return 0
  md="$(render_markdown "$sf" inline 2>/dev/null)" || return 0
  [ -n "$md" ] || return 0
  # 渲染耗时也是窗口的一部分（本地 ~44ms，真机 RTT 更大），渲染完再看一眼。
  phase="$(jq -r '.phase // "running"' "$sf" 2>/dev/null)"
  [ "$phase" = "running" ] || return 0
  patch_comment "$cid" "$md" >/dev/null 2>&1 || return 0
  return 0
}

# 收尾后补发一次渲染结果，确保「结论」在时间上是最后一个写入。
#
# 为什么必须补：停心跳只 kill 进程，**撤不掉已经在途的 PATCH**。实测（同上）
# 覆盖发生在 stop 之后，所以「先 stop 再刷新」并不能防住旧快照后写。
# 补发的这一次是收尾自己的写，它之后不再有心跳写 —— 除非有在途包恰好排在后面，
# 而窗口已被 heartbeat_refresh 的两次 phase 复查收到最小。
#
# 失败**不致命**：收尾的 refresh 已经发过一次，这里只是「补一发保险」，
# 没必要因为一次瞬时失败把 done 的退出码改红。
refresh_after_finish() {
  local sf="$1" mode cid md
  mode="$(jq -r '.mode // "inline"' "$sf" 2>/dev/null)"
  [ "$mode" = "inline" ] || return 0
  cid="$(jq -r '.comment_id // ""' "$sf" 2>/dev/null)"
  [ -n "$cid" ] || return 0
  md="$(render_markdown "$sf" inline 2>/dev/null)" || return 0
  [ -n "$md" ] || return 0
  patch_comment "$cid" "$md" >/dev/null 2>&1 || true
  return 0
}

cmd_preview() {
  # 只读：把当前状态渲染成 Markdown 打到 stdout，**不发任何写请求**。
  # 用途一：自测（验证渲染改动不用碰真实 Issue —— 平台删不掉评论）；
  # 用途二：NPC / 维护者想看看「这条进度评论会长什么样」时直接打印。
  local sf mode="inline"
  while [ $# -gt 0 ]; do
    case "$1" in
      --mode) mode="$2"; shift 2 ;;
      *) die "preview 未知参数：$1" ;;
    esac
  done
  sf="$(state_file)"
  load_state_or_die "$sf"
  render_markdown "$sf" "$mode"
}

cmd_show() {
  local sf
  sf="$(state_file)"
  [ -s "$sf" ] || { printf '（无进度状态）\n'; return 0; }
  jq . "$sf"
}

# ---------- 入口 ----------

ARGS=()
REPO_OVERRIDE=""; ISSUE_OVERRIDE=""; PR_OVERRIDE=""; STATE_OVERRIDE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO_OVERRIDE="$2"; shift 2 ;;
    --issue) ISSUE_OVERRIDE="$2"; shift 2 ;;
    --pr) PR_OVERRIDE="$2"; shift 2 ;;
    --state) STATE_OVERRIDE="$2"; shift 2 ;;
    --timeout) INIT_TIMEOUT="$2"; shift 2 ;;
    -h|--help) usage 0 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done

[ "${#ARGS[@]}" -gt 0 ] || usage 0
CMD="${ARGS[0]}"
REST=()
[ "${#ARGS[@]}" -gt 1 ] && REST=("${ARGS[@]:1}")

resolve_target "$REPO_OVERRIDE" "$ISSUE_OVERRIDE" "$PR_OVERRIDE"

case "$CMD" in
  init)   cmd_init ${REST[@]+"${REST[@]}"} ;;
  update) cmd_update ${REST[@]+"${REST[@]}"} ;;
  note)   cmd_note ${REST[@]+"${REST[@]}"} ;;
  subagent) cmd_subagent ${REST[@]+"${REST[@]}"} ;;
  done)   cmd_done ${REST[@]+"${REST[@]}"} ;;
  fail)   cmd_fail ${REST[@]+"${REST[@]}"} ;;
  show)   cmd_show ;;
  preview) cmd_preview ${REST[@]+"${REST[@]}"} ;;
  heartbeat) cmd_heartbeat ${REST[@]+"${REST[@]}"} ;;
  list)   cmd_list ;;
  link)
    # 直接给出「那一条进度评论」的定位链接（带 #comment-<id>），
    # 而不是只给 Issue 首页 —— Issue 评论一多，找进度评论本身就很费劲。
    _sf="$(state_file)"
    _cid="$(jq -r '.comment_id // ""' "$_sf" 2>/dev/null)"
    if [ -n "$_cid" ] && [ "$_cid" != "null" ]; then
      printf '%s#comment-%s\n' "$(target_url)" "$_cid"
    else
      printf '%s\n' "$(target_url)"
    fi
    ;;
  *) die "未知子命令：$CMD（可用：init / update / note / subagent / done / fail / preview / show / list / link / heartbeat）" ;;
esac
