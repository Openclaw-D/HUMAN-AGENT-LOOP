# Claude Tag public reference boundary

TAG uses Anthropic's public Claude Tag announcement as a product reference, not as source code or a compatibility specification.

Official source: <https://www.anthropic.com/news/introducing-claude-tag>

Publicly described ideas relevant to this project:

- one shared Claude identity inside a permitted team channel;
- every permitted team member can see work and continue from the previous conversation;
- channel-scoped accumulated context rather than repeated private-session explanation;
- asynchronous and scheduled work;
- tightly controlled tools, data, codebase, and channel access;
- separate identities and memories for different permission scopes;
- administrator spend limits and an activity log showing who requested each task.

TAG's local interpretation:

- `Project + Thread` replaces a Slack channel as the collaboration boundary;
- `Principal + Membership` controls which humans may read, invoke, or decide;
- `AgentIdentity + scopes` controls which runtime may act and which tools it may use;
- `Run + Event + Outbox` represents asynchronous work and traceability;
- `Evidence + Citation + Fact + Challenge` makes claims inspectable;
- `Decision` remains a separate human authority record;
- Graph is a derived project-state view, not a feature claimed by Claude Tag.

Not claimed:

- Slack integration;
- Anthropic internal architecture;
- Claude memory behavior or model parity;
- compatibility with Claude Tag;
- use of Anthropic trademarks beyond identifying the public reference.
