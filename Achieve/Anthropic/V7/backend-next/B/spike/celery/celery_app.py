# Celery 应用定义(spike;Linux 容器内验证——Celery 原生不支持 Windows)。
# 分工纪律(任务书 §B):
#   Celery = 投递/重试层(队列责任方的候选实现之一);
#   LangGraph worker = 执行层(唯一发起 LLM/工具调用的一方);
#   A = 业务状态权威。Celery 任务不携带业务状态,重试不等于执行重试。
import os

from celery import Celery

BROKER_URL = os.environ.get("CELERY_BROKER_URL", "redis://redis:6379/0")
RESULT_BACKEND = os.environ.get("CELERY_RESULT_BACKEND", "redis://redis:6379/1")

app = Celery("b_dispatch", broker=BROKER_URL, backend=RESULT_BACKEND)
app.conf.update(
    # 有界重试策略(任务书:不允许盲重试;有限重试策略落盘可审)
    task_acks_late=True,              # worker 崩溃 → 未 ack 任务重投(至少一次)
    task_reject_on_worker_lost=True,  # worker 被 kill 也重投
    worker_prefetch_multiplier=1,     # 公平分发,防止单 worker 囤积任务
    task_track_started=True,
    broker_transport_options={"visibility_timeout": 60},
)
