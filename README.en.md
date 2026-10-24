# dsh-speed-anchor

Turns the shipped `N turns · N steps · 223 tok/s` stat pill under the DSH composer into a live speed sparkline.

Collapsed, it is a 44×13 polyline plus the current tok/s; the dot on the right lights up only while thinking or prose tokens are arriving. Clicking it opens the usual session-stats panel plus a peak row and the two sampling knobs.

## Install

In the DSH plugin manager choose "install from URL" and paste:

```
https://github.com/puny-code/dsh-speed-anchor/releases/download/v0.6.0/dsh-speed-anchor-0.6.0.tgz
```

Reload the window afterwards.

Use that entry point rather than `dsh plugin add <url>`: the CLI only adds the package dependency, without registering it in the profile's bundle list, so the plugin stays inactive until you enable it in the plugin manager.

## Where the numbers come from

DSH only reports output tokens once a step settles, so there is no streaming token counter. This plugin samples the streamed character count every 200 ms (text and reasoning blocks only, never tool calls), and each point is "characters gained over the last 300 ms ÷ elapsed ÷ chars per token". The chars-per-token ratio starts at 4 and is recalibrated from settled steps (exponentially smoothed, clamped to 0.3–20), which keeps CJK-heavy turns honest.

That makes it an **estimate**, not the provider's billing figure. The upside is 200 ms resolution; the cost is a percentage point or two of drift.

Tool phases are not sampled at all: the partial stream is empty or frozen there, and recording it only produces runs of zero samples. The reading freezes at the last pre-tool value, the dot goes dark, and the window restarts when new prose arrives, so tool latency never dilutes the next point.

## Settings

Settings → `TPS chart`: sampling step (200 ms), averaging window (300 ms), trailing points dropped at stream end (1), and the scale window (30 points).

The scale window is what keeps the chart readable: with an all-time ceiling, one 1000 tok/s spike pins every later 50 tok/s point to the floor of the box. It now scales to the highest value among the newest 30 points (~6 s at the default step). Values above the window flat-top at the ceiling instead of escaping the box, and the reported peak stays the real high point of the visible curve.

## License

MIT
