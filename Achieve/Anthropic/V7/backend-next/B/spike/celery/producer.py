# 投递方(一次性):把 N 个目标投递到队列。任务体只有 goalId,无业务载荷。
import sys

from tasks import dispatch_goal_execution

EXECUTOR_URL = "http://host.docker.internal:3799"

def main(goal_ids: list[str]) -> None:
    results = []
    for gid in goal_ids:
        r = dispatch_goal_execution.delay(gid, EXECUTOR_URL)
        results.append({"goalId": gid, "taskId": r.id})
    print(f"dispatched {len(results)} goals: {results}")

if __name__ == "__main__":
    ids = sys.argv[1:] or ["b-goal-1", "b-goal-2", "b-goal-3"]
    main(ids)
