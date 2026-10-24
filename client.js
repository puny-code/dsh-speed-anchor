/**
 * Client half of `dsh-speed-anchor`.
 *
 * Adds a compact token-speed pill to `conversation.composer.dock`: a live
 * sparkline, the current tok/s reading and a pulsing live dot. Opening the pill
 * shows the same timing rows the shipped stats dialog shows.
 *
 * The reading is live: while a step streams, the module samples the number of
 * streamed characters, converts them to tokens with a ratio calibrated from
 * settled steps, and reports the average speed over the last `windowMs`.
 *
 * The sampling interval and the averaging window are editable on a `TPS折线`
 * page this module adds to `settings.section`; both values live in
 * `localStorage` because a browser-side bundle has no Host settings service.
 *
 * Written against the slot contracts only: no Harness Client package is loaded
 * as a module, the markup and styles mirror the shipped pill, and every colour
 * comes from the `--dsw-alias-*` tokens published by the Theme service.
 */
window.__ModuleLoader__.load({
  id: 'dsh-speed-anchor',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const SLOT = 'conversation.composer.dock';
    /**
     * A fresh cell beside the shipped entries. Reusing the shipped `activity`
     * id would put us inside that cell, but it also makes our bundle the one
     * that seats it at boot — one failed seat takes the whole boot down, so the
     * anchor stays additive and the shipped pill is hidden with CSS instead.
     */
    const CELL = 'speed-anchor';
    const ORDER = 0;

    const SETTINGS_SLOT = 'settings.section';
    const SETTINGS_ID = 'tps-chart';
    const SETTINGS_ORDER = 90;

    const SETTINGS_KEY = 'dsh-speed-anchor/settings/v1';
    const DEFAULT_SETTINGS = { intervalMs: 200, windowMs: 300, tailDrop: 1, peakWindow: 30 };
    const SETTING_BOUNDS = { intervalMs: [50, 5000], windowMs: [50, 5000], tailDrop: [0, 10], peakWindow: [3, 60] };
    const SETTING_STEPS = { intervalMs: 50, windowMs: 50, tailDrop: 1, peakWindow: 1 };

    const TRAIL_POINTS = 60;
    /** Rough fallback when no settled step is available yet. */
    const FALLBACK_CHARS_PER_TOKEN = 4;
    /** Sane chars-per-token bounds for the online calibration. */
    const RATIO_MIN = 0.3;
    const RATIO_MAX = 20;

    /* Per-session sparkline cache: localStorage key plus a memory layer. */
    const TRAIL_KEY = 'dsh-speed-anchor/trails/v1';
    const TRAIL_SESSIONS = 20;

    const COPY = {
      zh: {
        title: '会话统计',
        counts: (turns, steps) => turns + ' 轮 ' + steps + ' 步',
        llmTime: '模型用时',
        toolTime: '工具调用用时',
        ttft: '首 token 平均',
        speed: '输出速度',
        peak: '峰值',
        sample: '采样粒度',
        window: '平均窗口',
        ms: 'ms',
        unit: 'tok/s',
        empty: '—',
        settingsNav: 'TPS折线',
        settingsTitle: '生成速度折线',
        settingsIntro: '输入框下方的速度胶囊用折线展示实时输出速度。可以调整采样粒度与用来求平均的时间窗口。',
        intervalLabel: '采样粒度（毫秒）',
        intervalHint: '每隔多久记录一个折线点。默认 200 毫秒。',
        windowLabel: '平均窗口（毫秒）',
        windowHint: '每个点取最近这段时间内的输出速度。默认 300 毫秒。',
        tailLabel: '丢弃尾部点数（个）',
        tailHint: '输出结束时丢弃最后几个采样点，结尾一两个 token 独占一个窗口时不再冻住一个极小读数。默认丢 1 个，填 0 不丢。',
        peakLabel: '取值范围点数（个）',
        peakHint: '纵轴高度只按最近这么多个点里的最高值算，不画出来。默认 30 个点。早期的偶发高速会随时间退出，不再把后面的曲线压成贴底的一条线。',
        settingsPreview: (interval, window, tail, peakPoints) => '当前：每 ' + interval + ' ms 一个点，每个点取最近 ' + window + ' ms 的平均值，纵轴取最近 ' + peakPoints + ' 个点的最高值，结尾丢弃 ' + tail + ' 个点。',
        save: '保存',
        saved: '已保存',
        reset: '恢复默认',
        invalid: '请输入 ' + SETTING_BOUNDS.intervalMs[0] + '–' + SETTING_BOUNDS.intervalMs[1] + ' 之间的数字',
      },
      en: {
        title: 'Session stats',
        counts: (turns, steps) => turns + (turns === 1 ? ' turn · ' : ' turns · ') + steps + (steps === 1 ? ' step' : ' steps'),
        llmTime: 'Model time',
        toolTime: 'Tool time',
        ttft: 'TTFT (average)',
        speed: 'Output speed',
        peak: 'Peak',
        sample: 'Sample step',
        window: 'Average window',
        ms: 'ms',
        unit: 'tok/s',
        empty: '—',
        settingsNav: 'TPS chart',
        settingsTitle: 'Token speed chart',
        settingsIntro: 'The speed pill under the composer charts live output speed. Adjust the sampling step and the window each point averages over.',
        intervalLabel: 'Sampling step (ms)',
        intervalHint: 'How often a point is recorded. Default 200 ms.',
        windowLabel: 'Average window (ms)',
        windowHint: 'How far back each point averages. Default 300 ms.',
        tailLabel: 'Drop trailing points',
        tailHint: 'When output ends, drop this many tail samples so a final dribble of tokens never freezes as the reading. Drops 1 by default, 0 keeps everything.',
        peakLabel: 'Scale window (points)',
        peakHint: 'The vertical scale only uses the highest value among this many newest points; the range itself is not drawn. Default 30 points. An early freak spike ages out instead of flattening everything after it.',
        settingsPreview: (interval, window, tail, peakPoints) => 'Now: one point every ' + interval + ' ms, each averaging the last ' + window + ' ms; the scale uses the newest ' + peakPoints + ' points; the last ' + tail + ' point(s) are dropped at the end.',
        save: 'Save',
        saved: 'Saved',
        reset: 'Restore defaults',
        invalid: 'Enter a number between ' + SETTING_BOUNDS.intervalMs[0] + ' and ' + SETTING_BOUNDS.intervalMs[1],
      },
    };

    const CSS = [
      '.dsa-anchor{position:relative;display:inline-flex;min-width:0;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px))}',
      '[data-composer-stat="activity"]:not([data-dsa]){display:none!important}',
      '.dsa-pill{box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:1px 8px;border:0;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-tertiary);font:inherit;font-variant-numeric:tabular-nums;line-height:inherit;white-space:nowrap;cursor:pointer;text-align:left}',
      '.dsa-pill:hover,.dsa-pill[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
      '.dsa-pill:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.dsa-spark{flex:none;width:44px;height:13px;overflow:visible}',
      '.dsa-spark .line{fill:none;stroke:currentColor;stroke-width:1.1px;stroke-linecap:round;stroke-linejoin:round}',
      '.dsa-spark .area{fill:color-mix(in srgb,currentColor 12%,transparent);stroke:none}',
      '.dsa-spark .tip{fill:currentColor;stroke:none}',
      '.dsa-value{min-width:2ch;color:var(--dsw-alias-label-secondary);font-weight:500;text-align:right}',
      '.dsa-unit{color:inherit}',
      '.dsa-live{flex:none;width:4px;height:4px;margin-left:1px;border-radius:50%;background:color-mix(in srgb,var(--dsw-alias-label-primary) 26%,transparent)}',
      '.dsa-live[data-live]{background:var(--dsw-alias-state-success-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent);animation:dsa-pulse 1.6s ease-out infinite}',
      '@keyframes dsa-pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--dsw-alias-state-success-primary) 28%,transparent)}70%,100%{box-shadow:0 0 0 4px transparent}}',
      '.dsa-panel{position:absolute;left:0;bottom:calc(100% + 8px);z-index:1100;box-sizing:border-box;width:max-content;min-width:min(300px,100vw - 24px);max-width:min(440px,100vw - 24px);padding:16px;border:0;border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;text-align:left;cursor:default}',
      '.dsa-title{display:flex;justify-content:space-between;gap:16px;margin-bottom:8px;color:var(--dsw-alias-label-primary);font-weight:500}',
      '.dsa-title-value{font-variant-numeric:tabular-nums}',
      '.dsa-rule{border-top:.5px solid var(--dsw-alias-border-l2);margin-bottom:10px}',
      '.dsa-rows{display:grid;grid-template-columns:minmax(76px,auto) minmax(0,1fr);gap:6px 16px;margin:0;color:var(--dsw-alias-label-tertiary)}',
      '.dsa-rows dt,.dsa-rows dd{min-width:0;margin:0}',
      '.dsa-rows dd{color:var(--dsw-alias-label-secondary);text-align:right;font-variant-numeric:tabular-nums}',
      '@media (width<=520px){.dsa-spark{display:none}}',
      '.dsa-section{display:flex;flex-direction:column;gap:18px;max-width:560px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}',
      '.dsa-section-title{margin:0;font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.dsa-section-intro{margin:0;color:var(--dsw-alias-label-secondary)}',
      '.dsa-field{display:flex;flex-direction:column;gap:6px}',
      '.dsa-field-label{font-weight:500;color:var(--dsw-alias-label-primary)}',
      '.dsa-field-input{box-sizing:border-box;width:160px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-variant-numeric:tabular-nums}',
      '.dsa-field-input:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;border-color:transparent}',
      '.dsa-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:16px}',
      '.dsa-actions{display:flex;align-items:center;gap:10px}',
      '.dsa-btn{box-sizing:border-box;padding:5px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer}',
      '.dsa-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsa-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.dsa-btn-primary{border-color:transparent;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}',
      '.dsa-status{color:var(--dsw-alias-state-success-primary);font-size:12px}',
      '.dsa-status[data-warn]{color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-label-tertiary))}',
    ].join('\n');

    /* ---------------------------------------------------------------- settings */

    function clampSetting(key, value) {
      const bounds = SETTING_BOUNDS[key] || [1, 1e6];
      if (typeof value !== 'number' || !isFinite(value)) return DEFAULT_SETTINGS[key];
      return Math.min(bounds[1], Math.max(bounds[0], Math.round(value)));
    }

    function readSettings() {
      const next = {
        intervalMs: DEFAULT_SETTINGS.intervalMs,
        windowMs: DEFAULT_SETTINGS.windowMs,
        tailDrop: DEFAULT_SETTINGS.tailDrop,
        peakWindow: DEFAULT_SETTINGS.peakWindow,
      };
      try {
        const raw = window.localStorage.getItem(SETTINGS_KEY);
        if (!raw) return next;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return next;
        next.intervalMs = clampSetting('intervalMs', parsed.intervalMs);
        next.windowMs = clampSetting('windowMs', parsed.windowMs);
        next.tailDrop = clampSetting('tailDrop', parsed.tailDrop);
        next.peakWindow = clampSetting('peakWindow', parsed.peakWindow);
      } catch (error) {
        return next;
      }
      return next;
    }

    const settingsListeners = [];

    function subscribeSettings(listener) {
      settingsListeners.push(listener);
      return () => {
        const index = settingsListeners.indexOf(listener);
        if (index >= 0) settingsListeners.splice(index, 1);
      };
    }

    function writeSettings(next) {
      const value = {
        intervalMs: clampSetting('intervalMs', next.intervalMs),
        windowMs: clampSetting('windowMs', next.windowMs),
        tailDrop: clampSetting('tailDrop', next.tailDrop),
        peakWindow: clampSetting('peakWindow', next.peakWindow),
      };
      try {
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
      } catch (error) {
        /* Private modes can refuse storage; the in-memory value still applies. */
      }
      for (let index = 0; index < settingsListeners.length; index += 1) {
        try {
          settingsListeners[index](value);
        } catch (error) {
          /* A broken subscriber must not break the writer. */
        }
      }
      return value;
    }

    function useSettings() {
      const [value, setValue] = React.useState(readSettings);
      React.useEffect(() => subscribeSettings(setValue), []);
      return value;
    }

    /* ------------------------------------------------------------------ stats */

    function emptyStats() {
      return { turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 };
    }

    function outputTokens(usage) {
      if (!usage || typeof usage !== 'object') return null;
      const value = usage.outputTokens;
      return typeof value === 'number' && isFinite(value) && value >= 0 ? value : null;
    }

    /** One settled assistant node: TTFT, decode wall time and output tokens. */
    function stepReading(node) {
      const timing = node.timing;
      return {
        ttftMs:
          timing !== undefined && timing.stepStartTime !== null && timing.firstTokenTime !== null
            ? Math.max(0, timing.firstTokenTime - timing.stepStartTime)
            : null,
        decodeMs: timing !== undefined && timing.firstTokenTime !== null ? Math.max(0, timing.completedTime - timing.firstTokenTime) : null,
        outputTokens: outputTokens(node.usage),
      };
    }

    /** Same reading the shipped stats dialog shows; kept local so no Client package is loaded. */
    function deriveStats(nodes) {
      const turns = new Set();
      let steps = 0;
      let llmMs = 0;
      let toolMs = 0;
      let ttftMs = 0;
      let ttftSteps = 0;
      let decodeMs = 0;
      let decodeTokens = 0;
      if (Array.isArray(nodes)) {
        for (let index = 0; index < nodes.length; index += 1) {
          const node = nodes[index];
          if (!node || typeof node !== 'object') continue;
          if (node.kind === 'tool-result') {
            if (node.callTime !== null && node.callTime !== undefined) toolMs += Math.max(0, node.time - node.callTime);
            continue;
          }
          if (node.kind !== 'assistant') continue;
          turns.add(node.turn);
          steps += 1;
          if (node.timing !== undefined && node.timing.stepStartTime !== null) {
            llmMs += Math.max(0, node.timing.completedTime - node.timing.stepStartTime);
          }
          const reading = stepReading(node);
          if (reading.ttftMs !== null) {
            ttftMs += reading.ttftMs;
            ttftSteps += 1;
          }
          if (reading.decodeMs !== null && reading.outputTokens !== null) {
            decodeMs += reading.decodeMs;
            decodeTokens += reading.outputTokens;
          }
        }
      }
      return { turns: turns.size, steps, llmMs, toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens };
    }

    function normalizeStats(value) {
      if (!value || typeof value !== 'object') return null;
      const stats = emptyStats();
      let seen = false;
      Object.keys(stats).forEach((key) => {
        const raw = value[key];
        if (typeof raw === 'number' && isFinite(raw) && raw >= 0) {
          stats[key] = raw;
          seen = true;
        }
      });
      return seen ? stats : null;
    }

    /* -------------------------------------------------------------- live speed */

    /** Characters a streamed step has produced so far (text plus reasoning). */
    function blockChars(blocks) {
      if (!Array.isArray(blocks)) return 0;
      let total = 0;
      for (let index = 0; index < blocks.length; index += 1) {
        const block = blocks[index];
        if (!block || typeof block !== 'object') continue;
        if (block.kind !== 'text' && block.kind !== 'reasoning') continue;
        if (typeof block.text === 'string') total += block.text.length;
      }
      return total;
    }

    /**
     * Live characters from the legacy slice's `partial` projection. Settled
     * turns live in `legacy.nodes`; a streaming `assistant-step` contributes
     * no node there at all — only `{ turn, step, blocks }` on `legacy.partial`
     * until it settles. Reading `legacy.nodes` for live text (as v0.2 did)
     * therefore never sees the stream; this is the fix.
     */
    function scanPartial(partial) {
      if (!partial) return { chars: 0, active: false };
      return { chars: blockChars(partial.blocks), active: true };
    }

    /* ------------------- per-session trail cache ------------------- */
    /* Memory first, localStorage as the second layer; capped so one heavy
     * user cannot grow the entry without bound. */

    const trailMemory = new Map();
    let trailDiskLoaded = false;

    function loadSessionTrail(key) {
      if (trailMemory.has(key)) return trailMemory.get(key);
      if (!trailDiskLoaded) {
        trailDiskLoaded = true;
        try {
          const raw = window.localStorage.getItem(TRAIL_KEY);
          const store = raw ? JSON.parse(raw) : null;
          if (store && typeof store === 'object') {
            const names = Object.keys(store);
            for (let index = 0; index < names.length; index += 1) {
              const entry = store[names[index]];
              if (entry && Array.isArray(entry.trail)) trailMemory.set(names[index], entry);
            }
          }
        } catch (error) { /* private mode: memory cache still works */ }
      }
      if (trailMemory.has(key)) return trailMemory.get(key);
      return { trail: [], speed: null };
    }

    function saveSessionTrail(key, entry) {
      if (!key) return;
      const clean = {
        trail: Array.isArray(entry.trail) ? entry.trail.slice(-TRAIL_POINTS) : [],
        speed: typeof entry.speed === 'number' && isFinite(entry.speed) && entry.speed >= 0 ? entry.speed : null,
        updatedAt: Date.now(),
      };
      trailMemory.set(key, clean);
      try {
        const names = Array.from(trailMemory.keys());
        names.sort((a, b) => {
          const ta = trailMemory.get(a).updatedAt || 0;
          const tb = trailMemory.get(b).updatedAt || 0;
          return tb - ta;
        });
        const store = {};
        const keep = Math.min(names.length, TRAIL_SESSIONS);
        for (let index = 0; index < keep; index += 1) store[names[index]] = trailMemory.get(names[index]);
        window.localStorage.setItem(TRAIL_KEY, JSON.stringify(store));
      } catch (error) { /* private mode: memory cache still works */ }
    }

    /* ------------------------------------------------------------------- format */

    /** `>= 10` rounds, below that keeps one decimal — the shipped formatter. */
    function formatSpeed(tps) {
      if (typeof tps !== 'number' || !isFinite(tps) || tps <= 0) return null;
      return tps >= 10 ? String(Math.round(tps)) : tps.toFixed(1);
    }

    /** Compact duration: 45.2s under a minute, 2m42s from there on. */
    function formatDuration(ms, translate) {
      if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) return copyDash();
      const seconds = ms / 1e3;
      if (seconds < 60) {
        const rounded = Math.round(seconds * 10) / 10;
        return translate('duration.compactSeconds', { seconds: rounded }, rounded + 's');
      }
      const whole = Math.round(seconds);
      const minutes = Math.floor(whole / 60);
      const rest = whole % 60;
      return translate('duration.compactMinutes', { minutes: minutes, seconds: rest }, minutes + 'm' + rest + 's');
    }

    function copyDash() {
      return '\u2014';
    }

    /** Vertical scale ceiling: the highest value among the newest `count`
     * points. A short window lets one freak spike age out instead of pinning
     * every later sample to the floor of the box. */
    function scalePeak(trail, count) {
      if (!Array.isArray(trail) || trail.length === 0) return 1;
      const size = typeof count === 'number' && isFinite(count) && count > 0 ? Math.floor(count) : TRAIL_POINTS;
      const from = Math.max(0, trail.length - size);
      let peak = 0;
      for (let index = from; index < trail.length; index += 1) {
        const value = trail[index];
        if (typeof value === 'number' && isFinite(value) && value > peak) peak = value;
      }
      return peak > 0 ? peak : 1;
    }

    function Spark(props) {
      const points = props.points;
      if (!Array.isArray(points) || points.length < 2) return null;
      const width = 44;
      const height = 13;
      const peak = props.peak > 0 ? props.peak : 1;
      const step = width / (points.length - 1);
      /* Flat-top anything above the scale window: the svg paints with
       * overflow visible, so an unclamped point would escape the box. */
      const y = (value) => {
        const ratio = Math.min(1, Math.max(0, value / peak));
        return height - 1.5 - ratio * (height - 3);
      };
      const line = points
        .map((value, index) => (index * step).toFixed(1) + ',' + y(value).toFixed(1))
        .join(' ');
      const last = points[points.length - 1];
      return h(
        'svg',
        {
          className: 'dsa-spark',
          viewBox: '0 0 ' + width + ' ' + height,
          preserveAspectRatio: 'none',
          'aria-hidden': true,
        },
        h('polygon', { className: 'area', points: '0,' + height + ' ' + line + ' ' + width + ',' + height }),
        h('polyline', { className: 'line', points: line, vectorEffect: 'non-scaling-stroke' }),
        h('circle', { className: 'tip', cx: (width - 0.8).toFixed(1), cy: y(last).toFixed(1), r: 1.7 })
      );
    }

    function useStats(useChat, useProjection) {
      const projected = useProjection('sessionStats');
      const nodes = useChat((state) => (state && state.legacy ? state.legacy.nodes : undefined));
      return React.useMemo(() => normalizeStats(projected) || deriveStats(nodes), [projected, nodes]);
    }

    /* ---------------------------------------------------------------------- pill */

    function SpeedAnchor(props) {
      const useChat = props.useChat;
      const useProjection = props.useProjection;
      const useSession = props.useSession;
      const t = typeof props.t === 'function' ? props.t : null;
      const copy = props.copy || COPY.zh;
      const cellId = typeof props.cellId === 'string' ? props.cellId : CELL;
      const settings = useSettings();

      const translate = (key, params, fallback) => {
        if (!t) return fallback;
        try {
          const value = t(key, params);
          return typeof value === 'string' && value.length > 0 && value !== key ? value : fallback;
        } catch (error) {
          return fallback;
        }
      };

      const sessionKey = typeof props.sessionId === 'string' && props.sessionId ? props.sessionId : 'default';
      const stats = useStats(useChat, useProjection);
      const partial = useChat((state) => (state && state.legacy ? state.legacy.partial : undefined));
      const runningCalls = useChat((state) => (state && state.legacy ? state.legacy.runningCalls : undefined));
      const live = React.useMemo(() => scanPartial(partial), [partial]);
      const sessionRunning = useSession ? useSession((state) => Boolean(state && state.running)) : false;
      const toolsRunning = Array.isArray(runningCalls) && runningCalls.length > 0;
      const running = sessionRunning || live.active;
      /* The dot means "counting right now": thinking or prose, never tools. */
      const counting = live.active && !toolsRunning;

      const liveRef = React.useRef(live);
      liveRef.current = live;
      const statsRef = React.useRef(stats);
      statsRef.current = stats;
      const settingsRef = React.useRef(settings);
      settingsRef.current = settings;
      const sessionRunningRef = React.useRef(sessionRunning);
      sessionRunningRef.current = sessionRunning;
      const toolsRunningRef = React.useRef(toolsRunning);
      toolsRunningRef.current = toolsRunning;
      /* Chars per token, calibrated online (see finalizePending); the seed
       * value only matters before the first step settles. */
      const ratioRef = React.useRef(FALLBACK_CHARS_PER_TOKEN);
      const pendingRef = React.useRef(null);

      const readCached = (pick) => {
        const cached = loadSessionTrail(sessionKey);
        return pick(cached);
      };
      const [reading, setReading] = React.useState(() => {
        const speed = readCached((cached) => cached.speed);
        return typeof speed === 'number' ? speed : null;
      });
      const [trail, setTrail] = React.useState(() => {
        const points = readCached((cached) => cached.trail);
        return Array.isArray(points) ? points.slice() : [];
      });
      const trailRef = React.useRef(trail);
      const readingRef = React.useRef(reading);
      const sessionKeyRef = React.useRef(sessionKey);

      /* Step finished settling: pair the streamed characters of the step that
       * just closed with the output tokens the stats gained meanwhile, and
       * fold the measured ratio into an average. Keeps CJK-heavy turns honest
       * (roughly one token per hanzi) instead of trusting the seed blindly. */
      const finalizePending = () => {
        const pending = pendingRef.current;
        if (!pending || !(pending.chars > 0)) {
          pendingRef.current = null;
          return;
        }
        const total = statsRef.current;
        const have = total && typeof total.decodeTokens === 'number' ? total.decodeTokens : 0;
        const gained = have - pending.startTokens;
        if (!(gained > 0)) return; // settled usage not visible yet; retry later
        pendingRef.current = null;
        const measured = pending.chars / gained;
        if (!isFinite(measured) || measured < RATIO_MIN || measured > RATIO_MAX) return;
        const previous = ratioRef.current;
        ratioRef.current = previous > 0 ? previous * 0.5 + measured * 0.5 : measured;
      };

      React.useEffect(() => {
        if (!running) return undefined;
        finalizePending();
        const samples = [];
        const windowMs = settings.windowMs;
        let stepChars = 0;
        let lastChars = 0;
        let gapped = false;
        const total = statsRef.current;
        let startTokens = total && typeof total.decodeTokens === 'number' ? total.decodeTokens : 0;
        const parkStep = () => {
          if (!(stepChars > 0)) return;
          const kept = pendingRef.current;
          pendingRef.current = {
            chars: (kept ? kept.chars : 0) + stepChars,
            startTokens: kept ? Math.min(kept.startTokens, startTokens) : startTokens,
          };
        };
        const tick = () => {
          const now = Date.now();
          const snap = liveRef.current;
          /* Tool phase (or a gap between steps): record nothing, so the curve
           * only ever reflects thinking and prose output. */
          if (!snap.active || toolsRunningRef.current) {
            gapped = true;
            return;
          }
          const chars = snap.chars;
          if (gapped) {
            /* Blind gap behind us: restart the window so the gap cannot dilute
             * the next point, and never attribute unseen growth. */
            gapped = false;
            samples.length = 0;
            if (chars < lastChars) {
              /* a new step started while we weren't watching */
              parkStep();
              const current = statsRef.current;
              startTokens = current && typeof current.decodeTokens === 'number' ? current.decodeTokens : 0;
              stepChars = 0;
            }
            lastChars = chars;
          } else if (chars < lastChars) {
            /* a new step started mid-effect: park the finished one */
            parkStep();
            const current = statsRef.current;
            startTokens = current && typeof current.decodeTokens === 'number' ? current.decodeTokens : 0;
            stepChars = 0;
          }
          stepChars += Math.max(0, chars - lastChars);
          lastChars = chars;
          samples.push({ t: now, chars: chars });
          const cutoff = now - windowMs;
          let baseline = samples[0];
          for (let index = 0; index < samples.length; index += 1) {
            if (samples[index].t <= cutoff) baseline = samples[index];
          }
          while (samples.length > 2 && samples[1].t <= cutoff) samples.shift();
          const span = (now - baseline.t) / 1e3;
          if (!(span > 0.02)) return;
          const delta = Math.max(0, chars - baseline.chars);
          const tps = delta / span / ratioRef.current;
          if (!isFinite(tps) || tps < 0) return;
          readingRef.current = tps;
          setReading(tps);
          const next = trailRef.current.concat([tps]).slice(-TRAIL_POINTS);
          trailRef.current = next;
          setTrail(next);
        };
        const timer = setInterval(tick, settings.intervalMs);
        return () => {
          clearInterval(timer);
          parkStep();
          finalizePending();
          /* The stream really ended (not a settings reshuffle mid-stream):
           * drop the last few samples so a final dribble of tokens occupying
           * a lone window never freezes as the reading. */
          const ended = !liveRef.current.active && !sessionRunningRef.current;
          if (ended) {
            const drop = settingsRef.current.tailDrop;
            if (typeof drop === 'number' && drop > 0 && trailRef.current.length > 0) {
              const kept = trailRef.current.slice(0, Math.max(0, trailRef.current.length - Math.floor(drop)));
              trailRef.current = kept;
              setTrail(kept);
              const last = kept.length > 0 ? kept[kept.length - 1] : null;
              readingRef.current = last;
              setReading(last);
            }
          }
        };
      }, [running, settings.intervalMs, settings.windowMs]);

      /* Per-session curve: park this session when the dock moves on, restore
       * the parked curve when it comes back. */
      React.useEffect(() => {
        const previous = sessionKeyRef.current;
        if (previous !== sessionKey) {
          saveSessionTrail(previous, { trail: trailRef.current, speed: readingRef.current });
          const loaded = loadSessionTrail(sessionKey);
          trailRef.current = Array.isArray(loaded.trail) ? loaded.trail.slice() : [];
          readingRef.current = typeof loaded.speed === 'number' ? loaded.speed : null;
          setTrail(trailRef.current);
          setReading(readingRef.current);
          sessionKeyRef.current = sessionKey;
        }
      }, [sessionKey]);

      /* Park the curve when the dock itself unmounts (reload, HMR, ...). */
      React.useEffect(
        () => () => {
          saveSessionTrail(sessionKeyRef.current, {
            trail: trailRef.current,
            speed: readingRef.current,
          });
        },
        []
      );

      /* Two different numbers: the ceiling the box is scaled to (recent window,
       * never drawn) and the true peak of the visible curve (reported). */
      const ceiling = scalePeak(trail, settings.peakWindow);
      const peak = trail.length > 0 ? Math.max.apply(null, trail) : 0;

      const [open, setOpen] = React.useState(false);
      const rootRef = React.useRef(null);

      React.useEffect(() => {
        if (!open) return undefined;
        const onPointer = (event) => {
          if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
        };
        const onKey = (event) => {
          if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('pointerdown', onPointer, true);
        document.addEventListener('keydown', onKey);
        return () => {
          document.removeEventListener('pointerdown', onPointer, true);
          document.removeEventListener('keydown', onKey);
        };
      }, [open]);

      if (stats.steps === 0) return null;

      /* Live window reading while a step streams; when idle, the cached last
       * value of this session's trail stands in, then the settled whole-turn
       * average of the previous turn. */
      const settledSpeed = stats.decodeMs > 0 ? stats.decodeTokens / (stats.decodeMs / 1e3) : null;
      /* Idle display: live/frozen end value first, then the cached last value
       * from this session's trail, then the whole-turn average. A dash only
       * appears when nothing was ever measured. */
      const cachedSpeed = loadSessionTrail(sessionKey).speed;
      const displaySpeed = reading !== null
        ? reading
        : (typeof cachedSpeed === 'number' ? cachedSpeed : settledSpeed);

      const speedText = formatSpeed(displaySpeed) || copy.empty;
      const counts = translate('stats.counts', { turns: stats.turns, steps: stats.steps }, copy.counts(stats.turns, stats.steps));
      const title = translate('stats.dialog.title', undefined, copy.title);
      const ariaLabel = speedText + ' tok/s · ' + counts;

      const rows = [];
      if (stats.llmMs > 0) rows.push(h('dt', { key: 'dt-llm' }, translate('stats.dialog.llmTime', undefined, copy.llmTime)), h('dd', { key: 'dd-llm' }, formatDuration(stats.llmMs, translate)));
      if (stats.toolMs > 0) rows.push(h('dt', { key: 'dt-tool' }, translate('stats.dialog.toolTime', undefined, copy.toolTime)), h('dd', { key: 'dd-tool' }, formatDuration(stats.toolMs, translate)));
      if (stats.ttftSteps > 0) rows.push(h('dt', { key: 'dt-ttft' }, translate('stats.dialog.ttft', undefined, copy.ttft)), h('dd', { key: 'dd-ttft' }, formatDuration(stats.ttftMs / stats.ttftSteps, translate)));
      rows.push(h('dt', { key: 'dt-speed' }, translate('stats.dialog.speed', undefined, copy.speed)), h('dd', { key: 'dd-speed' }, speedText + ' ' + copy.unit));
      if (trail.length > 1) rows.push(h('dt', { key: 'dt-peak' }, translate('stats.dialog.peak', undefined, copy.peak)), h('dd', { key: 'dd-peak' }, (formatSpeed(peak) || copy.empty) + ' ' + copy.unit));
      rows.push(h('dt', { key: 'dt-sample' }, copy.sample), h('dd', { key: 'dd-sample' }, settings.intervalMs + ' ' + copy.ms));
      rows.push(h('dt', { key: 'dt-window' }, copy.window), h('dd', { key: 'dd-window' }, settings.windowMs + ' ' + copy.ms));

      return h(
        React.Fragment,
        null,
        h('style', { key: 'css', 'data-speed-anchor-css': '' }, CSS),
        h(
          'span',
          { key: 'anchor', ref: rootRef, className: 'dsa-anchor', 'data-composer-stat': cellId, 'data-dsa': '1' },
          h(
            'button',
            {
              type: 'button',
              className: 'dsa-pill',
              'aria-haspopup': 'dialog',
              'aria-expanded': open,
              'aria-label': ariaLabel,
              onClick: () => setOpen((value) => !value),
            },
            h(Spark, { points: trail, peak: ceiling }),
            h('span', { className: 'dsa-value' }, speedText),
            h('span', { className: 'dsa-unit' }, copy.unit),
            h('i', { className: 'dsa-live', 'data-live': counting ? '' : undefined, 'aria-hidden': true })
          ),
          open
            ? h(
                'div',
                { className: 'dsa-panel', role: 'dialog', 'aria-label': title },
                h('div', { className: 'dsa-title' }, h('span', null, title), h('span', { className: 'dsa-title-value' }, counts)),
                h('div', { className: 'dsa-rule', 'aria-hidden': true }),
                h('dl', { className: 'dsa-rows', 'data-session-stats-details': '' }, rows)
              )
            : null
        )
      );
    }

    /* ------------------------------------------------------------------ settings page */

    function SpeedSettings(props) {
      const copy = props.copy || COPY.zh;
      const [saved, setSaved] = React.useState(readSettings);
      const [draft, setDraft] = React.useState(saved);
      const [status, setStatus] = React.useState(null);

      React.useEffect(() => subscribeSettings(setSaved), []);

      const field = (key, label, hint) => {
        const bounds = SETTING_BOUNDS[key];
        const value = draft[key];
        const invalid = typeof value !== 'number' || !isFinite(value) || value < bounds[0] || value > bounds[1];
        return h(
          'label',
          { className: 'dsa-field', key: key },
          h('span', { className: 'dsa-field-label' }, label),
          h('input', {
            className: 'dsa-field-input',
            type: 'number',
            min: bounds[0],
            max: bounds[1],
            step: SETTING_STEPS[key] || 1,
            value: typeof value === 'number' && isFinite(value) ? String(value) : '',
            'aria-invalid': invalid,
            onChange: (event) => {
              const raw = Number(event.target.value);
              setDraft((previous) => Object.assign({}, previous, { [key]: event.target.value === '' ? '' : raw }));
              setStatus(null);
            },
          }),
          h('span', { className: 'dsa-hint' }, hint)
        );
      };

      const onSave = () => {
        const next = writeSettings(draft);
        setDraft(next);
        setSaved(next);
        setStatus({ ok: true, text: copy.saved });
      };

      const onReset = () => {
        const next = writeSettings(DEFAULT_SETTINGS);
        setDraft(next);
        setSaved(next);
        setStatus({ ok: true, text: copy.saved });
      };

      const preview = copy.settingsPreview(saved.intervalMs, saved.windowMs, saved.tailDrop, saved.peakWindow);

      return h(
        'div',
        { className: 'dsa-section' },
        h('style', { 'data-speed-anchor-css': '' }, CSS),
        h('h2', { className: 'dsa-section-title' }, copy.settingsTitle),
        h('p', { className: 'dsa-section-intro' }, copy.settingsIntro),
        field('intervalMs', copy.intervalLabel, copy.intervalHint),
        field('windowMs', copy.windowLabel, copy.windowHint),
        field('tailDrop', copy.tailLabel, copy.tailHint),
        field('peakWindow', copy.peakLabel, copy.peakHint),
        h('p', { className: 'dsa-hint' }, preview),
        h(
          'div',
          { className: 'dsa-actions' },
          h('button', { type: 'button', className: 'dsa-btn dsa-btn-primary', onClick: onSave }, copy.save),
          h('button', { type: 'button', className: 'dsa-btn', onClick: onReset }, copy.reset),
          status ? h('span', { className: 'dsa-status', 'data-warn': status.ok ? undefined : '' }, status.text) : null
        )
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const locale = ctx.get ? ctx.get('locale') : undefined;
        let language = 'zh';
        try {
          const snapshot = locale && locale.getSnapshot ? locale.getSnapshot() : null;
          if (snapshot && snapshot.active === 'en') language = 'en';
        } catch (error) {
          language = 'zh';
        }
        const copy = COPY[language] || COPY.zh;
        const navLabel = () => copy.settingsNav;

        const slots = ctx.slots;
        if (!slots) return;

        const guard = (label, run) => {
          try {
            run();
          } catch (error) {
            console.warn('[dsh-speed-anchor] ' + label + ' registration failed', error);
          }
        };

        guard('speed anchor', () => {
          slots.inject(SLOT, () =>
            slots.register({ name: SLOT, id: CELL, order: ORDER, label: () => 'Token speed' }, (props) =>
              h(SpeedAnchor, Object.assign({}, props, { cellId: CELL, copy: copy }))
            )
          );
        });

        guard('settings page', () => {
          slots.inject(SETTINGS_SLOT, () =>
            slots.register({ name: SETTINGS_SLOT, id: SETTINGS_ID, order: SETTINGS_ORDER, label: navLabel }, (props) =>
              h(SpeedSettings, Object.assign({}, props, { copy: copy }))
            )
          );
        });
      },
    };
  },
});
