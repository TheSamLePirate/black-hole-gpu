#!/bin/zsh
# perf-suite on two commits, A B B A (the drift of a long run cancelled), each run's log and perf.json in $AB_OUT —
# run by scripts/ab-commit.ts as its AB_CMD (it serves A and B and sets AB_A_URL, AB_B_URL, AB_OUT):
#   AB_REV_B=<revB> AB_CMD="zsh scripts/perf-suite-ab.sh" bun scripts/ab-commit.ts <revA>
# docs/PLAN-LEAN-TRACER-KERNELS.md P10 (the frame rates before the plan and after it).
mkdir -p "$AB_OUT"
n=0
for side in A B B A; do
  n=$((n + 1))
  url=$([[ $side == A ]] && echo "$AB_A_URL" || echo "$AB_B_URL")
  E2E=1 E2E_URL="$url" E2E_SHOTS="$AB_OUT/$n-$side" bun test tests/e2e/perf-suite.e2e.test.ts --timeout 4000000 > "$AB_OUT/$n-$side.log" 2>&1
  echo "$n $side: exit $?"
done
