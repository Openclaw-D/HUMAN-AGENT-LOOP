# 投递任务定义:Celery → B 执行器(HTTP,跨语言边界真实走 socket)。
# 任务体 = {goal_id, executor_url}:只有"该执行了"的通知,无业务载荷。
# 执行器(B worker 的 HTTP 入口)自己向 A claim;拿不到 lease = 目标已被处理 → no-op 成功。
# 重试语义:执行器返回 5xx/连接失败 → 本任务有限次自动重试(指数退避);
#          执行器返回 4xx = 确定拒绝(如目标已被领取/失效)→ 不重试(记录即止)。
import time

import requests

from celery_app import app


class ExecutorUnavailable(Exception):
    """执行器临时不可用:允许有界自动重试。"""


@app.task(
    bind=True,
    max_retries=3,
    autoretry_for=(requests.ConnectionError, requests.Timeout, ExecutorUnavailable),
    retry_backoff=2,
    retry_backoff_max=30,
    retry_jitter=False,
    acks_late=True,
)
def dispatch_goal_execution(self, goal_id: str, executor_url: str):
    attempt = self.request.retries + 1
    url = f"{executor_url.rstrip('/')}/execute"
    resp = requests.post(url, json={"goalId": goal_id, "deliveryAttempt": attempt, "taskId": self.request.id}, timeout=10)
    if resp.status_code >= 500:
        raise ExecutorUnavailable(f"executor 5xx ({resp.status_code}) for {goal_id}")
    # 2xx/4xx 都视为投递完成(4xx = 执行器确定性拒绝,B 侧记录,不重试)
    return {"goalId": goal_id, "attempt": attempt, "status": resp.status_code}
