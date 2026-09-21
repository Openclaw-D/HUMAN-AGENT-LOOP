# Comfy Desktop / MiniMax H3：逐条输入的首尾帧提示词

## 先设置一次

1. 在模板搜索 `MiniMax H3: 首尾帧视频生成`，新开该工作流。现有 `api_minimax_h3_t2v` 是文生视频，仅改 prompt 无法锁定这些定格图。
2. 每条都用 `00-blank-paper.png` 作**首帧**，下表对应 PNG 作**尾帧**；两图均为 16:9。模型 `MiniMax H3`、分辨率 `768P`、时长 `15`、批次 `1`、水印 `false`。若模板显示种子与运行后控制，沿用目前的 `1608049135` / `fixed`。新工作流字段如有不同，以实际 UI 显示为准。
3. 每次只替换尾帧、提示词与输出文件前缀。生成前看节点价格；不要同时点击多次运行。六条都无配音、无字幕；音乐和笔触声在后期统一加入。
4. 第一段舞台播放目标 20 秒：15 秒生成段＋5 秒后期的完整图轻运动/停留。不能把 H3 单次生成时长填成 20 秒。后五段各 15 秒。准确文字、Logo、指标后期校验并叠加；H3 不保证逐笔正确或文字不变形。

## 01：开场，15 秒素材，20 秒舞台版

尾帧：`01-opening-v2.png`。输出前缀：`JW_01_opening_768`。

```text
One continuous 15-second overhead documentary shot on exactly the first-frame paper. Real pale kraft paper, authentic fountain pen, warm natural light, tiny blurred eyeglasses profile at the extreme left edge; no other physical props. Starting with truly blank paper, the pen writes the dominant large “70 ms” rapidly in slightly crooked but clearly readable black ink. Keep the center number unobstructed. It then draws simple evidence symbols on the left, three ranked candidate bars on the right and one human selection mark; fine black arrows join them into a flowing circle. Drawn marks remain stable and match the supplied last-frame composition. Once drawn, tiny gray ink points travel gently along the arrows, the bars subtly breathe, and the overall paper diagram stays visibly alive without making the words hard to read. Pull back to the full exact last-frame composition. No speech, no subtitles, no extra text, no color effects, no extra props, no cuts, no morphing hands, no ink appearing before pen contact.
```

## 02：上海到喀什

尾帧：`02-journey.png`。输出前缀：`JW_02_journey_768`。

```text
Start from the completely blank supplied first-frame kraft paper. In a continuous overhead real-paper shot, a black fountain pen swiftly sketches one long winding route from the Shanghai skyline on the left to a small factory in the Kashgar desert on the right. Add in clear order: subway, midnight moon and first airplane, transfer airport and second airplane, long bus ride, then camel and distant factory. Do not show an actual travel montage; every place remains an economical hand-drawn ink symbol on this one sheet. A small ink point continually advances along the completed route, while faint gray document sheets travel back and forth beneath it to suggest repeated checks. End on the supplied exact last-frame composition, leaving the far-right place name blank for accurate later lettering. Human skin, paper and pen remain naturally colored; the drawing is black and gray only. No speech, subtitles, unrelated props, extra text, warped lettering or scene cuts.
```

## 03：客户授权与远程采集

尾帧：`03-evidence.png`。输出前缀：`JW_03_evidence_768`。

```text
Begin on the same blank paper, same real pen and locked overhead camera. The pen draws a signed customer authorization sheet, then a simple smartphone-video outline. From it draw four separate onsite evidence frames one by one: factory exterior, active production line, machine identification plate and supporting document. Fine ink lines carry the four frames into one shared evidence folder. A small unfilled dashed frame remains visible and gently pulses once to indicate a requested reshoot or missing proof. After every frame is drawn, tiny gray movement inside the frame and along the filing arrows keeps the diagram alive, subtle enough to read. End matching the provided last frame. No speech, subtitles, extra physical objects, unreadable generated labels, colored ink, camera cuts or magical spontaneous marks.
```

## 04：并行 Agent、候选与人类选择

尾帧：`04-parallel-decision.png`。输出前缀：`JW_04_parallel_768`。

```text
Starting from blank pale kraft paper, one black fountain pen draws an evidence stack at left. From the same evidence, five specialist Agent nodes appear quickly and in parallel; their fine hand-drawn arrows converge on one shared versioned record in the middle. A new evidence note updates one relevant branch, not the whole page. Draw three ranked candidate boxes at right with modest changing confidence bars. A separate human pointing and selection mark closes the sequence; it is visibly a human choice, not automatic approval. Completed paths continue carrying very small gray moving ink points. Keep the five-way parallelism, evidence source and final human authority legible at a distance. Finish at the supplied last frame. Natural paper and skin color; all drawn marks black or gray. No speech, subtitles, extra text, colored UI or new props.
```

## 05：技术组合，Jev 必须为唯一视觉中心

尾帧：`05-technology.png` 当前是**构图草稿**，中心仍为 `JW`；在将中心改为 Jev、核准外围 Logo 与 `Pic` 名称之前，不要用此图付费生成。输出前缀：`JW_05_tech_768`。

```text
On the same blank real kraft paper, a black fountain pen draws “Jev” in the exact visual center as the largest and clearest technical name. Around it, draw a small structured-choice diagram with three candidate bars and uncertainty routing. Five professional Agent nodes connect in parallel through one fine A2A line. An outer thin ring records human approval, evidence trace and tested version changes. Small verified brand marks appear at the outside edge only as design inspirations; they never compete with the centered Jev mark or imply an integration or commercial partnership. Once drawn, tiny gray ink points circulate continuously through the A2A branches while the Jev decision unit gently updates. End at the exact supplied last frame. No speech, subtitles, colored spectacle, camera cuts, additional logos or garbled company names.
```

## 06：业务价值

尾帧：`06-business-value.png`。输出前缀：`JW_06_value_768`。

```text
Start from the same empty pale kraft sheet. The pen first draws a small remote desert factory and an old tangled gray route. It then creates a simpler black path through shared evidence, parallel specialists and one human decision point. The circular line travels toward a service-and-expertise page on the right, then loops back to the customer so that business value visibly reaches the remote factory. The large central “50%” is held clear while four small numeric outcomes settle beneath it. After the whole drawing is complete, the old route stays faint and the new line keeps a gentle continuous movement; never hide the numbers. End exactly on the supplied last-frame layout with enough breathing room for later Chinese labels and “预计/保守测算” qualification. Natural paper and pen, black/gray ink only. No speech, subtitles, colored effects, invented metrics or extra objects.
```
