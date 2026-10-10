#!/usr/bin/env bash
# 子代理（Subagent）调度脚本
#
# 作用：把「独立、可并行、上下文需要隔离」的子任务派发给一条**子流水线**，
# 由子流水线里的 npc:go 以独立会话执行，父代理再把子代理的文本结论收回来。
#
# 为什么用子流水线：主代理跑在 npc:go 的容器里，容器内没有第二个 Agent 进程；
# 而 api_trigger + npc:go 能在**当前仓库**再起一条受控流水线，天然拿到
# 独立上下文窗口、独立运行环境、独立超时和独立计费口径——这就是「子代理」。
#
# 子流水线定义以内联 config 随请求下发，不依赖目标仓库的 .cnb.yml，
# 因此在任何仓库被召唤时都能用（只要本脚本可获取，见 SKILL.md 的兜底拉取）。
#
# 用法：
#   subagent.sh run   --task "任务描述" [--system "系统提示"] [--name 子代理名]
#                     [--model MODEL] [--thinking 档位|auto] [--cpus N|auto]
#                     [--escalate N] [--write]
#                     [--timeout 秒] [--out 文件] [--max-chars N] [--async]
#                     [--retry N] [--congestion-wait 秒]
#   subagent.sh map   --file 任务清单.txt [--concurrency N] [--thinking 档位|auto]
#                     [--cpus N|auto]
#                     [--timeout 秒] [--out-dir 目录] [--max-chars N] [--name-prefix 前缀]
#                     [--retry N] [--congestion-wait 秒]
#   subagent.sh wait  --sn <构建号> [--timeout 秒] [--out 文件] [--max-chars N]
#   subagent.sh status --sn <构建号>
#   subagent.sh stop  --sn <构建号>   —— 回收：停掉仍在跑的子代理（不再占额度与核时）
#   subagent.sh spec    —— 打印**当前容器**的规格与含义（供决策：这活本地干还是外派）
#
# 思考档自主决策（--thinking auto）：与 --cpus auto 同源 —— 档位给错了两头都亏
#   （琐碎活给 max 是白烧 token，疑难活给 off 是反复跑错），所以按任务文本的认知
#   难度信号定档，取最高档，依据打在 stderr 可核对。
#
# 并发上限（实测，根组织级）：
#   平台对**根组织**限制「同时运行的构建数 / 流水线数」各 64 条。
#   超出时**不排队**：构建照常创建并短暂显示 pending，随后被判 error，报
#     The number of concurrent builds has exceeded the limit set for the root organization: 64.
#     并发构建数量超出根组织限制：64
#   同一时刻的 NPC 主代理、PR 构建等也都占这 64 条额度，所以要留余量。
#   本脚本的对策：
#     * run（同步）默认做「准入确认」：命中并发超限会自动等位补投，不把失败甩给父代理；
#     * map 用于批量外派：自带并发闸门（--concurrency）+ 超限自动补投 + 结果汇总；
#     * wait 遇到并发超限会给出可读原因，并以退出码 2 标记「可重试」，不与真失败混淆。
#
# 参数说明：
#   --cpus 子流水线规格。写数字（1~64）＝人工指定；写 `auto` ＝**让脚本按任务自己判**
#          （扫任务文本里的资源信号定起始档，推理过程打在 stderr，可核对）。
#          平台不支持运行时改规格，所以「按需分配」只能靠「先估一档，不够再加」——
#          后者就是 --escalate，见下。
#   --escalate N
#          资源不足时**自主升档重投**的次数（默认：--cpus auto 为 2，显式核数为 0）。
#          「资源不足」按证据判：Stage 日志出现 OOM Kill / exit 137 / MemoryError 等，
#          或等待超时（核少 → 跑得慢）。并发超限不升档（与规格无关，升了也没用）。
#          升档阶梯 ×2（2→4→8→16）。这块核时比省下的贵，所以宁可信其有。
#   --cpus 子流水线规格（核数，默认 2）。核时 = cpus × 时长，是**按声明规格**扣的，
#          与容器实际占用无关 —— 所以「读文件、理代码」这类轻任务按 1~2 核派，
#          真要吃 CPU 的（跑构建 / 压测 / 大批量转码）才加：--cpus 8 / 16。
#          变量替换发生在 Schema 校验之前，`cpus: $SUBAGENT_CPUS` 替成数字后仍是合法 Number；
#          但替成**空**会退化成 `cpus:`（null）并静默回落默认 8 核，所以内联 config 里
#          留了 `SUBAGENT_CPUS: "2"` 兜底，请求侧再用同名 env 覆盖它（实测覆盖生效）。
#   --timeout 等待上限（秒，默认 1800）。超时后父代理放弃等待：若要**升档重投**，
#          脚本会先回收（stop-build）掉旧子代理，避免「同一任务两条并存」白占额度；
#          次数用尽不再重投时**保留**旧构建，方便用 status --sn 继续查（旧语义不变）。
#   --max-chars 只截断「回显给父代理」的文本（默认 12000 字符，按字符切、不破坏 UTF-8）；
#               实现上走 python3 按字符切：容器内 LANG/LC_ALL 常为空，bash 的 ${var:0:N}
#               会退化成按字节切，中文/emoji 会被切成半个字符。
#               需要全文时用 --out 落盘。子流水线侧另有 SUBAGENT_MAX_BYTES（默认 200000）
#               字节安全阀，只防日志爆量。
#   防递归：子代理自身也会加载本 skill。脚本按 SUBAGENT_DEPTH 计数，
#           超过 SUBAGENT_MAX_DEPTH（默认 2）直接拒绝派发，避免套娃失控。
#
# 依赖：curl、jq、python3、cnb CLI（随 cnbcool/default-npc 镜像提供）
set -u -o pipefail

API="${CNB_API_ENDPOINT:-https://api.cnb.cool}"
WEB="${CNB_WEB_ENDPOINT:-https://cnb.cool}"
REPO="${CNB_REPO_SLUG:-}"
BRANCH="${CNB_BRANCH:-main}"
TOKEN="${CNB_TOKEN:-}"
EVENT="${SUBAGENT_EVENT:-api_trigger_subagent}"
MODEL_DEFAULT="${SUBAGENT_MODEL:-deepseek-v4.1-flash}"
THINKING_DEFAULT="${SUBAGENT_THINKING:-medium}"
POLL_INTERVAL="${SUBAGENT_POLL_INTERVAL:-10}"
# 等待期心跳输出的间隔（秒）。等子代理期间父代理若长时间无输出，会被
# npc:go 的「无输出超时」掐掉（本仓实测有过一次 map 调用在 10 分 0 秒被强杀）。
HEARTBEAT_INTERVAL="${SUBAGENT_HEARTBEAT_INTERVAL:-60}"
MAX_CHARS_DEFAULT="${SUBAGENT_MAX_CHARS:-12000}"
HARD_CAP_BYTES="${SUBAGENT_MAX_BYTES:-200000}"
DEPTH="${SUBAGENT_DEPTH:-0}"
MAX_DEPTH="${SUBAGENT_MAX_DEPTH:-2}"
WAIT_DEFAULT="${SUBAGENT_WAIT_TIMEOUT:-1800}"
IMG="${SUBAGENT_IMAGE:-cnbcool/default-npc:latest}"
# 并发超限（根组织 64）相关：命中后等待再补投，而不是直接失败
RETRY_DEFAULT="${SUBAGENT_RETRY:-30}"                    # 单个子任务最多补投次数
CONGESTION_WAIT_DEFAULT="${SUBAGENT_CONGESTION_WAIT:-15}" # 每次补投前等待秒数
# 准入观察窗口：并发超限实测在创建后 1s 内即可见，这里给 6s 足够。
# 即使窗口内没抓到，reap/wait 还会按「失败原因」再判一次（见 reap_result），
# 所以不需要在这里长时间空等 —— 那会让每次派发都白等十几秒。
ADMISSION_WAIT_DEFAULT="${SUBAGENT_ADMISSION_WAIT:-6}"
# 子流水线默认规格（核数）。核时按声明规格扣，轻负载不该按 8 核计费。
CPUS_DEFAULT="${SUBAGENT_CPUS:-2}"
# 规格自主决策：--cpus auto 在失败后允许的「升档重投」次数；以及显式 --escalate 的上限。
# 平台不支持运行时改规格（Pipeline 启动即固化），所以「按需分配」只能落到
# 「先按信号估一档 → 不够就自己加」这两步上。
CPUS_AUTO_ESCALATE="${SUBAGENT_ESCALATE:-2}"
CPUS_MAX_ESCALATE="${SUBAGENT_MAX_ESCALATE:-4}"
# 规格上限（平台 amd64 节点 1~64 核；arm64 只到 16，但本流水线跑 amd64）
CPUS_LIMIT=64
ADMISSION_STEP="${SUBAGENT_ADMISSION_STEP:-2}"
MAP_CONCURRENCY_DEFAULT="${SUBAGENT_MAP_CONCURRENCY:-8}"  # map 默认并发闸门

# ---- 主代理失效时的兜底回收（watchdog）----------------------------------
# 场景：主代理被平台中止（流水线时长上限 / 容器被销毁）时，它派出的子代理**不会**
# 跟着死 —— 各自占着根组织 64 条并发额度，并按声明规格继续烧核时。
# 父代理自己的回收逻辑（stop_child）只在它还活着时才跑得到，所以需要一条
# **独立于父代理**的看门狗构建，由它来收尸。
#
# 为什么看门狗停得掉别人（2026-10-01 本仓实测）：
#   · 普通 api_trigger 构建的 token 没有 repo-cnb-trigger:rw —— stop-build 对**任何** sn
#     都回 403/10023，get-build-status 也 403（子代理因此既不能自停也不能互停）；
#   · 带 npc.workMode:true 触发的构建才拿到该作用域（stop-build 回 422/NO_RECORD
#     而不是 403，说明已过鉴权）。
#   ⇒ 看门狗必须以 workMode 身份触发，否则它自己也是个停不掉东西的摆设。
#
# 怎么认出「同一个父代理的子代理」：派发时把 `parent=<父 SN>` 写进构建 title，
# 看门狗盯到父 SN 进终态后，按 title 前缀 + parent 标记过滤出待回收项逐个 stop。
# 用 title 而不是本地状态文件：看门狗跑在**另一条流水线**里，与父代理不共享文件系统。
WATCHDOG_ENABLED="${SUBAGENT_WATCHDOG:-1}"
WATCHDOG_POLL="${SUBAGENT_WATCHDOG_POLL:-30}"
WATCHDOG_MAX_SECS="${SUBAGENT_WATCHDOG_MAX:-7200}"
PARENT_SN="${CNB_BUILD_ID:-}"
# 子代理 title 前缀 + 父标记；看门狗按它过滤，两处必须一致（门禁据此核对）。
CHILD_TITLE_PREFIX="[subagent] "
PARENT_TAG_PREFIX="parent="

# 触发时依次尝试的分支候选。由 cmd_run 在触发前填好；这里给空数组兜底，
# 免得 set -u 下未赋值就被 start_child_checked 读到。
TRY_BRANCHES=()
# map 临时目录（供 EXIT trap 使用，见 cmd_map）
MAP_LOG_DIR=""

die() { printf 'subagent: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "缺少命令：$1"; }

# 正整数参数校验。
# 为什么必须校验：这些值全部直接参与 `[ "$x" -ge "$y" ]` 比较。容器里若传了
# 非数字（SUBAGENT_ADMISSION_WAIT=abc / --timeout abc），test 会报错并判「假」，
# 于是「等待上限」永远不成立 —— 表现为**永不返回**，只能等外层 2h 流水线超时。
is_pos_int() {
  case "$1" in
    ''|*[!0-9]*) return 1 ;;
  esac
  return 0
}
as_pos_int() {
  # as_pos_int <值> <默认> <参数名>
  if is_pos_int "$1"; then printf '%s\n' "$1"; else
    printf 'subagent: %s 不是正整数（%s），回落到默认 %s\n' "$3" "$1" "$2" >&2
    printf '%s\n' "$2"
  fi
}

# 打印用法：从第 3 行开始的所有注释行（到第一个非注释行为止）。
# 不能写死行号 —— 注释头一长就被截断，--help 看不到后半段参数说明。
usage() {
  awk 'NR < 3 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"
  exit "${1:-0}"
}

# 校验规格核数：必须是 1~64 的整数。
# 为什么必须校验：平台对 `cpus` 的行为不一致 —— 小数（3.5）会被受理并按 3.5 核记账，
# 0 会**静默**回落到默认 8 核（比请求的还大！），65 才在 Prepare 阶段直接报错。
# 放着不校验的话，`--cpus 0` 会让人以为「省了」，实际按 8 核扣核时。
# 平台上限是 64 核（amd64），故以此为准。
# 成功：stdout 输出归一化后的整数，返回 0；失败：返回 1（调用方决定怎么报错）。
valid_cpus() {
  case "$1" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "$1" -ge 1 ] && [ "$1" -le 64 ] || return 1
  printf '%s\n' "$1"
}

# ---- 思考档自主决策：--thinking auto ------------------------------------
# 平台可选档位（由低到高）：off < minimal < low < medium < high < xhigh < max。
# 档位越高越贵（token 与时长），所以「一律 high」和「一律 off」都不是好默认。
# 判据与 --cpus auto 同源：扫任务文本里的**认知难度**信号，取最高档，
# 依据打 stderr 可核对；未命中信号时回落默认档（THINKING_DEFAULT，当前 medium）。
# stdout 只输出档位（供调用方捕获），日志一律走 stderr。
THINKING_LEVELS_LIST="off minimal low medium high xhigh max"
valid_thinking() {
  case "$1" in
    off|minimal|low|medium|high|xhigh|max) printf '%s\n' "$1" ;;
    *) return 1 ;;
  esac
}
thinking_signal() {
  local task="$1" best="" hit="未命中难度信号（按默认档处理）" i
  # 从低到高排列，命中多个取**最高**档（重活宁可信其有：低估会让子代理反复跑错）。
  # ⚠️ 但模式必须写具体：初版在「常规实现」档里放了裸的 `改`，于是
  # 「把这段文案的措辞统一一下，改个错别字」同时命中「文案」(off) 与「改」(medium)，
  # 取最高档得 medium —— 一句纯搬运被判成常规实现，正是本函数要避免的浪费。
  # 规则：档位越高，模式越要具体（动词短语），别用「改 / 写 / 看」这类万能字。
  local levels=(off low medium high max)
  local labels=(
    "纯搬运（改文案 / 改格式 / 翻译）"
    "读与查（读代码、查文档、归纳摘要、列举）"
    "常规实现（写脚本、改配置、审查）"
    "复杂实现（重构、多文件改动、调试报错）"
    "疑难（架构设计、根因排查、性能与安全分析）"
  )
  local pats=(
    "改文案|文案|措辞|格式化|统一格式|翻译|错别字|typo|重命名|改名|排版"
    "读|查|摘要|总结|归纳|列举|列出|盘点|检索|搜索|文档|解释|说明|梳理|审查|review|调研"
    "实现|新增|添加|修复|编写|接入|录入|配置|改造|补上|补齐|脚本|注释"
    "重构|多文件|迁移|升级|调试|排查|报错|失败|崩溃|兼容|bug|缺陷|回归|批量替换"
    "架构|设计|方案|根因|深度|疑难|性能|优化|审计|安全|成本|统计|分析报告"
  )
  for i in 0 1 2 3 4; do
    if printf '%s' "$task" | grep -Eqi -- "${pats[$i]}"; then
      printf 'subagent[think]: 命中信号「%s」→ %s\n' "${labels[$i]}" "${levels[$i]}" >&2
      best="${levels[$i]}"; hit="${labels[$i]}"
    fi
  done
  [ -n "$best" ] || best="$THINKING_DEFAULT"
  printf 'subagent[think]: 起始档 %s（%s）\n' "$best" "$hit" >&2
  printf '%s' "$best"
}

# ---- 规格自主决策：--cpus auto -----------------------------------------
# 实测依据（2026-09-25 本仓探针，四档各起一条子流水线，同一份负载）：
#   cpus=1 → 2 GiB 内存：一次性分配 3 GiB 被 OOM Kill（进程 exit 137，Stage 报 Killed）
#   cpus=2 → 4 GiB 内存：chromium --headless 正常（rc=0，DOM 取回）
#   cpus=4 / 8 → 8 / 16 GiB：chromium 同样正常
#   16 路 sha256（真并行段）：2 核 0.20s / 4 核 0.14s / 8 核 0.06s
#   单线程段：2 / 4 / 8 核**都是 0.01s**（核数不会让单线程变快）
# 结论：核数买到的是「并行度 + 内存上限（= 核数 × 2 GiB）」，不是单线程速度。
# 而核时 = **声明规格** × 时长 → 轻任务估高是纯浪费，重任务估低是 OOM / 跑不完。
# 所以 auto 按「任务文本里的资源信号」取**最高**档（宁可留余量，重跑比多占几核贵）。
# stdout 只输出核数（供调用方捕获）；推理过程走 stderr，用户可核对是否合理。
resource_signal() {
  local task="$1" i best=0 hit="未命中重活信号（按等模型返回处理）"
  local levels=(2 4 8)
  local labels=(
    "等模型返回（读代码 / 查文档 / 归纳）"
    "有真实计算段（跑测试 / 打包 / 静态检查）"
    "CPU 密集 / 大内存（编译大项目 / 压测 / 转码 / 浏览器）"
  )
  local pats=(
    "读|查|摘要|总结|归纳|审查|review|调研|检索|搜索|文档|解释|梳理|列举"
    "测试|单测|回归|pytest|jest|vitest|npm run|npm build|打包|构建|编译|build|compile|make|cmake|cargo|maven|gradle|webpack|vite|tsc|bazel|lint|类型检查"
    "压测|bench|benchmark|转码|ffmpeg|docker build|chromium|headless|浏览器|browser|多路并行|大规模|批量编译|数值|矩阵|加密|哈希|训练|渲染"
  )
  for i in 0 1 2; do
    if printf '%s' "$task" | grep -Eqi -- "${pats[$i]}"; then
      printf 'subagent[spec]: 命中信号「%s」→ %s 核\n' "${labels[$i]}" "${levels[$i]}" >&2
      if [ "${levels[$i]}" -gt "$best" ]; then best="${levels[$i]}"; hit="${labels[$i]}"; fi
    fi
  done
  [ "$best" -gt 0 ] || best="$CPUS_DEFAULT"
  printf 'subagent[spec]: 起始档 %s 核（%s）\n' "$best" "$hit" >&2
  # stdout 只留数字：调用方用 $( ) 捕获，不能混入日志
  printf '%s' "$best"
}

# 升档阶梯：×2，封顶平台上限。
next_cpus() {
  # 注意：不能写成 `local cur="$1" nxt=$(( cur * 2 ))` —— 同一条 local 命令里
  # 后面的算术展开读不到前面刚声明的变量，set -u 下直接 "cur: unbound variable"。
  local cur="$1"
  local nxt=$(( cur * 2 ))
  [ "$nxt" -le "$CPUS_LIMIT" ] || nxt="$CPUS_LIMIT"
  printf '%s' "$nxt"
}

# 判定「上一轮是不是**因为资源不够**才失败」—— 这是升档重投的唯一证据来源。
# 只认明确信号：OOM Kill / 内存分配失败 / 被 SIGKILL。刻意不把「任意失败」都算作
# 资源问题 —— 配置错误、权限错误、代码报错升档也没用，只会白花核时。
RESOURCE_FAIL_RE='Killed|out of memory|OutOfMemory|MemoryError|Cannot allocate memory|exit code 137|exit status 137|signal: killed|no space left on device'
resource_failure() {
  local sn="$1" sid
  sid="$(cnb build get-build-status --repo "$REPO" --sn "$sn" -v 2>/dev/null \
        | jq -r --arg sn "$sn" '.data.pipelinesStatus[$sn + "-001"].stages[]?
            | select(.status == "error") | .id' 2>/dev/null | head -n1)"
  [ -n "$sid" ] || return 1
  cnb build get-build-stage --repo "$REPO" --sn "$sn" \
      --pipelineId "$sn-001" --stageId "$sid" -v 2>/dev/null \
    | jq -r '.data.content[]?' 2>/dev/null | tail -n 80 | grep -Eqi "$RESOURCE_FAIL_RE"
}

# 收口类函数（cmd_wait）统一走**返回码**而不是 exit —— 这样 run 的升档重投
# 才能「拿到码后继续做事」。脚本入口处 cmd_wait 是最后一条命令，其返回码
# 自然成为脚本退出码，`subagent.sh wait` 的命令行语义不变。
#
# 踩过的坑：曾用一个 wret() 包装（内部 return/exit 二选一）替代 exit。
# 那是错的 —— shell 的 return 只从**它自己**那个函数返回，调用方（cmd_wait）
# 会接着往下跑，于是「失败」被当成「成功」继续执行到 return 0。
# 升档判决因此整段失效，而日志里看不出来。


# 子流水线定义（内联下发）。Stage 名 emit 与其输出格式被本脚本解析，改名需同步。
#
# heredoc 未加引号：${EVENT}/${IMG} 在父代理侧展开，
# 其余 \$ 转义的是**子流水线运行时**才该展开的变量，不要提前展开。
child_config() {
  cat <<YAML
\$:
  ${EVENT}:
    - # 子代理流水线默认只跑「一次 AI 任务 + 一次回传」，属轻负载，
      # 没必要按默认 8 核 16G 占额度：核时按**声明规格**扣（8 核跑 10 分钟 = 1.33 核时），
      # 平台共享根组织 64 条并发额度。默认压到 2 核 4G。
      # 想吃 CPU 的重活（跑构建 / 压测 / 转码）用 --cpus 8 显式加。
      # 只影响子流水线，不动主代理规格。
      #
      # cpus 走变量替换：下面 env 里的 SUBAGENT_CPUS 是**兜底值**，
      # 触发请求里的同名 env 会覆盖它（实测生效）—— 这就是 --cpus 的实现路径。
      # ⚠️ 变量替成空会退化成「cpus:」（null）并静默回落默认 8 核，所以必须留兜底。
      # 注意本条注释也别写反引号：本 heredoc 未加引号（要展开 ${EVENT}/${IMG}），
      # 反引号会被 shell 当命令替换执行 —— 实测报 "cpus:: command not found"，
      # 且它在注释里、不影响构建结果，所以只会在 stderr 里静静地脏掉。
      # 同理别在注释里写裸变量名（见 .cnb/scripts/README.md「踩坑」）。
      env:
        SUBAGENT_CPUS: "2"
      runner:
        cpus: \$SUBAGENT_CPUS
      docker:
        image: ${IMG}
      stages:
        - name: subagent
          type: npc:go
          # 抬高「无输出超时」：子代理常跑长审计 / 长命令，工具执行期间可能
          # 长时间无输出。不声明时按平台默认 **10 分钟**掐掉（与主流水线同款坑，
          # 主流水线的 npc go 已声明 30m）。注意它**抬不了**子流水线整体运行时长。
          timeout: 30m
          options:
            model: \$SUBAGENT_MODEL
            contextWindow: 1m
            thinkingLevel: \$SUBAGENT_THINKING
            supportImage: false
            systemPrompt: \$SUBAGENT_SYSTEM
            userPrompt: \$SUBAGENT_TASK
          exports:
            result: SUBAGENT_RESULT
        - name: emit
          script: |
            RESULT_FILE=/tmp/subagent-result.txt
            printf '%s' "\${SUBAGENT_RESULT:-}" > "\$RESULT_FILE"
            LIMIT="\${SUBAGENT_MAX_BYTES:-200000}"
            SIZE=\$(wc -c < "\$RESULT_FILE" | tr -d ' ')
            if [ "\$LIMIT" != "0" ] && [ "\$SIZE" -gt "\$LIMIT" ]; then
              # 字节安全阀：仅防日志爆量，按字符的精细截断由父代理负责
              head -c "\$LIMIT" "\$RESULT_FILE" > "\$RESULT_FILE.cut"
              mv "\$RESULT_FILE.cut" "\$RESULT_FILE"
            fi
            # 单行 base64 回传，规避日志换行 / 转义字符破坏内容
            printf 'SUBAGENT_RESULT_B64:'
            base64 -w0 "\$RESULT_FILE" 2>/dev/null || base64 "\$RESULT_FILE" | tr -d '\n'
            printf ':END\n'
YAML
}

# 看门狗子流水线的内联配置。
#
# 用**带引号**的 heredoc（不展开）：脚本里全是运行期变量与 jq 表达式，
# 走未加引号的 heredoc 得逐个转义 `$`，且注释里一旦写反引号就会被父代理当命令替换
# 执行（门禁 check_unquoted_heredoc 专门查这个坑）。事件名与镜像用占位符 + sed 替换。
watchdog_config() {
  cat <<'WATCHDOG_YAML' | sed -e "s|__WD_EVENT__|${EVENT}|g" -e "s|__WD_IMG__|${IMG}|g"
$:
  __WD_EVENT__:
    - runner:
        cpus: 1
      docker:
        image: __WD_IMG__
      stages:
        - name: watchdog
          script: |
            set -u
            PARENT="$SUBAGENT_PARENT_SN"
            SELF="$CNB_BUILD_ID"
            REPO="$CNB_REPO_SLUG"
            EVENT="$SUBAGENT_EVENT"
            POLL="${SUBAGENT_WATCHDOG_POLL:-30}"
            MAX="${SUBAGENT_WATCHDOG_MAX:-7200}"
            TAG="] ${SUBAGENT_PARENT_TAG:-parent=}$PARENT"
            PREFIX="${SUBAGENT_CHILD_PREFIX:-[subagent] }"

            echo "[watchdog] 守护父代理 $PARENT（自身 $SELF），轮询 ${POLL}s，最长 ${MAX}s"

            START=$(date +%s)
            UNKNOWN=0
            while :; do
              NOW=$(date +%s)
              if [ "$((NOW - START))" -ge "$MAX" ]; then
                echo "[watchdog] 到达最长存活（${MAX}s），父代理仍未终态，退出"
                exit 0
              fi
              ST=$(cnb build get-build-status --repo "$REPO" --sn "$PARENT" -v 2>/dev/null \
                     | jq -r '.data.status // empty' 2>/dev/null)
              case "$ST" in
                success|error|cancel|failed) echo "[watchdog] 父代理已终态：$ST，开始回收它的子代理"; break ;;
                "")
                  # 读不到：可能只是抖动，也可能是构建记录已被清理。连续 10 次按终态处理，
                  # 否则看门狗会一直等到自己的最长存活 —— 那段时间里子代理还在烧核时。
                  UNKNOWN=$((UNKNOWN + 1))
                  if [ "$UNKNOWN" -ge 10 ]; then
                    echo "[watchdog] 父代理状态连续 10 次读不到，按已失效处理"
                    break
                  fi ;;
                *) UNKNOWN=0 ;;
              esac
              sleep "$POLL"
            done

            # 回收：列出仍在跑的构建，按「子代理 title 前缀 + parent 标记」过滤后逐个 stop。
            # 必须翻页 —— 单页装不下时漏掉的正是排在后面的那些。
            KILLED=0; SEEN=0
            PAGE=1
            while [ "$PAGE" -le 20 ]; do
              OUT=$(cnb build get-build-logs --repo "$REPO" --event "$EVENT" \
                      --status pending --page "$PAGE" --page-size 100 -v 2>/dev/null)
              N=$(printf '%s' "$OUT" | jq -r '.data.data | length' 2>/dev/null)
              case "$N" in ''|*[!0-9]*) break ;; esac
              [ "$N" -gt 0 ] || break
              SEEN=$((SEEN + N))
              for sn in $(printf '%s' "$OUT" | jq -r --arg p "$PREFIX" --arg t "$TAG" --arg self "$SELF" \
                    '.data.data[]? | select(.sn != $self)
                       | select((.title // "") | tostring | startswith($p))
                       | select((.title // "") | tostring | contains($t))
                       | select((.title // "") | tostring | startswith($p + "watchdog ") | not)
                       | .sn' 2>/dev/null); do
                [ -n "$sn" ] || continue
                R=$(cnb build stop-build --repo "$REPO" --sn "$sn" -v 2>/dev/null)
                # 判据看**响应体**：stop-build 对已终态 / 不存在的 sn 都返回退出码 0，
                # 真实错误只在 errcode / errmsg 里（SUBAGENT 侧 stop_child 同款教训）。
                E=$(printf '%s' "$R" | jq -r '.data.errcode // 0' 2>/dev/null)
                case "$E" in
                  0) KILLED=$((KILLED + 1)); echo "[watchdog] 已回收 $sn" ;;
                  *) echo "[watchdog] $sn 回收未生效（errcode=$E）" ;;
                esac
              done
              PAGE=$((PAGE + 1))
            done
            echo "[watchdog] 完成：扫过 $SEEN 条待回收构建，停掉 $KILLED 个子代理"
WATCHDOG_YAML
}

# 派一次看门狗（同一父代理**只派一次**）。
#
# 只派一次：每次派发子代理都建一条看门狗会让构建数翻倍、白占并发额度。
# 用 /tmp 标记文件去重 —— 同一个容器就是同一个父代理（CNB_BUILD_ID 唯一）。
#
# 失败不致命：看门狗是「兜底」，派不出去只是退回旧行为（子代理没人收尸）。
# 所以这里一律 warn 而不 die，并把标记删掉让下一次派发重试
# （最常见失败是并发超限，属瞬时拥塞）。
ensure_watchdog() {
  [ "$WATCHDOG_ENABLED" = "1" ] || return 0
  [ -n "$PARENT_SN" ] || return 0
  [ -n "$TOKEN" ] || return 0
  # 标记目录可覆盖（自测要能隔离，否则上一轮留下的标记会让本轮永远不起看门狗）。
  # 默认 /tmp：同一个容器就是同一个父代理，天然满足「一父一看门狗」。
  local marker="${SUBAGENT_WATCHDOG_DIR:-/tmp}/subagent-watchdog-${PARENT_SN}"
  [ -e "$marker" ] && return 0
  : > "$marker"

  local cfg body resp sn errmsg
  cfg="$(watchdog_config)"
  body="$(jq -n --arg event "$EVENT" --arg branch "$BRANCH" --arg cfg "$cfg" \
    --arg title "${CHILD_TITLE_PREFIX}watchdog ${PARENT_TAG_PREFIX}${PARENT_SN}" \
    --arg parent "$PARENT_SN" --arg ev "$EVENT" \
    --arg prefix "$CHILD_TITLE_PREFIX" --arg tag "$PARENT_TAG_PREFIX" \
    --arg poll "$WATCHDOG_POLL" --arg max "$WATCHDOG_MAX_SECS" \
    '{event:$event, branch:$branch, config:$cfg, title:$title, sync:false,
      env:{SUBAGENT_PARENT_SN:$parent, SUBAGENT_EVENT:$ev,
           SUBAGENT_WATCHDOG_POLL:$poll, SUBAGENT_WATCHDOG_MAX:$max,
           SUBAGENT_CHILD_PREFIX:$prefix, SUBAGENT_PARENT_TAG:$tag},
      npc:{name:"CodeBuddy", workMode:true}}')"

  resp="$(curl -sS --max-time 60 -X POST "${API}/${REPO}/-/build/start" \
    -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
    --data "$body" 2>&1)" || resp=""
  sn="$(printf '%s' "$resp" | jq -r '.sn // empty' 2>/dev/null)"
  if [ -z "$sn" ]; then
    errmsg="$(printf '%s' "$resp" | jq -r '.errmsg // .errMsg // empty' 2>/dev/null)"
    rm -f "$marker"
    if is_congestion_msg "$errmsg"; then
      printf 'subagent: 看门狗未能开跑（并发已满），下次派发时重试\n' >&2
    else
      printf 'subagent: 看门狗未派出（%s）—— 主代理若中途失效，其子代理不会被自动回收\n' \
        "${errmsg:-未知原因}" >&2
    fi
    return 0
  fi
  printf 'subagent: 看门狗已启动（%s）—— 主代理失效时由它回收本轮子代理\n' "$sn" >&2
  return 0
}

# 查询构建状态。构建刚创建时接口可能短暂不可用或字段缺失，
# 统一把「读不到 / 不认识」折成 pending，避免误判成失败。
build_status() {
  local out
  out="$(cnb build get-build-status --repo "$REPO" --sn "$1" -v 2>/dev/null \
        | jq -r '.data.status // empty' 2>/dev/null)"
  case "$out" in
    success|error|cancel|failed|pending|prepare|running) printf '%s\n' "$out" ;;
    # 查不到 / 不认识：**不要**直接折成 pending。构建被外部取消后从列表消失、
    # CLI 403、平台新增终态名（skipped / timeout）都会走到这里；折成 pending
    # 会让收口循环永远等下去（旧版 map 因此会挂到 2h 上限）。
    # 交给调用方按「连续失败次数」决定是继续等还是收口。
    *) printf 'unknown\n' ;;
  esac
}

# 并发超限的判定串。实测两种文案，都要认：
#   The number of concurrent builds has exceeded the limit set for the root organization: 64.
#   The number of concurrent pipelines has exceeded the limit set for the root organization: 64.
#   并发构建数量超出根组织限制：64 / 并发流水线数量超出根组织限制：64
CONGESTION_RE='concurrent (builds|pipelines) has exceeded|并发(构建|流水线)数量超出根组织限制'

# 取构建失败原因（errMsg）。构建刚创建时该字段为空，属正常。
build_errmsg() {
  cnb build get-build-status --repo "$REPO" --sn "$1" -v 2>/dev/null \
    | jq -r '.data.errMsg // empty' 2>/dev/null
}

# 是否并发超限
is_congestion_msg() {
  printf '%s' "$1" | grep -Eq "$CONGESTION_RE"
}

# 等待一个刚触发的构建「准入」：
# 并发超限不是同步报错，而是先给 sn、短暂 pending，再被判 error。
# 所以要观察一小段时间：拿到 sn 且未在观察窗口内被判并发超限 → 视为已准入。
# 返回 0 = 已准入；返回 1 = 并发超限（errmsg 自 stdout 输出）；返回 2 = 其它失败
await_admission() {
  local sn="$1" limit="${2:-$ADMISSION_WAIT_DEFAULT}" waited=0 st msg
  limit="$(as_pos_int "$limit" "$ADMISSION_WAIT_DEFAULT" "准入观察窗口")"
  while :; do
    st="$(build_status "$sn")"
    case "$st" in
      success|pending|prepare|running) : ;;
      unknown)
        # 瞬时抖动：不判死，但也不能让它把观察窗口拖成无限
        [ "$waited" -ge "$limit" ] && return 0
        sleep "$ADMISSION_STEP"
        waited=$((waited + ADMISSION_STEP))
        continue
        ;;
      *)
        msg="$(build_errmsg "$sn")"
        if is_congestion_msg "$msg"; then
          printf '%s\n' "$msg"
          return 1
        fi
        printf '%s\n' "${msg:-status=$st}"
        return 2
        ;;
    esac
    [ "$waited" -ge "$limit" ] && return 0
    sleep "$ADMISSION_STEP"
    waited=$((waited + ADMISSION_STEP))
  done
}

stage_id_of() {
  cnb build get-build-status --repo "$REPO" --sn "$1" -v 2>/dev/null \
    | jq -r --arg sn "$1" --arg name "$2" \
        '.data.pipelinesStatus[$sn + "-001"].stages[]? | select(.name == $name) | .id' \
    2>/dev/null | head -n1
}

# 按【字符】截断，保证不切坏 UTF-8 多字节序列。
# 注意：bash 的 ${var:0:N} 在 LC_ALL/LANG 未启用 UTF-8 的容器里按【字节】计，
# 会把中文、emoji 切成半个字符，产出非法 UTF-8。这里统一交给 python3 按字符切。
truncate_chars() {
  # truncate_chars <字符数> [内容来源: 省略=读 stdin]
  python3 -c '
import sys
limit = int(sys.argv[1])
data = open(sys.argv[2], "rb").read() if len(sys.argv) > 2 else sys.stdin.buffer.read()
text = data.decode("utf-8", "replace")
sys.stdout.write(text[:limit] if limit > 0 else text)
' "$1"
}

# 字符数统计，同样走 python3，避免 bash 按字节计数
count_chars() {
  python3 -c '
import sys
data = open(sys.argv[1], "rb").read() if len(sys.argv) > 1 else sys.stdin.buffer.read()
sys.stdout.write(str(len(data.decode("utf-8", "replace"))))
' "$@"
}

# 触发子流水线，并确认它「已准入」（没有撞上根组织并发上限）。
#
# 为什么需要这个：并发超限**不是同步报错**，而是先返回 sn、短暂 pending，
# 再被判 error（实测 1~20s 内可见）。所以「拿到 sn」不等于「跑起来了」。
# 本函数拿到 sn 后调用 await_admission 观察；命中超限则等待后补投，最多 retry 次。
#
# 成功：stdout 输出可用的 sn，返回 0
# 拥挤：等位重试耗尽仍被挡下，返回 1（可用信号，非失败）
# 其它：die（真实配置问题要暴露，不吞）
start_child_checked() {
  local body="$1" retry="$2" wait="$3"
  local attempt=0 resp sn errmsg reason rc try_branch
  local -a branches=(${TRY_BRANCHES[@]+"${TRY_BRANCHES[@]}"})
  [ "${#branches[@]}" -gt 0 ] || branches=("$BRANCH")

  while :; do
    errmsg=""
    for try_branch in ${branches[@]+"${branches[@]}"}; do
      body="$(printf '%s' "$body" | jq -c --arg b "$try_branch" '.branch = $b')"
      resp="$(curl -sS --max-time 60 -X POST "${API}/${REPO}/-/build/start" \
        -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
        --data "$body" 2>&1)" || { errmsg="触发请求失败：$resp"; continue; }
      sn="$(printf '%s' "$resp" | jq -r '.sn // empty' 2>/dev/null)"
      if [ -z "$sn" ]; then
        errmsg="$(printf '%s' "$resp" | jq -r '.errmsg // .' 2>/dev/null)"
        # 同步被判超限：跳出分支循环，走等位
        is_congestion_msg "$errmsg" && break
        continue
      fi
      reason="$(await_admission "$sn")"
      rc=$?
      if [ "$rc" = "0" ]; then
        printf '%s\n' "$sn"
        return 0
      fi
      if [ "$rc" = "1" ]; then
        errmsg="$reason"
        break
      fi
      # rc=2：构建**创建成功了**（拿到 sn），只是在准入观察窗口内就进了终态
      # （起得快、挂得也快：OOM 立刻被 Kill、或任务本身秒级报错）。
      # 旧版这里直接 die，把「已创建但秒挂」当真失败拒掉了 —— 于是
      # 「资源不足 → 自主升档重投」永远走不到：升档需要拿到 sn 才能去读日志取证。
      # 现在把 sn 交回上层：由上层按 resource_failure 判是不是资源问题，
      # 是就升档重投，不是就如实报失败（dump_failure 会打出失败 Stage 日志，不会静默）。
      printf 'subagent: 子代理 %s 起得异常快（准入窗口内即终态），转由上层判定：%s\n' \
        "$sn" "${reason:-未知原因}" >&2
      printf '%s\n' "$sn"
      return 0
    done

    if [ -n "$errmsg" ] && is_congestion_msg "$errmsg"; then
      if [ "$attempt" -ge "$retry" ]; then
        # 注意：本函数在 `$( )` 里执行，内部 `die` 只会结束子 shell，
        # 它的退出码 1 会与「容量不足」的信号撞车 —— 于是配置类错误
        # （如 event 未授权）会被上层翻译成「并发已达 64」，白等 30 轮。
        # 所以两个信号必须分开：2 = 容量（可重试），1 = 真失败。
        return 2
      fi
      attempt=$((attempt + 1))
      printf 'subagent: 并发构建数已达根组织上限，%ss 后补投（第 %s/%s 次）\n' \
        "$wait" "$attempt" "$retry" >&2
      sleep "$wait"
      continue
    fi
    die "触发子代理被拒绝：${errmsg:-未知错误}"
  done
}

# 从 emit Stage 日志里解出子代理结论
extract_result() {
  cnb build get-build-stage --repo "$REPO" --sn "$1" \
      --pipelineId "$1-001" --stageId "$2" -v 2>/dev/null \
    | python3 -c '
import base64, json, re, sys

try:
    lines = json.load(sys.stdin)["data"]["content"]
except Exception:
    sys.exit("subagent: 无法解析 Stage 日志")

# 取最后一个匹配：日志会先回显脚本源码，其中模式串缺少合法 base64 尾巴
pattern = re.compile(r"SUBAGENT_RESULT_B64:([A-Za-z0-9+/=]*):END")
payload = None
for line in lines:
    for match in pattern.finditer(re.sub(r"\x1b\[[0-9;]*m", "", line)):
        payload = match.group(1)

if payload is None:
    sys.exit("subagent: 日志中没有结果标记（emit 阶段是否被改动？）")
if not payload:
    print("")
    sys.exit(0)
try:
    sys.stdout.write(base64.b64decode(payload).decode("utf-8", "replace"))
except Exception as exc:
    sys.exit(f"subagent: 结果解码失败：{exc}")
'
}

# 失败时打印失败 Stage 尾部日志，父代理不必再翻构建详情。
#
# ⚠️ 必须优先打印 Stage 的 `error` 字段，再打 `content` 尾部日志。
# 真机教训（2026-10-01 本仓）：一次 10 路子代理并行审计，10 路全部在 ~9 分钟处
# 被平台中止 —— 真死因写在 Stage 的 `error` 字段里
# （`[LLM request error ...] Pipeline has been stopped, Agent aborted`），
# 而**日志尾部**当时是一段与失败无关的文档 grep 输出。旧版只看 content，
# 父代理因此完全看不到死因，只能报一句「子代理未成功」。
dump_failure() {
  local sn="$1" sid sname errmsg
  cnb build get-build-status --repo "$REPO" --sn "$sn" -v 2>/dev/null \
    | jq -r --arg sn "$sn" '.data.pipelinesStatus[$sn + "-001"].stages[]?
        | select(.status == "error") | "\(.id)\t\(.name)"' 2>/dev/null \
    | while IFS=$'\t' read -r sid sname; do
        [ -n "$sid" ] || continue
        # Stage 级 error 字段：平台给出的**结构化死因**，比日志尾部可靠得多
        errmsg="$(cnb build get-build-stage --repo "$REPO" --sn "$sn" \
            --pipelineId "$sn-001" --stageId "$sid" -v 2>/dev/null \
          | jq -r '.data.error // empty' 2>/dev/null)"
        if [ -n "$errmsg" ]; then
          printf 'subagent: 失败 Stage「%s」的死因：%s\n' "$sname" "$errmsg" >&2
        fi
        printf 'subagent: 失败 Stage「%s」尾部日志：\n' "$sname" >&2
        cnb build get-build-stage --repo "$REPO" --sn "$sn" \
            --pipelineId "$sn-001" --stageId "$sid" -v 2>/dev/null \
          | jq -r '.data.content[]?' 2>/dev/null | tail -n 25 >&2
      done
}

# 回收一个**仍在跑**的子代理构建 —— 用户要的「关闭子代理」。
#
# 为什么必须能回收：核时按**声明规格** × 时长扣（与容器实际占用无关），
# 而根组织并发额度只有 64 条。父代理一旦放弃等待（超时升档重投），
# 留在场上的旧子代理就是纯浪费：既占额度又烧核时。
#
# ⚠️ 判据必须是响应体里的 errcode / errmsg，**不能看退出码**：
#   实测 stop-build 对「已终态的构建」与「不存在的 sn」都返回退出码 0
#   （错误只在 body 里：STOP_FAIL_WRONG_STATUS / STOP_FAIL_NO_RECORD）。
#   拿退出码判断会把上面两种「其实没问题」的情况报成回收失败。
# 返回 0 = 已终态 / 已成功回收；1 = 平台明确拒绝（需调用方决定是否降级为提示）。
stop_child() {
  local sn="$1" why="${2:-回收}" st resp errcode errmsg
  [ -n "$sn" ] || return 0
  st="$(build_status "$sn")"
  case "$st" in
    success|error|cancel|failed) return 0 ;;   # 已经死了，没什么可回收的
  esac
  resp="$(cnb build stop-build --repo "$REPO" --sn "$sn" -v 2>/dev/null || true)"
  errcode="$(printf '%s' "$resp" | jq -r '.data.errcode // 0' 2>/dev/null)"
  errmsg="$(printf '%s' "$resp" | jq -r '.data.errmsg // empty' 2>/dev/null)"
  case "$errmsg" in
    # 已终态 / 无记录：目标已经是死的，视为「无需回收」，不是失败
    *STOP_FAIL_WRONG_STATUS*|*STOP_FAIL_NO_RECORD*) return 0 ;;
  esac
  if [ "${errcode:-0}" != "0" ]; then
    printf 'subagent: 回收失败（%s）：%s—— %s 可能仍在跑，必要时用 status --sn 复核\n' \
      "${errcode:-?}" "${errmsg:-未知原因}" "$sn" >&2
    return 1
  fi
  printf 'subagent: 已回收子代理 %s（%s）—— 不再占并发额度与核时\n' "$sn" "$why" >&2
  # 台账里标「已回收」：不然它会在清单上永远显示「运行中」，而用户已经看不到它了。
  progress_sub "$sn" stopped
  return 0
}

cmd_stop() {
  local sn="" why="手动回收"
  while [ $# -gt 0 ]; do
    case "$1" in
      --sn) sn="$2"; shift 2 ;;
      --reason) why="$2"; shift 2 ;;
      *) die "未知参数：$1" ;;
    esac
  done
  [ -n "$sn" ] || die "stop 需要 --sn"
  need jq; need cnb
  local st
  st="$(build_status "$sn")"
  case "$st" in
    success|error|cancel|failed)
      printf 'subagent: %s 已是终态（%s），无需回收\n' "$sn" "$st" >&2
      return 0 ;;
  esac
  stop_child "$sn" "$why"
}

# ── 父 → 子 上下文注入 ────────────────────────────────────────────────
# 实测量出来的缺口（2026-10-01 本仓，子代理容器内 `env | sort` 探针）：
# 子代理能看到的只有 SUBAGENT_NAME / TASK / SYSTEM / MODEL / THINKING /
# CPUS / MAX_BYTES / DEPTH 八个变量 —— **没有**父 SN、没有 Issue/PR 编号、
# 没有父进度评论链接。也就是说子代理不知道自己从哪儿被派出来的：结论回来时
# 引用不了父任务，也没法回到父任务所在的 Issue 对齐上下文。
# （用户反馈「子线程和父线程之间的联系好像不是很好」，这是其中一条硬缺口。）
#
# 修法是**结构化注入**：env 给子代理里的脚本用，system 提示给子代理的模型用，
# 两处同源，不会漂移。
parent_target_type() {
  if [ "${CNB_PULL_REQUEST:-false}" = "true" ] || [ -n "${CNB_PULL_REQUEST_IID:-}" ]; then
    printf 'pull_request'
  else
    printf 'issue'
  fi
}

parent_target_number() {
  if [ "$(parent_target_type)" = "pull_request" ]; then
    printf '%s' "${CNB_PULL_REQUEST_IID:-}"
  else
    printf '%s' "${CNB_ISSUE_IID:-}"
  fi
}

# 父任务所在 Issue / PR 的网页地址。优先用平台给的 CNB_EVENT_URL
# （评论事件下它就是该评论所属的 Issue/PR 链接），拿不到再按类型 + 编号拼。
parent_target_url() {
  if [ -n "${CNB_EVENT_URL:-}" ]; then printf '%s' "$CNB_EVENT_URL"; return 0; fi
  local t n
  t="$(parent_target_type)"; n="$(parent_target_number)"
  [ -n "$n" ] || return 0
  if [ "$t" = "pull_request" ]; then
    printf '%s/%s/-/pulls/%s' "$WEB" "$REPO" "$n"
  else
    printf '%s/%s/-/issues/%s' "$WEB" "$REPO" "$n"
  fi
}

# 父代理进度评论的定位链接。拿不到就返回空（不致命 —— 子代理少一条线索而已）。
# 刻意 `|| true` 兜住：npc-progress.sh 可能不存在（跨仓自举失败），
# 也可能本轮压根没建进度评论。
parent_progress_url() {
  local sc="${SUBAGENT_PROGRESS_SCRIPT:-.cnb/scripts/npc-progress.sh}" out
  [ -f "$sc" ] || return 0
  out="$(bash "$sc" link 2>/dev/null || true)"
  case "$out" in https://*) printf '%s' "$out" ;; esac
}

# 给子代理的「你的出处」提示。刻意写短：它进的是子代理的 system prompt。
parent_context_note() {
  local url progress kind
  url="$(parent_target_url)"
  progress="$(parent_progress_url)"
  if [ "$(parent_target_type)" = "pull_request" ]; then kind="PR"; else kind="Issue"; fi
  printf '你的出处（父代理上下文，由主代理注入，不是任务本身）：\n'
  printf -- '- 父构建 SN：%s\n' "${PARENT_SN:-未知}"
  printf -- '- 父仓库：%s\n' "${REPO:-未知}"
  [ -n "$url" ] && printf -- '- 父任务所在的 %s：%s\n' "$kind" "$url"
  [ -n "$progress" ] && printf -- '- 父代理的进度评论：%s\n' "$progress"
  printf '你可以据此对齐上下文；除非子任务里明确要求，否则不要往父任务的 Issue/PR 发评论。\n'
}

# ── 子 → 父 溯源头 ────────────────────────────────────────────────────
# 实测缺口之二（2026-10-01 本仓）：`fetch_result` 只把子代理的**正文**回给父代理，
# SN / 构建链接 / 规格 / 思考档全丢了。父代理汇总时引不出来源，用户也没法点进去
# 看子代理到底干了什么 —— 这正是「父子之间联系不好」的另一半：
# 结论有了，出处没了。
# 出处头打进 stderr（不污染 stdout 的结论本身，`$( )` 取结论的调用方不受影响），
# 同时写进 --out 落盘文件的开头，让下游汇总看得到。
child_provenance() {
  local sn="$1" name="$2" cpus="$3" thinking="$4" secs="$5"
  printf '子代理：%s ｜ 构建 %s ｜ %s 核 ｜ 思考 %s ｜ 耗时 %ss\n构建日志：%s/%s/-/build/logs/%s\n' \
    "$name" "$sn" "$cpus" "$thinking" "${secs:-?}" "$WEB" "$REPO" "$sn"
}

# ── 失败 / 超时时的「部分结论」抢救 ───────────────────────────────────
# 实测缺口之三：子代理被平台中止（撞运行时长上限 / 被 OOM Kill / 父代理放弃等待）时，
# 它**已经产出的正文**照样烂在 AI 请求明细里，父代理却只收到一句「未成功」——
# 跑了二十分钟的分析一个字都拿不回来（本仓真机：一次 10 路子代理并行审计，
# 10 路全在 ~9 分钟处被中止，父代理只看到「子代理未成功」）。
#
# 这里从 AI 请求明细里把它最后一条 assistant 正文捞出来，作为「部分结论」附上。
# 判据与取舍：
#   · 只在失败/超时路径调用（成功路径走 emit 标记，那才是权威结论）；
#   · 明细读不到 / 解析失败一律静默返回空 —— 抢救是附加价值，不能把失败上报搞砸；
#   · 输出带明确标注，父代理与用户都不会把它误当成完整结论。
salvage_partial_result() {
  local sn="$1" limit="${2:-2000}"
  [ -n "$sn" ] && [ -n "$REPO" ] || return 0
  local pid="${sn}-001"
  # 走 cnb CLI 而不是裸 curl：与脚本其它查询一致（鉴权 / 端点由 CLI 统一处理），
  # 也避免在打桩测试里把请求打进「触发构建」的计数（实测踩过：curl 一调，
  # 桩把每次请求都当成一次 build start，升档类的构建计数断言全被污染）。
  local page=0 res n last_rid="" last_page=""
  while [ "$page" -le 12 ]; do
    res="$(cnb build get-build-ai-request --repo "$REPO" --sn "$sn" \
        --pipelineId "$pid" --page "$page" -v 2>/dev/null || true)"
    n="$(printf '%s' "$res" | jq -r '(.data.content // []) | length' 2>/dev/null || echo '')"
    case "$n" in ''|*[!0-9]*) break ;; esac
    # 翻到空页为止：最后一轮常常落在「不满一页」的那页上
    [ "$n" -gt 0 ] || break
    last_page="$res"
    page=$((page + 1))
  done
  [ -n "$last_page" ] || return 0
  # 往回找最近一条**真产出过正文**的请求（末轮可能只是工具调用，没有正文）
  last_rid="$(printf '%s' "$last_page" \
    | jq -r '[.data.content[]? | select((.completion_tokens // 0) > 0)] | .[-1].request_id // empty' 2>/dev/null)"
  [ -n "$last_rid" ] || return 0
  cnb build get-build-ai-request-detail --repo "$REPO" --sn "$sn" \
      --pipelineId "$pid" --requestId "$last_rid" -v 2>/dev/null \
    | python3 -c '
import json, re, sys

try:
    body = json.load(sys.stdin)["data"]["content"]["response_body"] or ""
except Exception:
    sys.exit(0)

# response_body 是 SSE 流：正文散在 `data: {...}` 各行的 delta.content 里。
# 直接对原始串 grep 拿不到正文（引号都被转义在 JSON 字符串里）。
parts = []
for m in re.finditer(r"^data: (\{.*\})$", body, re.M):
    try:
        o = json.loads(m.group(1))
    except Exception:
        continue
    ch = (o.get("choices") or [{}])[0]
    c = (ch.get("delta") or {}).get("content")
    if c:
        parts.append(c)
text = "".join(parts).strip()
if not text:
    sys.exit(0)
limit = int(sys.argv[1]) if len(sys.argv) > 1 else 2000
if len(text) > limit:
    text = text[:limit] + "\n…（已截断）"
sys.stdout.write(text)
' "$limit"
}

# ── 子代理进展 -> 父进度评论（用户在 Issue 里看得见） ──────────────────
# 实测缺口之四（2026-10-01 本仓）：父代理等子代理的那段时间，**Issue 评论里
# 什么都看不到** —— 进度评论停在父代理上一步，用户分不清「子代理在跑」还是
# 「整轮卡死了」。这正是用户说的「子线程和父线程之间的联系好像不是很好」：
# 父子之间只有「派出去」和「结论回来」两个瞬间，中间是黑盒。
#
# ⚠️ 记法在 2026-10-06 改过（用户直接提的）：
#   旧写法是把「仍在等待子代理 X（已 900s / 上限 2400s，状态 pending）」这条
#   **一遍遍追加**到父进度评论的「补充说明」里 —— 同一件事刷 19 条，读的人只看到
#   重复。用户的原话：「一个子代理就直接显示一个，然后后面加上它的状态，
#   不需要这样重复地搞……之前申请过子代理的，只要是这个代理里面有的，那就显示上，
#   只不过状态要显示已完成，最好把它的任务也给概括地写上」。
#   现在改成往父进度的**子代理台账** (`npc-progress.sh subagent`) 里 upsert：
#   按 sn 一行，反复写只刷新那一行；耗时由渲染现算（心跳每刷一次就往前走），
#   收口后改状态、保留在清单里。
#
# 几条边界仍是刻意的：
#   · 只在最外层（DEPTH=0）写 —— 子代理自己也有进度评论时不该去改它；
#   · 只在父代理**已经建了**进度评论时才写（状态文件存在），
#     绝不因为一次子代理派发就凭空 init 一条评论；
#   · 全程 `|| true` 静默兜底：进度是附加信息，不能因为它把派发搞挂；
#   · 非终态更新限流（默认 60s 一次）—— 心跳每轮都调，写的是同一行，
#     但没必要每轮都打一次 API；**终态一定写**，那是用户最该看到的一笔。
progress_sub() {
  # progress_sub <sn> <status> [额外参数...]  status 见 npc-progress.sh 的 VALID_SUB_STATUS
  #
  # 限流**不在这里**做，在 npc-progress.sh 的 `cmd_subagent` 里（与状态文件同源）：
  #   * 调这个函数的两处本身就有节流（cmd_wait 的心跳间隔默认 60s），
  #     这里再限一次是冗余；
  #   * 真正需要在**状态侧**判的是「这一笔是不是台账的第一次写入」——
  #     首次必须写（name / task 只在派发时传得进来，被限流吞掉的话，
  #     清单上那一行会永远缺名字和任务摘要，心跳补不回来，因为它不知道这些）。
  #     而「状态里有没有这个 sn」只有进度脚本自己看得见，所以判定放在那边。
  local sn="$1" status="$2"; shift 2
  [ "${DEPTH:-0}" = "0" ] || return 0
  [ -n "$sn" ] && [ -n "$status" ] || return 0
  local sc="${SUBAGENT_PROGRESS_SCRIPT:-.cnb/scripts/npc-progress.sh}"
  [ -f "$sc" ] || return 0
  # 状态文件不存在（父代理没建进度评论）时子命令会报「找不到进度状态」，
  # 那不是错误 —— 静默吞掉即可。
  bash "$sc" subagent --sn "$sn" --status "$status" --quiet "$@" >/dev/null 2>&1 || true
}

# 等待期读到的构建状态 → 台账状态（**只用于「还在跑」这一侧**）。
#
# ⚠️ 这里刻意**不**把 error / unknown 折成 failed：本函数服务于等待中的心跳，
# 而「读不到状态」不等于「子代理挂了」（CLI 抖动、构建从列表消失都会读不到）。
# 判死由收口处按**明确证据**做（见 reap_result / cmd_wait 末尾），口径只有一处：
# 能确定终态时才写终态，读不到就保持「运行中」，绝不因为一次抖动把清单上的
# 子代理误标成失败（那比不更新更糟 —— 用户会以为活儿丢了）。
sub_status_of_build() {
  case "$1" in
    success) printf 'done\n' ;;
    error|failed|cancel) printf 'failed\n' ;;
    *) printf 'running\n' ;;
  esac
}

# 任务摘要：台账是「一行一项」的清单，塞整段任务描述会把清单撑成一堵墙。
# 用户要的是「概括地写上」，所以取首行、压平空白、超长截断。
task_digest() {
  # 按**字符**截断（走 truncate_chars）—— bash 的 ${var:0:N} / cut -c 在
  # LANG 为空时按字节切，中文会被切成半个字（本仓在别处踩过同款）。
  printf '%s' "$1" | head -n1 | tr '\n\r\t' '   ' \
    | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//' \
    | truncate_chars "${SUBAGENT_TASK_DIGEST_CHARS:-80}"
}

cmd_run() {
  local task="" system="" name="subagent" model="$MODEL_DEFAULT"
  local thinking="$THINKING_DEFAULT" write="false" timeout="$WAIT_DEFAULT"
  local async="false" out="" max_chars="$MAX_CHARS_DEFAULT"
  local retry="$RETRY_DEFAULT" cong_wait="$CONGESTION_WAIT_DEFAULT"
  local cpus="$CPUS_DEFAULT" cpus_auto="false" escalate="" escalate_raw=""
  local thinking_auto="false"
  local rc

  while [ $# -gt 0 ]; do
    case "$1" in
      --task) task="$2"; shift 2 ;;
      --system) system="$2"; shift 2 ;;
      --name) name="$2"; shift 2 ;;
      --model) model="$2"; shift 2 ;;
      --thinking) thinking="$2"; shift 2 ;;
      --cpus) cpus="$2"; shift 2 ;;
      --escalate) escalate_raw="$2"; shift 2 ;;
      --write) write="true"; shift ;;
      --timeout) timeout="$2"; shift 2 ;;
      --out) out="$2"; shift 2 ;;
      --max-chars) max_chars="$2"; shift 2 ;;
      --async) async="true"; shift ;;
      --retry) retry="$2"; shift 2 ;;
      --congestion-wait) cong_wait="$2"; shift 2 ;;
      -h|--help) usage 0 ;;
      *) die "未知参数：$1" ;;
    esac
  done

  [ -n "$task" ] || die "run 需要 --task"

  # 规格决策：auto = 按任务信号自己估；数字 = 人工指定。
  # 注意 auto 只能同步路径生效 —— 升档重投依赖「看到结论再决定」，而 --async
  # 把构建号交出去就结束了，父代理自己收口，脚本没有插手的机会。
  case "$cpus" in
    auto|AUTO|Auto)
      cpus_auto="true"
      cpus="$(resource_signal "$task")"
      valid_cpus "$cpus" >/dev/null || cpus="$CPUS_DEFAULT"
      ;;
  esac
  cpus="$(valid_cpus "$cpus")" || die "run 的 --cpus 非法：$cpus（应为 1~64 的整数，或 auto）"

  # 思考档决策：与规格同源 —— 档位给错了两头都亏（琐碎活给 max 白烧 token，
  # 疑难活给 off 会反复跑错、反而更贵）。auto 与 --async 可以并用：档位在**派发前**
  # 就定下来了，不需要事后拿结论来判断（这点与 --escalate 不同）。
  case "$thinking" in
    auto|AUTO|Auto)
      thinking_auto="true"
      thinking="$(thinking_signal "$task")"
      ;;
  esac
  thinking="$(valid_thinking "$thinking")" || die "run 的 --thinking 非法：$thinking（可选 off/minimal/low/medium/high/xhigh/max，或 auto）"

  if [ -n "$escalate_raw" ]; then
    escalate="$(valid_cpus "$escalate_raw")" 2>/dev/null || true
    case "$escalate_raw" in
      ''|*[!0-9]*) die "run 的 --escalate 非法：$escalate_raw（应为 0~64 的整数）" ;;
    esac
    [ "$escalate_raw" -le "$CPUS_MAX_ESCALATE" ] \
      || die "run 的 --escalate=$escalate_raw 超过上限 $CPUS_MAX_ESCALATE（升档 ×2，代价是核时翻倍）"
    escalate="$escalate_raw"
  elif [ "$cpus_auto" = "true" ]; then
    escalate="$CPUS_AUTO_ESCALATE"
  else
    # 人工指定了核数就尊重人工判断：默认不擅自升档（要就显式 --escalate N）
    escalate="0"
  fi
  if [ "$async" = "true" ] && [ "$escalate" != "0" ]; then
    # --async 把构建号交出去就结束了，脚本没有机会「看到结论再决定升档」。
    # 静默忽略会让人以为开了升档 —— 显式说清楚，否则这是个看不见的能力缺口。
    printf 'subagent: 注意：--async 与 --escalate 不能并用（异步路径拿不到结论，无从判升档），已按不升档处理\n' >&2
    printf 'subagent: 需要升档请去掉 --async，或用 map（它自带队列重投）\n' >&2
    escalate="0"
  fi

  [ -n "$REPO" ] || die "无法确定仓库（缺 CNB_REPO_SLUG）"
  local next_depth=$((DEPTH + 1))
  if [ "$next_depth" -gt "$MAX_DEPTH" ]; then
    die "已达子代理嵌套上限（depth=${DEPTH}，上限 ${MAX_DEPTH}），本层请自己完成子任务"
  fi
  [ -n "$TOKEN" ] || die "无法获取 CNB_TOKEN，子代理不可用"
  need curl; need jq; need cnb

  if [ -z "$system" ]; then
    system="你是被主代理派发的子代理，独立完成子任务后只汇报结论，不寒暄、不展开无关内容。"
    if [ "$next_depth" -ge "$MAX_DEPTH" ]; then
      system="$system
你处于嵌套最深层，请亲自完成本子任务，不要再派发子代理。"
    fi
    if [ "$write" = "false" ]; then
      system="$system
你本次没有代码写权限：只做只读分析，不要尝试修改文件或推送代码。"
    fi
  fi

  # 父 -> 子 上下文注入：把「你从哪儿被派出来的」写进 system prompt。
  # 实测缺口的补法 —— 子代理容器里拿不到父 SN / Issue 编号（见上方注释），
  # 所以由父代理显式带过去。用户传了 --system 也要拼上：它是事实性注记，
  # 与「怎么干这活」不冲突。
  local ctx_note
  ctx_note="$(parent_context_note)"
  [ -n "$ctx_note" ] && system="$system

$ctx_note"

  # 分支兜底：PR / Fork 场景下 CNB_BRANCH 可能是「该 PR 的目标分支」或临时引用，
  # 直接触发会因取不到 SHA 失败（Failed to get SHA for ... event: GetCommit: not found）。
  # 候选顺序：当前分支 → 默认分支 → PR 目标分支 → PR 源分支。
  # 子流水线配置是内联下发的，走哪个分支检出的源码不影响执行。
  local try_branches=()
  local cand
  for cand in "$BRANCH" "${CNB_DEFAULT_BRANCH:-}" \
              "${CNB_PULL_REQUEST_TARGET_BRANCH:-}" \
              "${CNB_PULL_REQUEST_BRANCH:-}"; do
    [ -n "$cand" ] || continue
    for local_existing in "${try_branches[@]:-}"; do
      [ "$local_existing" = "$cand" ] && continue 2
    done
    # 注意：cnb CLI 查到 404 也返回退出码 0，必须判响应体里的 status，
    # 否则会把不存在的分支塞进候选，触发时报 Failed to get SHA。
    if [ "$(cnb git get-branch --repo "$REPO" --branch "$cand" -v 2>/dev/null \
            | jq -r '.status // empty' 2>/dev/null)" = "200" ]; then
      try_branches+=("$cand")
    fi
  done
  [ "${#try_branches[@]}" -gt 0 ] || try_branches=("$BRANCH")

  # 候选分支列表传给 start_child_checked（它要在补投时复用）
  TRY_BRANCHES=("${try_branches[@]}")

  # ── 派发 + 收口 + （必要时）升档重投 ──
  # 循环结构：一次尝试 = 触发 + 等待 + 按结果决定「收口成功 / 升档重投 / 原样返回」。
  # 升档的唯一判据是 resource_failure（OOM 证据），不把任意失败都当资源问题。
  local attempt=0 tries=0 sn="" wrc=0
  tries=$((escalate + 1))
  while :; do
    local body
    body="$(jq -n \
      --arg event "$EVENT" --arg branch "$BRANCH" --arg cfg "$(child_config)" \
      --arg name "$name" --arg task "$task" --arg system "$system" \
      --arg model "$model" --arg thinking "$thinking" --arg hardCap "$HARD_CAP_BYTES" \
      --arg cpus "$cpus" --arg title "${CHILD_TITLE_PREFIX}${name} ${PARENT_TAG_PREFIX}${PARENT_SN}" \
      --argjson next_depth "$next_depth" \
      --argjson write "$write" \
      --arg ptype "$(parent_target_type)" --arg pnum "$(parent_target_number)" \
      --arg purl "$(parent_target_url)" \
      --arg pprogress "$(parent_progress_url)" --arg parent "$PARENT_SN" \
      '{event:$event, branch:$branch, config:$cfg, title:$title,
        env:{SUBAGENT_NAME:$name, SUBAGENT_TASK:$task, SUBAGENT_SYSTEM:$system,
             SUBAGENT_MODEL:$model, SUBAGENT_THINKING:$thinking,
             # 父 -> 子 上下文（子代理容器里原本拿不到，实测确认）
             SUBAGENT_PARENT_SN:$parent,
             SUBAGENT_PARENT_TARGET_TYPE:$ptype,
             SUBAGENT_PARENT_TARGET_NUMBER:$pnum,
             SUBAGENT_PARENT_TARGET_URL:$purl,
             SUBAGENT_PARENT_PROGRESS_URL:$pprogress,
             # 覆盖内联 config 里的兜底值 -> runner.cpus，实现「按需分配规格」
             SUBAGENT_CPUS:$cpus,
             SUBAGENT_MAX_BYTES:$hardCap, SUBAGENT_DEPTH:($next_depth|tostring)},
        sync:false,
        npc:{name:"CodeBuddy", workMode:$write}}')"

    # 触发并确认准入。命中根组织并发上限时不立刻失败，先等位补投。
    rc=0
    sn="$(start_child_checked "$body" "$retry" "$cong_wait")" || rc=$?
    if [ "$rc" = "2" ]; then
      # 容量问题，不是配置错误：退出码 3 让调用方（如 map）能「放回队列稍后重试」，
      # 而不是当成真失败丢掉。判据与 wait 的退出码 2 一致，都是「可重试」。
      printf 'subagent: %s 未能开跑——并发构建数已达根组织上限（64），等位 %s 次仍无空缺\n' \
        "$name" "$retry" >&2
      printf 'subagent: 处理建议：减少同时外派的子代理数量（map 的 --concurrency），或稍后重试\n' >&2
      exit 3
    fi
    if [ "$rc" = "1" ]; then
      printf 'subagent: %s 触发子代理被拒绝（配置 / 权限类错误，重投无用，见上方报错）\n' "$name" >&2
      exit 1
    fi
    [ -n "$sn" ] || die "触发子代理被拒绝：未取得构建号"

    # 子代理已经真开跑了 → 拉起看门狗（同一父代理只派一次，幂等）。
    # 放在这里而不是函数开头：派发失败时没必要为「不存在的子代理」建一条看门狗。
    ensure_watchdog

    # 派出去了 —— 在父进度的子代理台账里记一行（用户在 Issue 里看得见）。
    # task 摘要取**首行 / 前 60 字**：台账是一行一项的清单，塞整段任务描述会把
    # 清单撑成一堵墙（用户要的是「概括地写上」）。
    progress_sub "$sn" running --name "$name" --cpus "$cpus" --thinking "$thinking" \
      --limit "$timeout" --task "$(task_digest "$task")"

    if [ "$async" = "true" ]; then
      printf '%s\n' "$sn"
      return 0
    fi

    if [ "$tries" -gt 1 ]; then
      printf 'subagent: %s 已启动（%s，%s 核，思考 %s）[第 %s/%s 次尝试]\n' \
        "$name" "$sn" "$cpus" "$thinking" "$((attempt + 1))" "$tries" >&2
    else
      printf 'subagent: %s 已启动（%s，%s 核，思考 %s）\n' "$name" "$sn" "$cpus" "$thinking" >&2
    fi

    # 等待收口。cmd_wait 走返回码（不是 exit），把退出码交回来，
    # 好在「资源不足」时决定升档重投。
    local wait_args=(--sn "$sn" --timeout "$timeout" --max-chars "$max_chars")
    [ -n "$out" ] && wait_args+=(--out "$out")
    wrc=0
    cmd_wait "${wait_args[@]}" || wrc=$?

    # 成功：照常返回
    [ "$wrc" = "0" ] && return 0

    # 还能升档吗？
    attempt=$((attempt + 1))
    if [ "$attempt" -ge "$tries" ]; then
      # 次数用完：如实返回原退出码，不再假装能救。
      # 刻意**不**在这里回收旧构建 —— 用户可能还想用 status --sn 继续查它，
      # 静默停掉等于把现场毁掉。要停得显式：subagent.sh stop --sn <构建号>。
      [ "$escalate" -gt 0 ] && printf 'subagent: %s 升档重投已用尽（共 %s 次尝试，末次 %s 核）\n' \
        "$name" "$tries" "$cpus" >&2
      if [ "$wrc" = "124" ]; then
        printf 'subagent: 注：%s 可能仍在运行（占并发额度与核时）；要停掉它：bash %s stop --sn %s\n' \
          "$sn" "${0##*/}" "$sn" >&2
      fi
      return "$wrc"
    fi

    # 是不是资源不够？—— 只有 OOM / SIGKILL 类证据才升档。
    # 并发超限（wrc=2）与规格无关，升档纯浪费；配置类错误同理。
    if [ "$wrc" = "2" ]; then
      printf 'subagent: %s 未开跑（并发超限，与规格无关），不升档\n' "$name" >&2
      return "$wrc"
    fi

    local reason=""
    if [ "$wrc" = "124" ]; then
      # 等待超时：核少 → 跑得慢是常见成因，值得加档再试一次
      reason="等待超时（核少可能拖慢）"
    elif resource_failure "$sn"; then
      reason="检测到资源不足证据（OOM / SIGKILL）"
    else
      printf 'subagent: %s 未成功（退出码 %s），且非资源问题 → 不升档（升了也没用）\n' \
        "$name" "$wrc" >&2
      return "$wrc"
    fi

    # 重投之前先回收旧子代理：留在场上的旧构建既占根组织 64 条并发额度，
    # 又按声明规格继续烧核时（核时按声明规格 × 时长扣，与容器实际占用无关）。
    # 这条路径专治「等待超时」——那时旧构建**可能还活着**（OOM 那条路径上
    # 它已被内核杀掉，stop_child 会识别成已终态直接返回，不会空操作报错）。
    stop_child "$sn" "升档重投前回收（旧档 $cpus 核）" || true

    local newcpus
    newcpus="$(next_cpus "$cpus")"
    printf 'subagent[spec]: %s：%s → 自主升档 %s → %s 核重投（第 %s 次尝试）\n' \
      "$name" "$reason" "$cpus" "$newcpus" "$((attempt + 1))" >&2
    printf 'subagent[spec]: 依据：核数买到的是并行度与内存上限（= 核数 × 2 GiB）；核时按声明规格计\n' >&2
    cpus="$newcpus"
  done
}

# 取回子代理结论并回显（按字符截断，不破坏 UTF-8）。
#   fetch_result <sn> <max_chars> [out] [name] [cpus] [thinking]
# 后三个可选：给了就把「出处」（构建 SN / 日志链接 / 规格 / 思考档）打到 stderr
# 并写进 --out 落盘文件的开头。stdout **只放结论本身** —— 调用方普遍用
# `$(...)` 取结论，往里掺出处会污染结论。
fetch_result() {
  local sn="$1" max_chars="$2" out="${3:-}" pname="${4:-}" pcpus="${5:-}" pthinking="${6:-}"
  local sid result result_file chars
  sid="$(stage_id_of "$sn" emit)"
  # 这里**不能** die/exit：本函数也被 map 在同一条 shell 里复用，
  # 一处取回失败会把整批打断，其余仍在跑的子代理被遗弃（还在占并发额度）。
  # 统一改成返回码契约：0 成功 / 1 取回失败。
  if [ -n "$out" ]; then
    if ! mkdir -p "$(dirname "$out")" 2>/dev/null; then
      printf 'subagent: 无法创建输出目录：%s\n' "$(dirname "$out")" >&2
    fi
  fi
  if [ -z "$sid" ]; then
    printf 'subagent: 子代理成功但未找到结果 Stage（emit）：%s/%s/-/build/logs/%s\n' \
      "$WEB" "$REPO" "$sn" >&2
    return 1
  fi
  result="$(extract_result "$sn" "$sid")" || return 1
  result_file="/tmp/subagent-result-$sn.txt"
  printf '%s' "$result" > "$result_file"

  # 出处：结论有了，出处也得有 —— 否则父代理汇总时引不出来源，
  # 用户也没法点进子代理看它到底干了什么（实测缺口之二）。
  local prov=""
  if [ -n "$pname" ] || [ -n "$sn" ]; then
    prov="$(child_provenance "$sn" "${pname:-subagent}" "${pcpus:-?}" "${pthinking:-?}" "")"
    printf '%s\n' "$prov" >&2
  fi
  if [ -n "$out" ] && [ -n "$prov" ]; then
    printf '%s\n\n' "$prov" > "$out"
  fi
  chars="$(count_chars "$result_file")"
  if [ -n "$out" ]; then
    if [ -n "$prov" ]; then printf '%s' "$result" >> "$out"; else printf '%s' "$result" > "$out"; fi
    printf 'subagent: 结果已写入 %s（%s 字符）\n' "$out" "$chars" >&2
  fi
  if [ "$max_chars" != "0" ] && [ "$chars" -gt "$max_chars" ]; then
    # 按字符截断，不破坏 UTF-8（bash 的 ${var:0:N} 按字节切，会把中文切坏）
    truncate_chars "$max_chars" < "$result_file"
    printf '\n[subagent: 结果较长已截断（%s/%s 字符）；需要全文请加 --out 落盘后分段读取]\n' \
      "$max_chars" "$chars"
  else
    printf '%s\n' "$result"
  fi
  rm -f "$result_file"
  return 0
}

# 收口一个**已到终态**的子代理：确认成功则取回结论，失败则区分「并发超限」与真失败。
# 供 map 复用（map 的调度循环已经拿到终态，不必再走 cmd_wait 的二次确认等待）。
# 返回 0 = 成功（结论写 stdout）；2 = 并发超限未开跑；1 = 真失败
reap_result() {
  local sn="$1" max_chars="$2" out="${3:-}" pname="${4:-}" pcpus="${5:-}" pthinking="${6:-}"
  local status emsg
  status="$(build_status "$sn")"
  if [ "$status" = "success" ]; then
    # 台账收口：map 走的是这条路径（不经过 cmd_wait），不收在这里的话
    # 清单上那些子代理会永远停在「运行中」—— 用户要的「之前派过的显示已完成」就落空。
    if fetch_result "$sn" "$max_chars" "$out" "$pname" "$pcpus" "$pthinking"; then
      progress_sub "$sn" done
      return 0
    fi
    progress_sub "$sn" failed
    return 1
  fi
  emsg="$(build_errmsg "$sn")"
  if is_congestion_msg "$emsg"; then
    progress_sub "$sn" congested
    return 2
  fi
  printf 'subagent: 子代理未成功（status=%s）：%s/%s/-/build/logs/%s\n' \
    "$status" "$WEB" "$REPO" "$sn" >&2
  dump_failure "$sn" >&2
  progress_sub "$sn" failed
  report_partial "$sn" "$out"
  return 1
}

cmd_wait() {
  local sn="" timeout="$WAIT_DEFAULT" out="" max_chars="$MAX_CHARS_DEFAULT"
  while [ $# -gt 0 ]; do
    case "$1" in
      --sn) sn="$2"; shift 2 ;;
      --timeout) timeout="$2"; shift 2 ;;
      --out) out="$2"; shift 2 ;;
      --max-chars) max_chars="$2"; shift 2 ;;
      *) die "未知参数：$1" ;;
    esac
  done
  [ -n "$sn" ] || die "wait 需要 --sn"
  need jq; need cnb; need python3; need base64
  timeout="$(as_pos_int "$timeout" "$WAIT_DEFAULT" "--timeout")"

  local waited=0 status terminal="" polls=0
  # 等待期**必须周期性地往 stdout 说话**，两个原因：
  #   1. 父代理的工具执行有「无输出超时」（npc:go 已抬到 30m，但仍存在）——
  #      静默等子代理正是最典型的长时间无输出场景，本仓实测有过
  #      「一次 map 调用在 10 分 0 秒被强制关闭」；
  #   2. 父代理会话与构建日志里，用户在等待期间看不到任何东西，
  #      分不清「子代理在跑」和「父代理卡死了」。
  # 每 HEARTBEAT_INTERVAL 秒打一行进度（含已等时长 / 轮询次数）。
  local hb_at=0
  # 首次轮询前稍等，给构建注册留出时间
  printf 'subagent: 等待 %s 完成（最多 %ss，每 %ss 轮询一次）\n' "$sn" "$timeout" "$POLL_INTERVAL"
  sleep "$POLL_INTERVAL"
  waited=$POLL_INTERVAL
  while :; do
    status="$(build_status "$sn")"
    polls=$((polls + 1))
    # 终态需连续两次读到一致结果，规避接口瞬时抖动导致的误判
    case "$status" in
      success|error|cancel|failed)
        if [ "$terminal" = "$status" ]; then break; fi
        terminal="$status"
        ;;
      *) terminal="" ;;
    esac
    # ⚠️ 超时判定必须等**至少两次真实轮询**之后才生效。
    # 「终态要连续两次读到一致才算数」是本函数的有意设计，所以一次状态读取
    # 本身判不出终态；若在 poll 之前就按 `waited >= timeout` 提前返回 124，
    # 那么 `--timeout <= POLL_INTERVAL`（或刚过一轮）时，明明已经 success 的
    # 构建也会被判成「仍在运行」—— 而 run 会据此**升档重投**，
    # 于是白建一条子构建、烧双份核时（实测复现：--timeout 10 返回 124，
    # --timeout 11 才返回 0，而子代理根本没有超时）。
    if [ "$polls" -ge 2 ] && [ "$waited" -ge "$timeout" ]; then
      printf 'subagent: 等待超时（%ss），子代理仍在运行：%s/%s/-/build/logs/%s\n' \
        "$timeout" "$WEB" "$REPO" "$sn" >&2
      # 台账里标「等待超时（仍在跑）」—— 不是 failed：它还在烧核时、没挂，
      # 用户看到「失败」会以为活儿丢了（要停就 stop --sn，那是 stopped）。
      progress_sub "$sn" timeout
      # 超时意味着子代理**还活着**（不是失败），它的部分产出同样值得抢救
      report_partial "$sn" "$out"
      # 走返回码：run 的升档重投要靠这个码做决定
      return 124
    fi
    sleep "$POLL_INTERVAL"
    waited=$((waited + POLL_INTERVAL))
    # 周期性心跳：让父代理的日志/会话看得出「还在等」，不会被无输出超时掐掉
    if [ "$(( waited - hb_at ))" -ge "$HEARTBEAT_INTERVAL" ]; then
      hb_at=$waited
      printf 'subagent: 仍在等待 %s（已 %ss / 上限 %ss，第 %s 次轮询，当前状态 %s）\n' \
        "$sn" "$waited" "$timeout" "$polls" "${status:-未知}"
      # 同一时刻也刷新父进度评论里这个子代理**那一行**（内部限流，不新增行）。
      # 耗时不在文案里 —— 渲染时按「现在 - 开始时间」现算，所以刷新一次就走一格。
      progress_sub "$sn" "$(sub_status_of_build "${status:-}")" --limit "$timeout"
    fi
  done

  if [ "$status" != "success" ]; then
    local emsg
    emsg="$(build_errmsg "$sn")"
    if is_congestion_msg "$emsg"; then
      # 与「真失败」区分开：这是可重试的容量问题，退出码 2
      printf 'subagent: 子代理未能开跑——并发构建数已达根组织上限（64），%s/%s/-/build/logs/%s\n' \
        "$WEB" "$REPO" "$sn" >&2
      printf 'subagent: 建议减少同时外派的子代理数量，稍后重试（退出码 2 表示可重试）\n' >&2
      progress_sub "$sn" congested
      return 2
    fi
    printf 'subagent: 子代理未成功（status=%s）：%s/%s/-/build/logs/%s\n' \
      "$status" "$WEB" "$REPO" "$sn" >&2
    dump_failure "$sn"
    progress_sub "$sn" failed
    report_partial "$sn" "$out"
    return 1
  fi

  fetch_result "$sn" "$max_chars" "$out" || {
    # 构建是 success 但结论取回失败：台账别谎报「已完成」——它确实跑完了，
    # 但这一路的产出没拿到，标 failed 更贴近用户关心的事（这一项没有可用结论）。
    progress_sub "$sn" failed
    return 1
  }
  progress_sub "$sn" done
  return 0
}

# 失败 / 超时路径上把子代理「已经产出的正文」抢救出来（见 salvage_partial_result）。
# 写 stdout 与 --out 落盘文件，带上醒目标注 —— 让父代理与用户都不会误当完整结论。
report_partial() {
  local sn="$1" out="${2:-}" partial
  partial="$(salvage_partial_result "$sn" 2000)"
  [ -n "$partial" ] || return 0
  printf '\n[subagent: 子代理未跑完，以下是它中止前已产出的部分内容（不完整，仅供抢救参考）]\n' >&2
  printf '%s\n' "$partial" >&2
  if [ -n "$out" ]; then
    {
      printf '# ⚠️ 子代理未跑完（部分结论）\n\n构建：%s/%s/-/build/logs/%s\n\n' "$WEB" "$REPO" "$sn"
      printf '以下内容由父代理从该子代理的 AI 请求明细里抢救得到，**不代表完整结论**：\n\n'
      printf '%s\n' "$partial"
    } >> "$out"
  fi
  return 0
}

# 批量外派：从任务清单读取 N 个子任务，用并发闸门持续推进。
#
# 清单格式（每行一个子任务，空行与 # 开头的注释行忽略）：
#   子任务描述
#   子任务名<TAB>子任务描述          ← 需要自定义名字（也是落盘文件名）时用这种行
#
# 与「for 循环里连续 run --async，最后统一 wait」相比，map 的价值：
#   * 并发闸门：同时最多 --concurrency 个在场（默认 8），不去撞根组织 64 条上限；
#   * 流水推进：谁先结束就补投下一个，不必等满一批；
#   * 超限自愈：撞上 64 上限的任务放回队列稍后重投，不丢；重投上限 --retry 轮；
#   * 统一收口：逐个取回结论落盘，最后按清单顺序打印汇总。
cmd_map() {
  local file="" concurrency="$MAP_CONCURRENCY_DEFAULT" thinking="$THINKING_DEFAULT"
  local model="$MODEL_DEFAULT" system="" write="" timeout="$WAIT_DEFAULT"
  local out_dir="" max_chars="$MAX_CHARS_DEFAULT" name_prefix="子任务"
  local retry="$RETRY_DEFAULT" cong_wait="$CONGESTION_WAIT_DEFAULT"
  local cpus="$CPUS_DEFAULT"

  while [ $# -gt 0 ]; do
    case "$1" in
      --file) file="$2"; shift 2 ;;
      --concurrency) concurrency="$2"; shift 2 ;;
      --thinking) thinking="$2"; shift 2 ;;
      --model) model="$2"; shift 2 ;;
      --system) system="$2"; shift 2 ;;
      --cpus) cpus="$2"; shift 2 ;;
      --write) write="--write"; shift ;;
      --timeout) timeout="$2"; shift 2 ;;
      --out-dir) out_dir="$2"; shift 2 ;;
      --max-chars) max_chars="$2"; shift 2 ;;
      --name-prefix) name_prefix="$2"; shift 2 ;;
      --retry) retry="$2"; shift 2 ;;
      --congestion-wait) cong_wait="$2"; shift 2 ;;
      -h|--help) usage 0 ;;
      *) die "未知参数：$1" ;;
    esac
  done

  [ -n "$file" ] || die "map 需要 --file（任务清单）"
  [ -f "$file" ] || die "任务清单不存在：$file"
  [ -n "$REPO" ] || die "无法确定仓库（缺 CNB_REPO_SLUG）"
  [ -n "$TOKEN" ] || die "无法获取 CNB_TOKEN，子代理不可用"
  case "$concurrency" in ''|*[!0-9]*) die "--concurrency 需为正整数：$concurrency" ;; esac
  [ "$concurrency" -ge 1 ] || die "--concurrency 至少为 1"
  # --cpus auto：交给每个子任务各自判（map 里的任务常常轻重不一，
  # 「读代码」和「跑压测」混在一张清单上，统一核数必然有一头不合适）。
  # 判据由 cmd_run 的 resource_signal 逐条给出，日志里能看到每条的决策依据。
  case "$cpus" in
    auto|AUTO|Auto) ;;   # 原样透传给 cmd_run
    *) cpus="$(valid_cpus "$cpus")" || die "map 的 --cpus 非法：$cpus（应为 1~64 的整数，或 auto）" ;;
  esac
  # --thinking auto：同样交给每个子任务各自判。一张清单里「改文案」和「根因排查」
  # 的认知难度可能差三个档，统一档位必然有一头不合适（给高了白烧 token，给低了反复跑错）。
  case "$thinking" in
    auto|AUTO|Auto) ;;   # 原样透传给 cmd_run
    *) thinking="$(valid_thinking "$thinking")" \
         || die "map 的 --thinking 非法：$thinking（可选 off/minimal/low/medium/high/xhigh/max，或 auto）" ;;
  esac

  local next_depth=$((DEPTH + 1))
  if [ "$next_depth" -gt "$MAX_DEPTH" ]; then
    die "已达子代理嵌套上限（depth=${DEPTH}，上限 ${MAX_DEPTH}），本层请自己完成子任务"
  fi

  if [ -z "$system" ]; then
    system="你是被主代理派发的子代理，独立完成子任务后只汇报结论，不寒暄、不展开无关内容。"
    if [ "$next_depth" -ge "$MAX_DEPTH" ]; then
      system="$system
你处于嵌套最深层，请亲自完成本子任务，不要再派发子代理。"
    fi
    if [ -z "$write" ]; then
      system="$system
你本次没有代码写权限：只做只读分析，不要尝试修改文件或推送代码。"
    fi
  fi

  # 读清单：名字<TAB>描述，或整行当描述
  local names=() tasks=() line nm tk n=0 lineno=0 raw_line=""
  while IFS= read -r line || [ -n "$line" ]; do
    lineno=$((lineno + 1))
    raw_line="$line"   # 缩进判定要用**原始行**（下面的 else 分支会把 line 剥掉空白）
    # 纯空白行先跳过（`*[![:space:]]*` 不匹配即整行只有空白）
    case "$line" in ''|*[![:space:]]*) ;; *) continue ;; esac

    # ⚠️ 顺序很关键：**先按原始行切 Tab，再 trim 各段**。
    # 反过来先 trim 整行，行尾的 Tab 会被吃掉，`名字<TAB>`（描述为空）
    # 就退化成「只有名字」的一行 —— 既不是注释也不是空行，
    # 会被当成一条没有名字的任务派发出去（多烧一个子代理）。
    if printf '%s' "$line" | grep -q "$(printf '\t')"; then
      nm="$(printf '%s' "$line" | cut -f1)"
      tk="$(printf '%s' "$line" | sed -E 's/^[^\t]*\t//')"
      nm="$(printf '%s' "$nm" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
      tk="$(printf '%s' "$tk" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
      # 行首空白也要能识别注释（旧版只认行首 #，`   # 注释` 被当成任务派发）
      case "$nm" in '#'*) continue ;; esac
    else
      line="$(printf '%s' "$line" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
      case "$line" in ''|'#'*) continue ;; esac
      nm=""
      tk="$line"
    fi

    if [ -z "$tk" ]; then
      printf 'subagent[map]: 清单第 %s 行只有名字、没有任务描述，已跳过：%s\n' "$lineno" "$nm" >&2
      continue
    fi
    # ⚠️ 无 Tab 的行带**行首缩进**时，是「上一条任务的续行」的概率远大于
    # 「一条新的无名任务」—— 多行任务体误写成缩进续行最典型。一旦按新任务派发，
    # 后半段会被丢给一个新子代理（结论错位、白烧一条子流水线），而且全程 rc=0、
    # 用户看不到任何异常。所以显式叫停，让人把多行描述写成一行或改名分行。
    case "$raw_line" in
      [[:space:]]*)
        die "清单第 $lineno 行以空白开头（无 Tab）：看起来是上一条任务的**续行**，
       但本脚本一条任务只能是**一行**。多行描述请合并成一行（空格分隔），
       或用「名字<TAB>描述」显式另起一条。当前行：$(printf '%s' "$line" | head -c 60)" ;;
    esac
    n=$((n + 1))
    [ -n "$nm" ] || nm="${name_prefix}-${n}"
    names+=("$nm")
    tasks+=("$tk")
  done < "$file"

  local total="${#tasks[@]}"
  [ "$total" -gt 0 ] || die "任务清单里没有可执行条目：$file"
  [ -n "$out_dir" ] && mkdir -p "$out_dir"
  local log_dir="/tmp/subagent-map-$$"
  mkdir -p "$log_dir"
  # 临时目录收尾清理：不清会一直堆在 /tmp，PID 复用时还可能脏读到上一轮的 .res/.sn。
  # 注意：trap 在函数返回后才执行，那时 `local log_dir` 已失效（set -u 下报
  # "log_dir: unbound variable"），所以这里另用全局变量承载路径。
  MAP_LOG_DIR="$log_dir"
  trap 'rm -rf "$MAP_LOG_DIR"' EXIT

  # 清单里的名字会直接做落盘文件名。含 `/`（如「前端/审查」）会让 cp 因父目录
  # 不存在而失败（旧版被 `|| true` 吞掉，汇总只说「完成」、文件其实没落盘）；
  # 含 `..` 或绝对路径更糟——会写到目标目录之外。这里统一净化。
  sanitize_name() {
    printf '%s' "$1" | tr '/\\' '__' | sed -E 's/^\.+//; s/[[:space:]]+/_/g'
  }

  # 队列状态：
  #   pending —— 待派发序号（含因并发超限被放回队列的），用数组存，别用字符串：
  #              字符串队列靠 cut 弹首元素时，「首元素前有空格」会让 cut -f2- 把
  #              首元素一起留下，导致同一序号被重复派发。
  #   live    —— 在场序号（已派出、未收口），同样用数组
  #   rounds  —— 某序号被「放回队列」的累计次数，防死循环
  local -a pending=() live=()
  local rounds_file="$log_dir/rounds"
  : > "$rounds_file"
  local i
  for ((i = 1; i <= total; i++)); do pending+=("$i"); done

  local ok_n=0 fail_n=0 cong_n=0 expire_n=0
  local max_rounds="$retry"
  retry="$(as_pos_int "$retry" "$RETRY_DEFAULT" "--retry")"
  cong_wait="$(as_pos_int "$cong_wait" "$CONGESTION_WAIT_DEFAULT" "--congestion-wait")"
  timeout="$(as_pos_int "$timeout" "$WAIT_DEFAULT" "--timeout")"
  max_rounds="$(as_pos_int "$retry" "$RETRY_DEFAULT" "--retry")"

  # map 自己的总时长上限。旧版把 --timeout 透传给 cmd_run，而 map 走的是
  # `--async` 分支 —— 那条路径根本不使用 timeout；收口循环也不引用它。
  # 结果：子构建状态一旦读不到（unknown → 折成 pending），map 永不退出，
  # 只能等 2h 流水线上限把整条流水线掐掉。这里补上 deadline。
  local start_ts now_ts
  start_ts="$(date +%s)"
  # 某序号连续读到几次 unknown 就按失败收口（默认 6 次 ≈ 1 分钟 @10s 轮询）
  local unknown_max="${SUBAGENT_MAP_UNKNOWN_MAX:-6}"
  unknown_max="$(as_pos_int "$unknown_max" 6 "SUBAGENT_MAP_UNKNOWN_MAX")"
  local -a unknown_cnt=()
  local k0
  for ((k0 = 0; k0 < total; k0++)); do unknown_cnt+=("0"); done
  local map_expired=0

  # 某序号被「放回队列」的累计次数。用 wc -l 计数：grep -c 命中 0 次时
  # 退出码为 1，若写成 `grep -c ... || printf 0` 会输出两个 0。
  round_of() { grep -c "^$1$" "$rounds_file" 2>/dev/null | head -n1; }

  # deadline 必须在**派发循环里**也能终止。
  # 旧版只在收口循环判 `now - start >= timeout`，而派发阶段每一轮都有若干次
  # 网络调用（触发 + 准入确认）加一次 `sleep cong_wait`，全量拥塞时这串开销
  # 可以远超 timeout：实测 `map --timeout 3 --retry 20 --congestion-wait 2`
  # 墙钟跑了 30s 才被外层 timeout 杀掉，日志里「已达总时长上限」一次都没出现。
  map_deadline_reached() {
    local now; now="$(date +%s)"
    [ "$(( now - start_ts ))" -ge "$timeout" ]
  }
  # 收口时把仍在跑的项按「等待超时」结账（退出码 124 的语义），
  # 供给「派发阶段就先到点」与「收口循环里到点」两条路径共用。
  map_expire_live() {
    local idx3 name3 sn3
    for idx3 in ${live[@]+"${live[@]}"}; do
      name3="${names[$((idx3 - 1))]}"
      sn3="$(cat "$log_dir/$idx3.sn" 2>/dev/null)"
      printf '（等待超时，子代理仍在运行：%s/%s/-/build/logs/%s）\n' \
        "$WEB" "$REPO" "$sn3" > "$log_dir/$idx3.res"
      progress_sub "$sn3" timeout
      expire_n=$((expire_n + 1))
    done
    live=()
    map_expired=1
  }

  while [ "${#pending[@]}" -gt 0 ] || [ "${#live[@]}" -gt 0 ]; do
    # 0) 到点就走：派发阶段同样受 deadline 约束
    if map_deadline_reached; then
      printf 'subagent[map]: 已达总时长上限（%ss），仍有 %s 个子代理在跑，停止等待\n' \
        "$timeout" "${#live[@]}" >&2
      map_expire_live
      break
    fi
    # 1) 补位派发
    while [ "${#live[@]}" -lt "$concurrency" ] && [ "${#pending[@]}" -gt 0 ]; do
      # 每一轮补位前再判一次：派发本身可能就很慢（拥塞时每次都要等位）
      if map_deadline_reached; then
        printf 'subagent[map]: 已达总时长上限（%ss，派发阶段），停止补位\n' "$timeout" >&2
        break
      fi
      local idx="${pending[0]}"
      pending=(${pending[@]:1})
      local name="${names[$((idx - 1))]}"
      local sn="" rc2=0
      # 这里 --retry 0：派发阶段撞上限就立刻退 3，由 map 自己的队列重投
      # （map 已有 rounds 计数与 --congestion-wait 节奏，不必在派发里干等）
      sn="$(cmd_run --task "${tasks[$((idx - 1))]}" --name "$name" --system "$system" \
              --model "$model" --thinking "$thinking" --cpus "$cpus" --timeout "$timeout" \
              --async --retry 0 --congestion-wait "$cong_wait" \
              $write 2>"$log_dir/$idx.snlog")" || rc2=$?
      if [ "$rc2" = "0" ] && [ -n "$sn" ]; then
        printf '%s\n' "$sn" > "$log_dir/$idx.sn"
        live+=("$idx")
        printf 'subagent[map]: 派出 %s（%s，%s 核）[在场 %s]\n' \
          "$name" "$sn" "$cpus" "${#live[@]}" >&2
        [ "$cpus" = "auto" ] && printf 'subagent[map]: %s 的规格由 auto 逐条判定（依据见上方 spec 行）\n' \
          "$name" >&2
        [ "$thinking" = "auto" ] && printf 'subagent[map]: %s 的思考档由 auto 逐条判定（依据见上方 think 行）\n' \
          "$name" >&2
        continue
      fi
      if [ "$rc2" = "3" ]; then
        # 并发超限（容量问题）→ 放回队列，累计重投次数
        local r; r="$(round_of "$idx")"
        if [ "$r" -lt "$max_rounds" ]; then
          printf '%s\n' "$idx" >> "$rounds_file"
          pending+=("$idx")
          printf 'subagent[map]: %s 撞上并发上限，放回队列（第 %s/%s 次）\n' \
            "$name" "$((r + 1))" "$max_rounds" >&2
          # 等位时长不该超过剩余预算：否则「已到点」要等睡完这一觉才被看见
          local _rem; _rem=$(( timeout - ( $(date +%s) - start_ts ) ))
          [ "$_rem" -gt 0 ] && [ "$_rem" -lt "$cong_wait" ] && sleep "$_rem" || sleep "$cong_wait"
        else
          cong_n=$((cong_n + 1))
          printf '（并发超限，重投 %s 次仍未开跑）\n' "$max_rounds" > "$log_dir/$idx.res"
          printf 'subagent[map]: %s 并发超限，重投 %s 次仍未开跑\n' "$name" "$max_rounds" >&2
        fi
        continue
      fi
      # 其它错误：真失败，记录原因
      printf 'subagent[map]: %s 触发失败，跳过\n' "$name" >&2
      tail -n2 "$log_dir/$idx.snlog" >&2
      printf '（触发失败：%s）\n' "$(tail -n1 "$log_dir/$idx.snlog")" > "$log_dir/$idx.res"
      fail_n=$((fail_n + 1))
    done

    [ "${#live[@]}" -gt 0 ] || continue

    # 2) 收口已到终态者
    sleep "$POLL_INTERVAL"
    now_ts="$(date +%s)"
    if [ $((now_ts - start_ts)) -ge "$timeout" ]; then
      # 总时长用尽：把仍在跑的项按「等待超时」收口（退出码 124 的语义），
      # 而不是无限等下去。已完成的结论照常汇总。
      printf 'subagent[map]: 已达总时长上限（%ss），仍有 %s 个子代理在跑，停止等待\n' \
        "$timeout" "${#live[@]}" >&2
      map_expire_live
      break
    fi
    local -a still=()
    local idx2 sn2 name2 rc3 st2
    for idx2 in ${live[@]+"${live[@]}"}; do
      sn2="$(cat "$log_dir/$idx2.sn" 2>/dev/null)"
      name2="${names[$((idx2 - 1))]}"
      st2="$(build_status "$sn2")"
      if [ "$st2" = "unknown" ]; then
        # 查询失败 / 未知状态：连续多次仍读不到就按失败收口，
        # 否则（构建被外部取消、CLI 403、平台新增终态名）会挂死在这里。
        unknown_cnt[$((idx2 - 1))]=$(( ${unknown_cnt[$((idx2 - 1))]} + 1 ))
        if [ "${unknown_cnt[$((idx2 - 1))]}" -lt "$unknown_max" ]; then
          still+=("$idx2"); continue
        fi
        printf 'subagent[map]: %s 状态连续 %s 次读不到（%s），按失败收口\n' \
          "$name2" "$unknown_max" "$sn2" >&2
        printf '（状态读取失败：%s，请用 status --sn %s 复核）\n' "$st2" "$sn2" > "$log_dir/$idx2.res"
        progress_sub "$sn2" failed
        fail_n=$((fail_n + 1))
        continue
      fi
      case "$st2" in
        success|error|cancel|failed) ;;
        *) still+=("$idx2"); continue ;;
      esac
      rc3=0
      # 落盘用**不截断**的取回（0 = 不截断），截断只在回显给父代理时做。
      # 旧版把 $max_chars 传进来，于是 `map --out-dir` 落盘的也是被截断的回显：
      # 实测 20000 字符的结论落盘只有 12108 字节（默认 --max-chars 12000），
      # 而 SKILL 承诺「--max-chars 只管回显、落盘是全文」—— 少掉的部分无从补救。
      # 出处（构建 SN / 日志链接 / 规格）随结论一起落盘，落盘内容自解释。
      reap_result "$sn2" 0 "$log_dir/$idx2.prov" "$name2" "$cpus" "$thinking" \
        >"$log_dir/$idx2.res" 2>"$log_dir/$idx2.err" || rc3=$?
      # reap_result 的 --out 出处头要并到结论前面（它是单独文件，避免污染 res）
      if [ -s "$log_dir/$idx2.prov" ] && [ -s "$log_dir/$idx2.res" ]; then
        { printf '%s\n' "$(cat "$log_dir/$idx2.prov")"; cat "$log_dir/$idx2.res"; } \
          > "$log_dir/$idx2.both" && mv "$log_dir/$idx2.both" "$log_dir/$idx2.res"
      fi
      if [ "$rc3" = "0" ]; then
        if [ -n "$out_dir" ]; then
          if ! cp "$log_dir/$idx2.res" "$out_dir/$(sanitize_name "$name2").md" 2>/dev/null; then
            printf 'subagent[map]: 结论落盘失败（%s）：%s\n' "$name2" "$out_dir" >&2
          fi
        fi
        ok_n=$((ok_n + 1))
        printf 'subagent[map]: %s 完成\n' "$name2" >&2
      elif [ "$rc3" = "2" ]; then
        # 收口时才发现是并发超限 → 同样放回队列重投，而不是当失败丢掉
        local r2; r2="$(round_of "$idx2")"
        if [ "$r2" -lt "$max_rounds" ]; then
          printf '%s\n' "$idx2" >> "$rounds_file"
          rm -f "$log_dir/$idx2.res" "$log_dir/$idx2.sn"
          pending+=("$idx2")
          printf 'subagent[map]: %s 收口时判定并发超限，放回队列（第 %s/%s 次）\n' \
            "$name2" "$((r2 + 1))" "$max_rounds" >&2
          sleep "$cong_wait"
        else
          cong_n=$((cong_n + 1))
          printf '（并发超限，重投 %s 次仍未开跑）\n' "$max_rounds" > "$log_dir/$idx2.res"
          printf 'subagent[map]: %s 并发超限，重投 %s 次仍未开跑\n' "$name2" "$max_rounds" >&2
        fi
      else
        fail_n=$((fail_n + 1))
        printf 'subagent[map]: %s 失败\n' "$name2" >&2
        [ -n "$out_dir" ] && printf '%s\n' "$(tail -n3 "$log_dir/$idx2.err")" \
          > "$out_dir/$(sanitize_name "$name2").error.txt"
      fi
    done
    live=(${still[@]+"${still[@]}"})
  done

  printf '\nsubagent[map]: 共 %s 个子任务｜成功 %s｜失败 %s｜并发超限未开跑 %s｜等待超时 %s\n' \
    "$total" "$ok_n" "$fail_n" "$cong_n" "$expire_n" >&2
  [ -n "$out_dir" ] && printf 'subagent[map]: 结论已落盘 → %s\n' "$out_dir" >&2

  printf '\n========== 子代理结论汇总 ==========\n'
  local k
  for ((k = 1; k <= total; k++)); do
    printf '\n### %s\n' "${names[$((k - 1))]}"
    if [ -s "$log_dir/$k.res" ]; then
      cat "$log_dir/$k.res"
    elif [ -s "$log_dir/$k.err" ]; then
      printf '（未取得结论：%s）\n' "$(tail -n1 "$log_dir/$k.err")"
    else
      printf '（未取得结论）\n'
    fi
  done

  # 退出码语义与单条 run/wait 对齐：
  #   0 = 全部成功
  #   1 = 有真失败（优先暴露，便于定位）
  #   2 = 有任务因容量（根组织 64 条）未能开跑 —— 可重试，不是失败
  #   124 = 到达总时长上限，仍有子代理在跑（结论已汇总，可稍后用 status 复核）
  # 旧版把「纯容量不足」也返回 1，调用方会误当失败把任务丢掉。
  #
  # ⚠️ 优先级：**124 先于 1/2**。超时那条路上的子代理**还在跑**（没失败、
  # 没超限），返回 1 会让调用方以为「任务跑挂了」，实际它还在烧核时、只是没等完
  # —— 区分开才知道该用 `status --sn` 去复核，还是该重投。
  # （实测复现：1 个触发真失败 + 1 个等待超时 → 统计行两个数都对，退出码却是 1。）
  [ "$map_expired" = "0" ] || return 124
  [ "$fail_n" = "0" ] || return 1
  [ "$cong_n" = "0" ] || return 2
  return 0
}

cmd_status() {
  local sn=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --sn) sn="$2"; shift 2 ;;
      *) die "未知参数：$1" ;;
    esac
  done
  [ -n "$sn" ] || die "status 需要 --sn"
  build_status "$sn"
}

# 读出**当前容器**的规格，并把「这意味着什么」讲清楚 —— 供 agent 做决策：
# 这个活是我的容器能干（省一条子流水线），还是必须外派（--cpus auto）？
#
# 为什么要有这条命令：主流水线的规格**启动即固化**，运行中改不了（平台不支持运行时改，
# 已实测：OpenAPI 无改配接口、grammar.md 的 Stage / Job 配置项表里都没有 runner/cpus）。
# 而本仓把主容器定位成 **4 核 8G 的主力**（四角色一致），所以对主代理而言
# 「自主决策」的判据是 ——
#   这活我自己干划算，还是外派划算？外派要付「起流水线 + 等 + 取回」的固定开销，
#   所以小活自己干、吃配置或值得并行的才外派（子代理的规格可选，见 --cpus auto）。
# 不告诉它自己几核几 G，这个判断就只能靠猜。
#
# 表里的数字来自本仓实测（2026-09-25，cnbcool/default-npc 镜像）：
#   * 内存上限 = cpus × 2 GiB（平台规则，实测 cpus=2 → 4294967296 字节）
#   * 纯等模型返回：峰值 CPU 占用 0.037 核 —— 规格与速度无关，省下的全是核时
#   * chromium 打开 7.2 MB / 2 万节点的页面：峰值 RSS ≈ 1.5 GiB（8 GiB 装得下）
#   * 16 路 sha256：2 核 0.20s / 4 核 0.14s / 8 核 0.06s
#   * 单线程段：2 / 4 / 8 核**都是 0.01s** —— 加核不加快单线程
cmd_spec() {
  local cpus mem_bytes mem_gib nproc_v
  cpus="$(nproc 2>/dev/null || echo '?')"
  nproc_v="$cpus"
  mem_bytes="$(cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null             || cat /sys/fs/cgroup/memory.max 2>/dev/null || echo '')"
  if [ -n "$mem_bytes" ] && [ "$mem_bytes" != "max" ] 2>/dev/null; then
    mem_gib="$(python3 -c "print(f'{$mem_bytes/2**30:.1f}')" 2>/dev/null || echo '?')"
  else
    mem_gib="$(awk '/MemTotal/{printf "%.1f", $2/1048576}' /proc/meminfo 2>/dev/null || echo '?')"
  fi

  # 注意：这份文本是给人看的，变量**必须**展开 —— 但 heredoc 要加引号。
  # 未加引号的 <<SPEC 会被 .cnb/scripts/check-npc-config.py 判定成「内联子流水线配置」
  # 并拦下（那道门禁是对的：subagent.sh 里确实有 <<YAML 是内联配置下发的，
  # 两者语法同形，无法区分）。加引号后用 __占位符__ + sed 注入，安全且能过门禁。
  cat <<'SPEC' | sed -e "s|__CPUS__|${nproc_v}|g" -e "s|__MEM__|${mem_gib}|g"
当前容器规格：__CPUS__ 核 / __MEM__ GiB
（平台规则：内存 = 核数 × 2 GiB；规格在流水线启动时按角色固化，运行中改不了）

这意味着什么（本仓实测 2026-09-25）：
  · 本仓把主容器定位成「主力」：简单的活自己直接干，吃配置 / 要并行的才外派
  · 等模型返回（读代码 / 查文档 / 写摘要）→ 峰值占用约 0.04 核，规格只影响记账不影响速度
  · 核数**不影响能跑多久**：1/2/4/8 核探针实测下发的运行时长上限完全相同
  · ffmpeg 压大图 → 288MB PNG 峰值 RSS ≈ 854 MiB（本地从容）
  · chromium 打开 7.2 MB / 2 万节点页面 → 峰值 RSS ≈ 1.5 GiB（装得下，但外派更划算）
  · 16 路并行哈希 → 2 核 0.20s / 4 核 0.14s / 8 核 0.06s（加核只加快并行段）
  · 单线程任务 → 2 / 4 / 8 核都是 0.01s（加核没用）

决策建议：
  本地直接干（4 核 8G 够用，省掉一条子流水线的固定开销）：
    读文件、grep、读写 Issue/PR 评论、跑几个 curl、单进程小脚本、
    改几处代码、发评论
  外派子代理（规格与思考档都可自选）：
    bash .cnb/scripts/subagent.sh run --cpus auto --thinking auto --task "…"
    bash .cnb/scripts/subagent.sh stop --sn <构建号>     # 确认不等了就回收，别白占额度
  —— 编译 / 跑测试 / 压测 / 浏览器自动化 / 大批量转换这类**吃 CPU 或吃内存**的活，
     或者**多个互不依赖的子任务**（用 map 并行）：
     子代理的规格可以按需给，而且它跑在独立流水线里，
     还顺带把耗时从主流水线的时长预算里挪了出去。
SPEC
}

cmd="${1:-}"
[ $# -gt 0 ] && shift
case "$cmd" in
  run) cmd_run "$@" ;;
  map) cmd_map "$@" ;;
  # cmd_wait 走返回码（见上方注释），这里必须显式把它透出为脚本退出码：
  # 不加 `exit $?` 的话，case 里最后一条命令的返回码虽然一般会传递，
  # 但一旦以后有人在 case 后面加任何语句，收口失败就会被静默吞掉。
  wait) cmd_wait "$@"; exit $? ;;
  status) cmd_status "$@" ;;
  stop) cmd_stop "$@" ;;
  spec) cmd_spec "$@" ;;
  -h|--help|help|"") usage 0 ;;
  *) die "未知子命令：$cmd（可用：run / map / wait / status / stop / spec）" ;;
esac
