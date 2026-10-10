#!/usr/bin/env bash
# 运行时长预算自查：把「这条流水线有多少时长、已经吃掉多少」算给 agent 看。
#
# 为什么需要（真机证据，2026-09-26，Issue #33）：
#   上一轮把「上限」从所有会注入 agent 上下文的文档里删掉了（用户要求「先不告诉它」），
#   结果不是它不撞墙，而是它**靠猜**排预算 —— 日志里 10 处「上限是多少？大概 2h 吧」
#   的推理，最后死在 121 分钟：零余量。而 CNB_PIPELINE_MAX_RUN_TIME 本就是平台注入的
#   环境变量，一条 env 就能看到 —— 保密既没保住，又拿走了做预算的依据。
#   所以改成让它自己量：跑这个脚本拿到实际值，按阈值决定「继续 / 收尾 / 立刻停」。
#
# 用法：bash .cnb/scripts/npc-budget.sh
#   · 开工第一件事跑一次；
#   · 每次**准备开新工作面之前**再跑一次（含派子代理、开新章节、装工具链）。
#
# 退出码恒为 0：它是决策输入，不是判据（机器可读的判据是输出里的 `结论=` 那一行）。
set -u

TOTAL_MS="${CNB_PIPELINE_MAX_RUN_TIME:-}"
START="${CNB_BUILD_START_TIME:-}"

# 两个阈值：到这里就该收，而不是「跑到墙上再死」。
# 依据是真机教训（Issue #33 那两条 2h 失败分别为 119.3 / 121.1 分钟，全是零余量）：
# 只要有任意一个 70% 节点停下来落盘 + 回帖，都不会连结论都发不出去。
WRAP_PCT=70
HALT_PCT=85

is_num() { case "${1:-}" in '' | *[!0-9]*) return 1 ;; *) return 0 ;; esac; }

fmt_s() {  # 秒 → 9s / 41m23s / 2h00m
  local s="$1"
  if [ "$s" -ge 3600 ]; then
    printf '%dh%02dm' $((s / 3600)) $(((s % 3600) / 60))
  elif [ "$s" -ge 60 ]; then
    printf '%dm%02ds' $((s / 60)) $((s % 60))
  else
    printf '%ds' "$s"
  fi
}

log() { printf '[npc-budget] %s\n' "$*"; }

if ! is_num "$TOTAL_MS"; then
  log "结论=unknown"
  log "⚠️ 平台没有下发 CNB_PIPELINE_MAX_RUN_TIME（当前值：${TOTAL_MS:-空}），算不出已用比例。"
  log "   按默认纪律走：做完一段就落盘（commit / 建 PR / 产出文件），别把全部改动压到最后。"
  exit 0
fi

TOTAL_S=$((TOTAL_MS / 1000))
log "流水线运行时长预算（平台下发，仓库侧改不掉）"

# 合法但**过小**的值同样算不出来：TOTAL_S=0 会让 `ELAPSED * 100 / TOTAL_S` 除零，
# 脚本以退出码 1 崩掉 —— 与「退出码恒 0，它是决策输入不是判据」的契约相悖，
# 调用方会把「算不出来」当成失败处理（真机实测：1/500/999 都崩）。
if [ "$TOTAL_S" -lt 1 ]; then
  log "结论=unknown"
  log "⚠️ 下发的额度不合法（CNB_PIPELINE_MAX_RUN_TIME=${TOTAL_MS}，折算 ${TOTAL_S}s）：算不出比例。"
  log "   按默认纪律走：做完一段就落盘（commit / 建 PR / 产出文件），别把全部改动压到最后。"
  exit 0
fi

START_S=""
if [ -n "$START" ]; then
  START_S="$(date -u -d "$START" +%s 2>/dev/null || echo '')"
fi

if ! is_num "$START_S"; then
  log "  总额 $(fmt_s "$TOTAL_S") ｜ 起点缺失，算不出已用时长"
  log "结论=unknown"
  log "⚠️ 缺 CNB_BUILD_START_TIME（或格式无法解析），只能给总额。"
  log "   保守处理：先落盘一次（commit / 建 PR），再决定要不要继续开新工作面。"
  exit 0
fi

NOW_S="$(date -u +%s)"
ELAPSED=$((NOW_S - START_S))
[ "$ELAPSED" -lt 0 ] && ELAPSED=0          # 容忍时钟偏差，不倒扣
REMAIN=$((TOTAL_S - ELAPSED))
[ "$REMAIN" -lt 0 ] && REMAIN=0
PCT=$((ELAPSED * 100 / TOTAL_S))

log "  总额 $(fmt_s "$TOTAL_S") ｜ 已用 $(fmt_s "$ELAPSED")（${PCT}%）｜ 剩余 $(fmt_s "$REMAIN")"
log "  起点（CNB_BUILD_START_TIME）=$START"

if [ "$PCT" -ge "$HALT_PCT" ]; then
  log "结论=halt"
  log "🛑 已用 ${PCT}%（≥${HALT_PCT}%）：**立刻收尾** —— 落盘 + 回帖「本轮到哪了 + 下一步」，"
  log "   别再开新工作面，也别再派子代理。"
elif [ "$PCT" -ge "$WRAP_PCT" ]; then
  log "结论=wrapup"
  log "⚠️ 已用 ${PCT}%（≥${WRAP_PCT}%）：**停止开新工作面** —— 先落盘（commit / 建 PR / 产出文件），"
  log "   再回帖说清「本轮到哪了 + 下一步」，然后按能做完的范围收尾。"
else
  log "结论=continue"
  log "✅ 还有余量：开新工作面之前再跑一次这个脚本就行。"
fi

exit 0
