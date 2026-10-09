"use strict";
(() => {
  // src/runtime/dom.ts
  function waitFor(selector, timeoutMs = 3e4, root = document) {
    const existing = root.querySelector(selector);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearTimeout(timer);
        resolve(value);
      };
      const observer = new MutationObserver(() => {
        const found = root.querySelector(selector);
        if (found) finish(found);
      });
      observer.observe(root === document ? document.documentElement ?? document : root, {
        childList: true,
        subtree: true
      });
      const timer = setTimeout(() => finish(null), timeoutMs);
    });
  }
  var REMOUNT_LIMIT = 25;
  var REMOUNT_WINDOW_MS = 2e3;
  var mountCounts = /* @__PURE__ */ new Map();
  function keepMounted(containerSelector, nodeId, factory, options = {}) {
    const { position = "append", before } = typeof options === "string" ? { position: options, before: void 0 } : options;
    let disposed = false;
    let attempts = [];
    const countAttempt = () => {
      const now = Date.now();
      attempts = attempts.filter((t) => now - t < REMOUNT_WINDOW_MS);
      attempts.push(now);
      if (attempts.length <= REMOUNT_LIMIT) return true;
      disposed = true;
      observer.disconnect();
      console.error(
        `[betterslack] giving up on "${nodeId}": it moved or was re-added ${attempts.length} times in ${REMOUNT_WINDOW_MS}ms, so something else owns "${containerSelector}". Anchor it with \`before\` or pick another container.`
      );
      document.getElementById(nodeId)?.remove();
      return false;
    };
    const mount = () => {
      if (disposed) return;
      if (!globalThis.document) return;
      const container = document.querySelector(containerSelector);
      if (!container) return;
      const anchor = before ? container.querySelector(before) : null;
      const current = document.getElementById(nodeId);
      if (current && container.contains(current)) {
        const misplaced = anchor !== null && anchor !== current && (current.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING) === 0;
        if (misplaced && countAttempt()) anchor.before(current);
        return;
      }
      if (!countAttempt()) return;
      mountCounts.set(nodeId, (mountCounts.get(nodeId) ?? 0) + 1);
      current?.remove();
      const node = factory();
      node.id = nodeId;
      if (anchor) anchor.before(node);
      else if (position === "prepend") container.prepend(node);
      else container.append(node);
    };
    mount();
    const observer = new MutationObserver(() => mount());
    observer.observe(document.documentElement, { childList: true, subtree: true });
    return () => {
      disposed = true;
      observer.disconnect();
      document.getElementById(nodeId)?.remove();
    };
  }
  function onEach(selector, handler) {
    const seen = /* @__PURE__ */ new WeakSet();
    const scan = () => {
      for (const element of document.querySelectorAll(selector)) {
        if (seen.has(element)) continue;
        seen.add(element);
        try {
          handler(element);
        } catch (err) {
          console.error("[betterslack] onEach handler threw", err);
        }
      }
    };
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    return () => observer.disconnect();
  }
  function onShortcut(match, handler) {
    const listener = (event) => {
      if (!match(event)) return;
      event.preventDefault();
      event.stopPropagation();
      handler(event);
    };
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }
  function h(tag, attrs = {}, children = []) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === "class") element.className = value;
      else element.setAttribute(key, value);
    }
    for (const child of children) {
      element.append(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return element;
  }

  // src/runtime/i18n.ts
  function detectLocale() {
    const declared = document.documentElement?.getAttribute("lang");
    if (declared && declared.trim()) return declared.trim();
    return navigator.language || "en";
  }
  function interpolate(text, vars) {
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, (whole, name) => name in vars ? String(vars[name]) : whole);
  }
  function createI18n(locale = detectLocale()) {
    const language = locale.split(/[-_]/)[0].toLowerCase();
    return {
      locale,
      language,
      strings(tables) {
        const exact = tables[locale] ?? tables[locale.replace("_", "-")];
        const byLanguage = tables[language];
        return (key, vars) => {
          const value = exact?.[key] ?? byLanguage?.[key] ?? tables.en[key];
          return interpolate(value ?? key, vars);
        };
      }
    };
  }

  // src/runtime/mrkdwn.ts
  var MRKDWN_CLASS = {
    mention: "betterslack-mention",
    link: "betterslack-link",
    code: "betterslack-code",
    emoji: "betterslack-emoji",
    quote: "betterslack-quote"
  };
  var TOKEN = /<([^>]+)>|:([a-z0-9_+'-]+(?:::skin-tone-\d)?):/gi;
  var EMPHASIS = /\*(\S(?:[^*]*\S)?)\*|`([^`]+)`|~(\S(?:[^~]*\S)?)~/g;
  function renderMrkdwn(text, options = {}) {
    const doc = options.doc ?? document;
    const out = doc.createDocumentFragment();
    const budget = { left: options.maxLength ?? Infinity };
    const source2 = String(text ?? "");
    let at = 0;
    TOKEN.lastIndex = 0;
    let match = TOKEN.exec(source2);
    while (match && budget.left > 0) {
      emphasis(source2.slice(at, match.index), out, doc, options, budget);
      if (match[2]) emoji(match[2], out, doc, options, budget);
      else bracketed(match[1] ?? "", out, doc, options, budget);
      at = match.index + match[0].length;
      match = TOKEN.exec(source2);
    }
    if (budget.left > 0) emphasis(source2.slice(at), out, doc, options, budget);
    return out;
  }
  function bracketed(inner, into, doc, options, budget) {
    const cut = inner.indexOf("|");
    const target = cut === -1 ? inner : inner.slice(0, cut);
    const label = cut === -1 ? null : inner.slice(cut + 1);
    if (target.startsWith("@")) {
      const id = target.slice(1);
      write(into, span(doc, MRKDWN_CLASS.mention, `@${label || options.userName?.(id) || id}`), budget);
      return;
    }
    if (target.startsWith("#")) {
      const id = target.slice(1);
      const name = `#${label || options.channelName?.(id) || id}`;
      if (!options.onChannel) {
        write(into, span(doc, MRKDWN_CLASS.mention, name), budget);
        return;
      }
      const button2 = doc.createElement("button");
      button2.type = "button";
      button2.className = `c-button-unstyled ${MRKDWN_CLASS.mention}`;
      button2.textContent = name;
      button2.addEventListener("click", () => options.onChannel?.(id));
      write(into, button2, budget);
      return;
    }
    if (target.startsWith("!")) {
      const name = label || target.slice(1).split("^")[0] || "here";
      write(into, span(doc, MRKDWN_CLASS.mention, name.startsWith("@") ? name : `@${name}`), budget);
      return;
    }
    const named = label && label.trim() && label.trim() !== target ? label.trim() : null;
    const shown = named ?? (options.shortLinks ? hostOf(target) : target);
    if (!options.onLink) {
      write(into, span(doc, MRKDWN_CLASS.link, shown), budget);
      return;
    }
    const button = doc.createElement("button");
    button.type = "button";
    button.className = `c-button-unstyled ${MRKDWN_CLASS.link}`;
    button.title = target;
    button.textContent = shown;
    button.addEventListener("click", () => options.onLink?.(target));
    write(into, button, budget);
  }
  function emphasis(text, into, doc, options, budget) {
    const source2 = tidy(unescape(text), options);
    let at = 0;
    EMPHASIS.lastIndex = 0;
    let match = EMPHASIS.exec(source2);
    while (match && budget.left > 0) {
      plain(source2.slice(at, match.index), into, doc, budget);
      const [tag, inner] = match[1] !== void 0 ? ["b", match[1]] : match[2] !== void 0 ? ["code", match[2]] : ["s", match[3] ?? ""];
      const node = doc.createElement(tag ?? "span");
      if (tag === "code") node.className = MRKDWN_CLASS.code;
      node.append(clip(inner ?? "", budget));
      into.append(node);
      at = match.index + match[0].length;
      match = EMPHASIS.exec(source2);
    }
    if (budget.left > 0) plain(source2.slice(at), into, doc, budget);
  }
  function emoji(name, into, doc, options, budget) {
    const url = options.emojiUrl?.(name) ?? null;
    if (!url) {
      plain(`:${name}:`, into, doc, budget);
      return;
    }
    const image = doc.createElement("img");
    image.className = MRKDWN_CLASS.emoji;
    image.src = url;
    image.alt = `:${name}:`;
    image.title = `:${name}:`;
    into.append(image);
    budget.left -= 2;
  }
  function span(doc, className, text) {
    const node = doc.createElement("span");
    node.className = className;
    node.textContent = text;
    return node;
  }
  function write(into, node, budget) {
    into.append(node);
    budget.left -= node.textContent?.length ?? 0;
  }
  function plain(text, into, doc, budget) {
    if (!text) return;
    into.append(doc.createTextNode(clip(text, budget)));
  }
  function clip(text, budget) {
    if (budget.left === Infinity) return text;
    const kept = text.slice(0, Math.max(0, budget.left));
    budget.left -= text.length;
    return kept;
  }
  function tidy(text, options) {
    if (!options.oneLine) return text;
    return text.replace(/(^|\s)>+(\s|$)/g, " ").replace(/\s+/g, " ");
  }
  function unescape(text) {
    return String(text ?? "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  }
  function hostOf(url) {
    const match = /^https?:\/\/([^/]+)/i.exec(String(url ?? ""));
    return match?.[1] ? match[1].replace(/^www\./, "") : String(url ?? "");
  }

  // src/runtime/ui/tooltip.ts
  var SHOW_DELAY_MS = 150;
  var EDGE_OVERLAP = 4;
  var VIEWPORT_MARGIN = 8;
  var attached = /* @__PURE__ */ new WeakMap();
  function attachTooltip(trigger, options) {
    attached.get(trigger)?.();
    const { title, subtitle, placement = "right", delayMs = SHOW_DELAY_MS, icon } = options;
    trigger.removeAttribute("title");
    const lines = (subtitle === void 0 ? [] : [subtitle].flat()).filter((line) => line !== "");
    trigger.setAttribute("aria-label", [title, ...lines].join(". "));
    let layer = null;
    let timer;
    const build = () => {
      const heading = icon ? h("div", { class: "betterslack-tooltip__heading" }, [
        h("span", { class: "betterslack-tooltip__icon" }, [icon.cloneNode(true)]),
        h("span", {}, [title])
      ]) : h("div", {}, [title]);
      const tip = h("div", {
        // `--large` rather than `--small`, which is not a class Slack styles at
        // all: the only rule either of them has is `--large { max-width: 400px }`,
        // and without it a long status ran off the edge of the window in one line
        // where Slack's own tooltip wraps. Read out of the live stylesheet.
        class: `c-tooltip__tip c-tooltip__tip--${placement} c-tooltip__tip--large`,
        "data-qa": "tooltip-tip",
        "data-sk": "tooltip"
      }, [heading]);
      for (const line of lines) tip.append(h("div", { class: "c-tooltip__subtitle" }, [line]));
      tip.append(h("div", { class: "c-tooltip__tip__arrow", "data-qa": "tooltip-tip-arrow" }));
      return h("div", {
        class: "betterslack-tooltip",
        role: "tooltip",
        "data-qa": "tooltip-popover",
        style: "position: fixed; top: 0; left: 0; z-index: 1001; pointer-events: none; will-change: transform; transition: opacity 80ms ease;"
      }, [h("div", { role: "presentation" }, [tip])]);
    };
    const position = (node) => {
      const t = trigger.getBoundingClientRect();
      const { width: w, height: hgt } = node.getBoundingClientRect();
      let left;
      let top;
      switch (placement) {
        case "left":
          left = t.left - w + EDGE_OVERLAP;
          top = t.top + t.height / 2 - hgt / 2;
          break;
        case "top":
          left = t.left + t.width / 2 - w / 2;
          top = t.top - hgt + EDGE_OVERLAP;
          break;
        case "bottom":
          left = t.left + t.width / 2 - w / 2;
          top = t.bottom - EDGE_OVERLAP;
          break;
        default:
          left = t.right - EDGE_OVERLAP;
          top = t.top + t.height / 2 - hgt / 2;
      }
      left = Math.min(Math.max(left, VIEWPORT_MARGIN), window.innerWidth - w - VIEWPORT_MARGIN);
      top = Math.min(Math.max(top, VIEWPORT_MARGIN), window.innerHeight - hgt - VIEWPORT_MARGIN);
      node.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
    };
    const show = () => {
      if (layer || !trigger.isConnected) return;
      layer = build();
      document.addEventListener("keydown", onKeyDown, true);
      window.addEventListener("scroll", onLeave, true);
      window.addEventListener("resize", onLeave);
      layer.style.visibility = "hidden";
      document.body.append(layer);
      position(layer);
      layer.style.visibility = "";
    };
    const hide = () => {
      clearTimeout(timer);
      timer = void 0;
      if (layer) {
        document.removeEventListener("keydown", onKeyDown, true);
        window.removeEventListener("scroll", onLeave, true);
        window.removeEventListener("resize", onLeave);
      }
      layer?.remove();
      layer = null;
    };
    const scheduleShow = (immediate = false) => {
      if (layer) return;
      clearTimeout(timer);
      timer = setTimeout(show, immediate ? 0 : delayMs);
    };
    const onEnter = () => scheduleShow();
    const onLeave = () => hide();
    const onFocus = (event) => {
      if (trigger.matches(":focus-visible")) scheduleShow(true);
      else ;
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") hide();
    };
    trigger.addEventListener("mouseenter", onEnter);
    trigger.addEventListener("mouseleave", onLeave);
    trigger.addEventListener("mousedown", onLeave);
    trigger.addEventListener("click", onLeave);
    trigger.addEventListener("focus", onFocus);
    trigger.addEventListener("blur", onLeave);
    const detach = () => () => {
      hide();
      trigger.removeEventListener("mouseenter", onEnter);
      trigger.removeEventListener("mouseleave", onLeave);
      trigger.removeEventListener("mousedown", onLeave);
      trigger.removeEventListener("click", onLeave);
      trigger.removeEventListener("focus", onFocus);
      trigger.removeEventListener("blur", onLeave);
      if (attached.get(trigger) === cleanup) attached.delete(trigger);
    };
    const cleanup = detach();
    attached.set(trigger, cleanup);
    return cleanup;
  }

  // src/runtime/ui/code.ts
  var ESCAPES = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;"
  };
  function escape(text) {
    return text.replace(/[&<>]/g, (char) => ESCAPES[char]);
  }
  function tokenizeCss(source2) {
    const tokens = [];
    let index = 0;
    let afterColon = false;
    const blocks = [];
    let atRule = null;
    const NESTS_RULES = /^@(media|supports|layer|container|document|scope)$/;
    const inBlock = () => blocks[blocks.length - 1] === "declarations";
    const push = (kind, text) => {
      if (text) tokens.push({ kind, text });
    };
    while (index < source2.length) {
      const rest = source2.slice(index);
      if (rest.startsWith("/*")) {
        const end = source2.indexOf("*/", index + 2);
        const stop = end === -1 ? source2.length : end + 2;
        push("comment", source2.slice(index, stop));
        index = stop;
        continue;
      }
      const char = rest[0];
      if (/\s/.test(char)) {
        const match = /^\s+/.exec(rest);
        push("space", match[0]);
        index += match[0].length;
        continue;
      }
      if (char === '"' || char === "'") {
        const match = new RegExp(`^${char}(?:\\\\.|[^${char}\\\\\\n])*${char}?`).exec(rest);
        const text = match ? match[0] : char;
        push("string", text);
        index += text.length;
        continue;
      }
      if (char === "{") {
        blocks.push(atRule && NESTS_RULES.test(atRule) ? "rules" : "declarations");
        atRule = null;
        afterColon = false;
        push("punct", char);
        index += 1;
        continue;
      }
      if (char === "}") {
        blocks.pop();
        atRule = null;
        afterColon = false;
        push("punct", char);
        index += 1;
        continue;
      }
      if (char === ":" && inBlock()) {
        afterColon = true;
        push("punct", char);
        index += 1;
        continue;
      }
      if (char === ";") {
        afterColon = false;
        atRule = null;
        push("punct", char);
        index += 1;
        continue;
      }
      if (char === "@") {
        const match = /^@[\w-]+/.exec(rest);
        atRule = match[0];
        push("at", match[0]);
        index += match[0].length;
        continue;
      }
      if (rest.startsWith("--") && (inBlock() || afterColon)) {
        const match = /^--[\w-]+/.exec(rest);
        push(afterColon ? "value" : "property", match[0]);
        index += match[0].length;
        continue;
      }
      if (char === "#" && /^#[0-9a-fA-F]{3,8}\b/.test(rest)) {
        const match = /^#[0-9a-fA-F]{3,8}/.exec(rest);
        push("colour", match[0]);
        index += match[0].length;
        continue;
      }
      if (/^-?(?:\d+\.?\d*|\.\d+)[\w%]*/.test(rest)) {
        const match = /^-?(?:\d+\.?\d*|\.\d+)[\w%]*/.exec(rest);
        push("number", match[0]);
        index += match[0].length;
        continue;
      }
      if (/[\w-]/.test(char)) {
        const match = /^[\w-]+/.exec(rest);
        const word = match[0];
        if (!inBlock()) push("selector", word);
        else if (afterColon) push(/^!?important$/i.test(word) ? "important" : "value", word);
        else push("property", word);
        index += word.length;
        continue;
      }
      if (char === "!") {
        const match = /^!\s*important/i.exec(rest);
        if (match) {
          push("important", match[0]);
          index += match[0].length;
          continue;
        }
      }
      push(inBlock() ? "punct" : "selector", char);
      index += 1;
    }
    return tokens;
  }
  function highlightCss(source2) {
    return tokenizeCss(source2).map(({ kind, text }) => kind === "space" ? escape(text) : `<span class="sm-tok-${kind}">${escape(text)}</span>`).join("");
  }
  function createCodeEditor(doc, options = {}) {
    const wrap = doc.createElement("div");
    wrap.className = "sm-code";
    if (options.rows) wrap.style.setProperty("--sm-code-rows", String(options.rows));
    const paint = doc.createElement("pre");
    paint.className = "sm-code__paint";
    paint.setAttribute("aria-hidden", "true");
    const area = doc.createElement("textarea");
    area.className = "sm-code__input";
    area.spellcheck = false;
    area.value = options.value ?? "";
    if (options.placeholder) area.placeholder = options.placeholder;
    if (options.readOnly) area.readOnly = true;
    area.setAttribute("autocapitalize", "off");
    area.setAttribute("autocomplete", "off");
    const draw = () => {
      paint.innerHTML = `${highlightCss(area.value)}
`;
    };
    area.addEventListener("input", () => {
      draw();
      options.onChange?.(area.value);
    });
    area.addEventListener("scroll", () => {
      paint.scrollTop = area.scrollTop;
      paint.scrollLeft = area.scrollLeft;
    });
    area.addEventListener("keydown", (event) => {
      if (event.key !== "Tab" || event.shiftKey) return;
      event.preventDefault();
      const { selectionStart, selectionEnd, value } = area;
      area.value = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
      area.selectionStart = area.selectionEnd = selectionStart + 2;
      draw();
      options.onChange?.(area.value);
    });
    wrap.append(paint, area);
    draw();
    return {
      node: wrap,
      value: () => area.value,
      set(value) {
        area.value = value;
        draw();
      },
      focus: () => area.focus()
    };
  }
  var CODE_CSS = `
.sm-code {
  position: relative;
  border-radius: 6px;
  border: 1px solid var(--sm-line, rgba(255, 255, 255, .13));
  background: var(--sm-bg, transparent);
  overflow: hidden;
}
.sm-code:focus-within {
  border-color: var(--sm-focus, #1264a3);
  box-shadow: 0 0 0 1px var(--sm-focus, #1264a3);
}
/* Every metric set on one is set on the other, or the caret drifts away from
   the text as you type. That is the whole trick. */
.sm-code__paint,
.sm-code__input {
  margin: 0;
  padding: 10px 12px;
  border: 0;
  font: 13px/1.6 var(--sm-mono, Monaco, Menlo, Consolas, monospace);
  tab-size: 2;
  white-space: pre;
  overflow-wrap: normal;
  word-break: normal;
  min-height: calc(var(--sm-code-rows, 12) * 1.6em + 20px);
}
.sm-code__paint {
  position: absolute;
  inset: 0;
  overflow: auto;
  pointer-events: none;
  color: var(--sm-text, inherit);
}
.sm-code__input {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  resize: vertical;
  background: transparent;
  color: transparent;
  caret-color: var(--sm-bright, #f8f8f8);
  outline: none;
  overflow: auto;
}
.sm-code__input::selection { background: rgba(29, 155, 209, .35); color: transparent; }
.sm-code__input::placeholder { color: var(--sm-muted, #9a9b9d); }

.sm-tok-comment { color: #6b7075; font-style: italic; }
.sm-tok-selector { color: #78c2ff; }
.sm-tok-property { color: #b8bcc0; }
.sm-tok-value { color: inherit; }
.sm-tok-string { color: #7ed492; }
.sm-tok-number { color: #f2a35e; }
.sm-tok-colour { color: #f2a35e; text-decoration: underline dotted rgba(242, 163, 94, .5); }
.sm-tok-at { color: #d78ef7; }
.sm-tok-important { color: var(--sm-danger, #e01e5a); font-weight: 700; }
.sm-tok-punct { color: #7d8286; }
`;

  // src/runtime/ui/styles.ts
  var PANEL_CSS = CODE_CSS + `
/* .c-dialog ships opacity:0 and is faded in by Slack's own transition. */
#betterslack-panel.c-dialog { opacity: 1; }

.betterslack-content {
  display: flex;
  flex-direction: column;
  width: min(880px, calc(100% - 32px));
  max-width: min(880px, calc(100% - 32px));
  height: min(620px, calc(100% - 64px));
  max-height: min(620px, calc(100% - 64px));
  opacity: 1;
}

.betterslack-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px 24px 12px;
}
.betterslack-close { margin-left: auto; flex: 0 0 auto; }

/*
 * The mark beside the title. 10px apart rather than the header's 12, because
 * this is a lockup and the header's gap is the distance to the close button.
 *
 * The SVG carries no width or height of its own -- it is one drawing used at
 * four sizes -- so an intrinsic-size fallback of 300x150 is what an unsized one
 * lays out at, in this dialog exactly as in the rail.
 */
.betterslack-brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
.betterslack-brand__mark { display: flex; flex: 0 0 auto; }
.betterslack-brand__mark svg { width: 24px; height: 24px; display: block; }

.betterslack-layout { display: flex; flex: 1; min-height: 0; }

/* Left rail, in the shape Slack's Preferences dialog uses. */
.betterslack-nav {
  flex: 0 0 176px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 8px 16px 16px;
  overflow-y: auto;
}
.betterslack-nav__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 15px;
  line-height: 1.46667;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1);
  text-align: left;
  cursor: pointer;
}
.betterslack-nav__item:hover { background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.08); }
.betterslack-nav__item[aria-selected="true"] {
  background: rgba(var(--sk_highlight, 18, 100, 163), 1);
  color: rgba(var(--sk_primary_background, 255, 255, 255), 1);
  font-weight: var(--custom-font-weight-bold, 700);
}
.betterslack-nav__item[aria-selected="true"] .betterslack-count {
  background: rgba(255, 255, 255, 0.24);
  color: inherit;
}

/*
 * The update dot on a tab. Slack's own unread colour, at the size Slack draws
 * an unread dot in the sidebar, so it reads as one thing the app is telling you
 * rather than as a mark BetterSlack invented.
 */
.betterslack-nav__dot {
  /* No margin: the nav item is a flex row with a gap, and adding one on top of
     it spaced the dot further from its label than the pill on the right. */
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(var(--sk_highlight_accent, 224, 30, 90), 1);
}
/* The selected tab is painted in the highlight blue, where the accent red is
   the one colour that disappears into it. */
.betterslack-nav__item[aria-selected="true"] .betterslack-nav__dot {
  background: rgba(var(--sk_primary_background, 255, 255, 255), 1);
}

.betterslack-count {
  margin-left: auto;
  min-width: 20px;
  padding: 0 6px;
  border-radius: 999px;
  font-size: 12px;
  line-height: 18px;
  text-align: center;
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.12);
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.7);
}

.betterslack-body { flex: 1; min-width: 0; padding-bottom: 20px; }

/* How BetterSlack's own interface moves, inside the client.
 *
 * The same six tokens api.ui.kit declares for the documents a mod opens, with
 * the same defaults, so the app and the components it hands out share one
 * tempo. Declared on :root and not on the elements that read them, which is
 * what lets a mod override them from html.<its-class> -- a rule on the element
 * itself would outrank anything inherited and the dials would do nothing.
 */
:root {
  --sm-motion-base: 200ms;
  --sm-motion-ease: cubic-bezier(.2, .9, .25, 1);
  --sm-motion-shift: 8px;
}

/* Reduced motion drops the travel and keeps the fade, which is what it asks
 * for. Also on :root, and for the same reason: someone who installs a motion
 * mod and tells it to animate anyway has said what they want, and that has to
 * be able to win.
 */
@media (prefers-reduced-motion: reduce) {
  :root { --sm-motion-shift: 0px; }
}

/* Switching tab.
 *
 * Stamped by panel.ts, and only when the tab really changed: the panel rebuilds
 * itself on every change and one toggle causes several renders in a frame, so a
 * rule that fired on mount alone would flicker instead of transition.
 */
@keyframes betterslack-tab-enter {
  from { opacity: 0; transform: translateX(var(--sm-motion-shift)); }
  to { opacity: 1; transform: none; }
}
.betterslack-body--enter {
  animation: betterslack-tab-enter var(--sm-motion-base) var(--sm-motion-ease);
}

.betterslack-toolbar {
  position: sticky;
  top: 0;
  z-index: 1;
  /* A column, not a row.
   *
   * The shelves and the search field shared a line, the field taking whatever
   * the three shelf pills left over. On a narrow dialog that is a stub of an
   * input pinned to the right edge with the tabs crowding it, and on a wide one
   * it is a field stretched across half the dialog for no reason. Measured at
   * 316px against 330px of shelves. Its own line is the same width every time,
   * lines up with the rows underneath, and reads as what it is: a filter on the
   * shelf above it.
   */
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  padding: 12px 0 14px;
  background: rgba(var(--sk_primary_background, 255, 255, 255), 1);
}
.betterslack-shelves { display: flex; gap: 2px; flex-wrap: wrap; }
.betterslack-shelf {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 14px;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.7);
  cursor: pointer;
}
.betterslack-shelf:hover { background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.08); }
.betterslack-shelf[aria-selected="true"] {
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1);
  font-weight: var(--custom-font-weight-bold, 700);
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.12);
}

/*
 * The search field and the sort, on one line.
 *
 * The shelves keep a line of their own -- pills and a field sharing one leaves
 * a stub of an input pinned to the right edge on a narrow dialog. This pairing
 * is the other way round: the sort is as wide as its longest option and never
 * wider, so the field takes the rest and the line reads as one filter bar.
 */
.betterslack-filterbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
/*
 * A basis rather than auto, with wrapping: the dialog is 880px until the window
 * is small, and there it falls back to the viewport less 32px. Given a share of
 * whatever is left, the field became a stub beside a control twice its width --
 * which is the same failure that put the shelves on a line of their own. With a
 * floor of 200px the sort drops to its own line instead when there is no room.
 */
.betterslack-filterbar .betterslack-search { flex: 1 1 200px; min-width: 0; }
.betterslack-filterbar .betterslack-select { flex: 0 0 auto; }

/*
 * What is left to write once Slack's own field is borrowed.
 *
 * Slack's own text input is .c-input_text and its own select is .c-input_select
 * -- a bordered button that opens a menu, never a native dropdown -- so both
 * are borrowed rather than drawn, the way the dialog and the buttons already
 * are. Height, radius, border, background, the 80ms focus transition and every
 * theme come with them.
 *
 * The one thing that has to be undone is the margin: both of Slack's carry
 * 0 0 20px, because in Slack they are form fields stacked in a column, and here
 * they sit on a toolbar.
 */
/*
 * The class is doubled to win, and that is the whole reason.
 *
 * Slack's stylesheet is loaded after BetterSlack's, so a single class ties on
 * specificity and loses on source order -- measured: the field kept the 20px
 * bottom margin .c-input_text gives a form field, which on a toolbar is a gap
 * under the search box and nothing below it.
 */
.betterslack-search.betterslack-search,
.betterslack-select.betterslack-select {
  margin: 0;
  font-family: inherit;
}
.betterslack-search { display: block; width: 100%; min-width: 0; }

/*
 * Focus, without Slack's halo.
 *
 * Slack draws focus as two stacked shadows -- a 1px ring and a 5px spread at
 * 30% opacity -- and sets the border transparent underneath them, so what is
 * left is a soft glow floating where the field's edge was. On a form that is
 * one field at a time it reads as attention; on a toolbar of two controls it
 * reads as a light left on.
 *
 * The border does the work instead: it is already there, it already animates
 * over the same 80ms, and it stays visible for anyone arriving by keyboard --
 * which is the one thing removing a focus indicator may not cost.
 *
 * The class is doubled here for the same reason it is above, and one more: this
 * has to beat Slack's own focus rule, which scores a class and a pseudo-class.
 * No backticks in this file, comments included -- one closes the template
 * literal and the runtime throws at boot with nothing styled to show for it.
 */
.betterslack-search.betterslack-search:focus,
.betterslack-search.betterslack-search:focus-within,
.betterslack-select.betterslack-select:focus,
.betterslack-select.betterslack-select:focus-within {
  box-shadow: none;
  outline: none;
  border-color: rgba(var(--sk_highlight, 18, 100, 163), 1);
}

.betterslack-select {
  /* Slack sets padding 0 on the box and pads the parts inside it instead. */
  gap: 8px;
  padding: 0 8px 0 12px;
  font-size: 15px;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1);
}
.betterslack-select .c-input_select__selected_value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.betterslack-select__chevron { display: flex; flex: 0 0 auto; opacity: 0.7; }
.betterslack-select__chevron svg { width: 16px; height: 16px; display: block; }
/* The CSS box is api.ui's code editor. It brings its own metrics -- the painted
 * copy and the textarea have to agree on every one of them -- so only the
 * colours are set here, from Slack's tokens, which is what makes it follow the
 * theme like the rest of the panel. Written without backticks, as everything in
 * this file must be. */
.sm-code {
  border-color: rgba(var(--sk_foreground_low, 29, 28, 29), 0.3);
  background: rgba(var(--sk_foreground_min, 29, 28, 29), 0.04);
}
.sm-code:focus-within {
  border-color: rgba(var(--sk_highlight, 18, 100, 163), 1);
  box-shadow: 0 0 0 1px rgba(var(--sk_highlight, 18, 100, 163), 1);
}
.sm-code__paint { color: rgba(var(--sk_primary_foreground, 29, 28, 29), 0.9); }
.sm-code__input { caret-color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1); }
.sm-code__input::placeholder { color: rgba(var(--sk_primary_foreground, 29, 28, 29), 0.5); }

/*
 * The update notice.
 *
 * It was the ordinary row with a 3px edge and 12px of padding on the left only,
 * which is where it went wrong: the base row is padded 14px top and bottom and
 * nothing left or right, so the edge
 * had a gap on one side and the text ran to the dialog's margin on the other,
 * and the whole thing sat flush against the rows above and below it with no
 * more weight than a mod. A notice that is easy to miss is a notice that does
 * not work.
 *
 * So it is a card now -- tinted, padded on all four sides, and set apart with
 * margin rather than by borrowing the row separator.
 */
/* Both classes on purpose. The plain row class sets display flex further down
 * this same stylesheet, and one class beats one class only by coming later --
 * so with a single-class selector the block below lost, the notice stayed a
 * flex row, and the progress line's full width crushed the text beside it to
 * nothing. Measured at 0px wide before this, 706px after. */
.betterslack-row.betterslack-row--notice {
  display: block;
  margin: 4px 0 16px;
  padding: 16px 18px;
  border: 1px solid rgba(var(--sk_highlight, 18, 100, 163), 0.35);
  border-left-width: 3px;
  border-radius: 8px;
  background: rgba(var(--sk_highlight, 18, 100, 163), 0.07);
}
.betterslack-row.betterslack-row--notice .betterslack-row__meta { margin-bottom: 12px; }
.betterslack-row.betterslack-row--notice .betterslack-row__actions { flex-wrap: wrap; gap: 10px; }
/* The same card, in the colour of something wrong rather than something new. */
.betterslack-row.betterslack-row--warn {
  border-color: rgba(var(--sk_highlight_accent, 224, 30, 90), 0.4);
  background: rgba(var(--sk_highlight_accent, 224, 30, 90), 0.07);
}
.betterslack-skipped {
  margin: 10px 0 0;
  padding-left: 18px;
  display: grid;
  gap: 6px;
  font-size: 12.5px;
  line-height: 1.5;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.75);
  word-break: break-word;
}

/*
 * The state while it is working, under the buttons rather than beside them.
 *
 * A disabled button with a line of grey text next to it reads as broken rather
 * than as busy: the row does not grow, so "Downloading and rebuilding..."
 * either squeezes the button or wraps under it, and nothing on screen moves for
 * however long the pull takes. Under the buttons it has the width, and it spins
 * while there is something to wait for.
 */
.betterslack-progress {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  margin-top: 12px;
  font-size: 13px;
  line-height: 1.4;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.75);
}
.betterslack-progress:empty { display: none; }
.betterslack-progress::before {
  content: "";
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid rgba(var(--sk_highlight, 18, 100, 163), 0.25);
  border-top-color: rgba(var(--sk_highlight, 18, 100, 163), 1);
  animation: betterslack-spin 700ms linear infinite;
}
/* Finished, one way or the other: the spinner becomes a mark, because a circle
   still turning after the work is done says the opposite of what happened. */
.betterslack-progress--done::before,
.betterslack-progress--failed::before {
  animation: none;
  border: 0;
  width: 14px;
  height: 14px;
  font-size: 13px;
  line-height: 14px;
  text-align: center;
}
.betterslack-progress--done { color: var(--dt_color-content-hgl-2, #007a5a); }
.betterslack-progress--done::before { content: "\u2713"; color: inherit; }
.betterslack-progress--failed { color: var(--dt_color-content-imp, #c01343); }
.betterslack-progress--failed::before { content: "\u2715"; color: inherit; }

@keyframes betterslack-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .betterslack-progress::before { animation: none; }
}

/* A mod and its settings read as one block, with the settings indented under
 * the row they belong to rather than floating beside it. */
/* The palette, in Raycast's shape.
 *
 * What makes that shape legible is not decoration: every row carries a picture
 * of what it is, rows are grouped under headings, the category sits on the
 * right so the left can stay short, and a footer keeps saying which key does
 * what. A flat list of identical rows reads as a wall, which is what this was.
 */
.betterslack-palette {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(2px);
}
/*
 * Still looking, rather than nothing found.
 *
 * A directory search is debounced and then goes to the network, so for a few
 * hundred milliseconds after typing a name the list is empty because nobody has
 * answered yet. Saying "nothing matches" there is a wrong answer, not a plain
 * one. Same spinner as the update notice, from the same keyframes.
 */
.betterslack-palette__searching {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 28px 16px;
  font-size: 14px;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.6);
}
.betterslack-palette__count--busy {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.betterslack-palette__spinner {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid rgba(var(--sk_foreground_max, 29, 28, 29), 0.2);
  border-top-color: rgba(var(--sk_highlight, 18, 100, 163), 1);
  animation: betterslack-spin 700ms linear infinite;
}
@media (prefers-reduced-motion: reduce) {
  .betterslack-palette__count--busy {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.betterslack-palette__spinner { animation: none; }
}

.betterslack-palette__box {
  width: min(680px, calc(100vw - 48px));
  max-height: min(560px, 70vh);
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  overflow: hidden;
  background: rgba(var(--sk_primary_background, 255, 255, 255), 1);
  border: 1px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.2);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
}

.betterslack-palette__search {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  border-bottom: 1px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.16);
}
.betterslack-palette__search_icon {
  font-size: 15px;
  opacity: 0.45;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1);
}
.betterslack-palette__input {
  flex: 1 1 auto;
  border: 0;
  padding: 16px 0;
  font-size: 17px;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1);
  background: transparent;
  outline: none;
}

/* The mode you are in, in front of the field rather than in your memory. */
.betterslack-palette__chip {
  flex: 0 0 auto;
  padding: 3px 9px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 700;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 0.9);
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.16);
}
.betterslack-palette__chip[hidden] { display: none; }

/* What the prefixes do, shown when there is nothing else to show -- a palette
   whose shortcuts are only in the documentation has no shortcuts. */
.betterslack-palette__modes[hidden] { display: none; }
.betterslack-palette__modes {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
  padding: 8px 10px;
  border-top: 1px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.16);
}
.betterslack-palette__mode {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border: 0;
  border-radius: 8px;
  cursor: pointer;
  font-size: 12px;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 0.75);
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.1);
}
.betterslack-palette__mode kbd {
  font-family: inherit;
  font-weight: 700;
  padding: 0 5px;
  border-radius: 4px;
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.18);
}

.betterslack-palette__list { overflow-y: auto; padding: 6px; flex: 1 1 auto; min-height: 140px; }
.betterslack-palette__section {
  padding: 10px 10px 4px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 0.45);
}

.betterslack-palette__row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1);
  cursor: pointer;
}
.betterslack-palette__row[aria-selected="true"] {
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.14);
}

/* One size for every kind of icon -- an avatar, an emoji, a glyph or a letter
   -- so the titles line up whatever the row happens to be. */
.betterslack-palette__icon {
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  object-fit: cover;
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.14);
}
.betterslack-palette__icon--glyph {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 0.75);
}

.betterslack-palette__text { flex: 1 1 auto; min-width: 0; display: block; }
/* The name and the status on one line: the name gives way first, and the
   status keeps its emoji whatever happens -- a half-drawn face is worse than a
   truncated word. */
.betterslack-palette__titleline {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.betterslack-palette__title {
  display: block;
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.betterslack-palette__status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  flex: 0 1 auto;
  font-size: 13px;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.6);
}
.betterslack-palette__status_emoji { flex: 0 0 auto; width: 14px; height: 14px; object-fit: contain; }
.betterslack-palette__status_text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.betterslack-palette__sub {
  display: block;
  font-size: 12px;
  opacity: 0.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.betterslack-palette__source {
  flex: 0 0 auto;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 0.6);
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.12);
}

.betterslack-palette__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  border-top: 1px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.16);
  font-size: 12px;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 0.55);
}

/* Aligned with everything else. These chips carried 20px of padding of their
 * own on top of the dialog body's 24px, so the one row of the panel that is a
 * filter started further right than the rows it filters. */
.betterslack-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 0 12px;
}
.betterslack-filter {
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 12px;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 0.7);
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.1);
  cursor: pointer;
}
.betterslack-filter:hover { color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1); }
.betterslack-filter[aria-pressed="true"] {
  background: rgba(var(--sk_highlight, 18, 100, 163), 1);
  color: #fff;
}

/* The one tag that is a warning rather than a label. */
.betterslack-tag--error {
  background: rgba(var(--sk_highlight_accent, 224, 30, 90), 0.16);
  color: rgba(var(--sk_highlight_accent, 224, 30, 90), 1);
}

.betterslack-settings {
  padding: 4px 0 12px 16px;
  border-left: 2px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.2);
  margin: 0 0 8px 8px;
}
.betterslack-settings__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 6px 0;
  /* A control and its explanation share a line until there is no room for
     both, and then the control takes one of its own rather than shrinking to
     nothing. */
  flex-wrap: wrap;
}
.betterslack-settings__meta { min-width: 0; flex: 1 1 260px; }

/*
 * Wide enough to read what is in it.
 *
 * A max-width of 200px was left over from when these were all short numbers;
 * a select showing a sentence -- the palette's shortcut was one -- came out
 * clipped to a few characters with no way to see the rest. The width now
 * follows the content, within bounds, and the row wraps before it starves.
 */
.betterslack-settings__input {
  flex: 0 1 auto;
  width: auto;
  min-width: 220px;
  max-width: 100%;
}
.betterslack-row__actions:has(> .betterslack-settings__input) { flex: 1 1 240px; }
.betterslack-row__actions > .betterslack-settings__input { width: 100%; }
.betterslack-row__group { display: block; }

/*
 * A block of text: under its label, the row's whole width.
 *
 * Slack's text field is borrowed for the look, and it is a single-line field
 * with a fixed height, so the height is given back here. The class is doubled
 * for the reason the search box's is: Slack's stylesheet loads after this one.
 */
.betterslack-settings__row--wide { flex-direction: column; align-items: stretch; gap: 8px; }
/* The label's 260px basis is a width in a row and a height in a column, where
   it opened a gap that tall between the hint and the box. */
.betterslack-settings__row--wide > * { flex: 0 0 auto; }
.betterslack-settings__row--wide > .betterslack-row__actions { width: 100%; }
.betterslack-settings__text { display: flex; flex-direction: column; gap: 6px; width: 100%; }
.betterslack-settings__textarea.betterslack-settings__textarea,
.betterslack-editor__area.betterslack-editor__area {
  height: auto;
  min-height: 150px;
  padding: 8px 10px;
  line-height: 20px;
  resize: vertical;
  white-space: pre;
  overflow: auto;
}
.betterslack-settings__textbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.betterslack-settings__count {
  font-size: 12px;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.6);
}

/* The same text, in a dialog of its own: wide, and as tall as the window allows. */
#betterslack-text-editor.c-dialog { opacity: 1; z-index: 1101; }
.betterslack-content--editor {
  width: min(900px, calc(100% - 32px));
  max-width: min(900px, calc(100% - 32px));
  height: min(760px, calc(100% - 64px));
  max-height: none;
  display: flex;
  flex-direction: column;
}
.betterslack-editor { flex: 1 1 auto; display: flex; min-height: 0; }
.betterslack-editor__area.betterslack-editor__area { flex: 1 1 auto; min-height: 0; width: 100%; resize: none; }
.betterslack-editor__actions { align-items: center; padding-top: 12px; }
.betterslack-editor__spacer { flex: 1 1 auto; }

/* ---- a mod's mark, and its page ---- */

/*
 * Every mod gets a shape, drawn or derived.
 *
 * A list of names is a table; a list of marks is a shelf, and this panel is a
 * shop before it is a settings screen. A mod that ships no icon.svg gets its
 * initial on a colour derived from its id -- its own, stable, and never a hole
 * where the others have something.
 */
.betterslack-icon {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 8px;
  overflow: hidden;
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.10);
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 0.9);
}
.betterslack-icon--sm { width: 34px; height: 34px; }
.betterslack-icon--lg { width: 64px; height: 64px; border-radius: 14px; }
.betterslack-icon svg { width: 62%; height: 62%; display: block; }
.betterslack-icon--letter {
  font-weight: 900;
  background: hsl(var(--betterslack-icon-hue, 210) 45% 42%);
  color: #fff;
}
.betterslack-icon--sm.betterslack-icon--letter { font-size: 15px; }
.betterslack-icon--lg.betterslack-icon--letter { font-size: 27px; }

/* The name is what you press to open the page, so it has to look pressable
   without turning the list into a wall of links. */
.betterslack-row__open {
  font: inherit;
  color: inherit;
  cursor: pointer;
  text-align: left;
  border-radius: 4px;
}
.betterslack-row__open:hover { text-decoration: underline; }

.betterslack-back {
  display: inline-block;
  margin: 4px 0 14px;
  font-size: 13px;
  color: rgba(var(--sk_highlight, 18, 100, 163), 1);
  cursor: pointer;
}
.betterslack-detail__head { display: flex; align-items: flex-start; gap: 16px; }
.betterslack-detail__title { flex: 1 1 auto; min-width: 0; }
.betterslack-detail__name { margin: 0 0 2px; font-size: 22px; font-weight: 900; }
.betterslack-detail__lede {
  margin: 14px 0 18px;
  font-size: 15px;
  line-height: 1.5;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.85);
}
.betterslack-detail__section { margin: 22px 0 8px; font-size: 15px; font-weight: 900; }

/* Screenshots scroll sideways rather than stacking: a mod has two or three,
   and three tall pictures push the readme off the screen. */
.betterslack-shots {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 8px;
  margin-bottom: 6px;
}
/* One picture fills the column -- a mod's shot is a whole Slack window, and at
   420px the thing it is meant to show is a few pixels tall. Two or more go back
   to a strip you push sideways. */
.betterslack-shot { flex: 0 0 auto; width: min(420px, 78%); margin: 0; }
.betterslack-shots:has(> :only-child) .betterslack-shot { width: 100%; }
.betterslack-shot img {
  width: 100%;
  border-radius: 8px;
  border: 1px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.2);
  display: block;
}
.betterslack-shot figcaption {
  margin-top: 6px;
  font-size: 12px;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.6);
}

/* ---- a readme, rendered ---- */

.sm-md { font-size: 14px; line-height: 1.55; }
.sm-md__h1, .sm-md__h2, .sm-md__h3, .sm-md__h4 {
  margin: 20px 0 8px;
  font-weight: 900;
  line-height: 1.25;
}
.sm-md__h1 { font-size: 19px; }
.sm-md__h2 { font-size: 17px; }
.sm-md__h3 { font-size: 15px; }
.sm-md__h4 { font-size: 14px; }
.sm-md p { margin: 0 0 12px; }
.sm-md__list { margin: 0 0 12px; padding-left: 22px; }
.sm-md__list li { margin: 3px 0; }
.sm-md__link { color: rgba(var(--sk_highlight, 18, 100, 163), 1); }
.sm-md__img {
  max-width: 100%;
  border-radius: 8px;
  border: 1px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.2);
  margin: 6px 0 14px;
}
.sm-md__quote {
  margin: 0 0 12px;
  padding-left: 12px;
  border-left: 3px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.3);
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.75);
}
.sm-md__rule {
  border: none;
  border-top: 1px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.2);
  margin: 18px 0;
}
.sm-md__code, .sm-md__pre code {
  font-family: Monaco, Menlo, Consolas, monospace;
  font-size: 12.5px;
}
.sm-md__code {
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.12);
}
.sm-md__pre {
  margin: 0 0 14px;
  padding: 10px 12px;
  border-radius: 8px;
  overflow-x: auto;
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.10);
}

.betterslack-row {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 14px 0;
  border-bottom: 1px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.13);
}
.betterslack-row:last-child { border-bottom: none; }
.betterslack-row__meta { flex: 1; min-width: 0; }
.betterslack-row__name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: var(--custom-font-weight-bold, 700);
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1);
}
.betterslack-row__desc {
  margin-top: 2px;
  font-size: 13px;
  line-height: 1.46;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.7);
}
.betterslack-row__sub {
  margin-top: 6px;
  font-size: 12px;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.55);
}
.betterslack-row__actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
.betterslack-row__more { opacity: 0; transition: opacity 80ms ease; }
.betterslack-row:hover .betterslack-row__more,
.betterslack-row__more:focus-visible { opacity: 1; }

.betterslack-tag {
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: var(--custom-font-weight-bold, 700);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.6);
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.1);
}

/* A theme's required plugins, on its row and in the dialog. */
.betterslack-row__requires {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.4;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.6);
}
.betterslack-row__requires--missing {
  color: var(--dt_color-content-warn, #b8730a);
  font-weight: var(--custom-font-weight-bold, 700);
}
.betterslack-row__review {
  color: var(--dt_color-content-link, #1264a3);
  font-size: 12px;
  font-weight: var(--custom-font-weight-bold, 700);
  text-decoration: underline;
  cursor: pointer;
}

#betterslack-requires.c-dialog { opacity: 1; z-index: 1101; }
.betterslack-content--narrow {
  width: min(520px, calc(100% - 32px));
  max-width: min(520px, calc(100% - 32px));
  height: auto;
  max-height: min(560px, calc(100% - 64px));
}
.betterslack-requires { display: flex; flex-direction: column; gap: 14px; margin: 0; padding: 0; list-style: none; }
.betterslack-require {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 12px 14px;
  border-radius: 8px;
  /* A tinted card rather than a warning triangle: this is a choice to make,
     not an error the user is being blamed for. */
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.08);
}
.betterslack-require__title {
  font-size: 15px;
  font-weight: var(--custom-font-weight-bold, 700);
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1);
}
.betterslack-require__detail {
  font-size: 13px;
  line-height: 1.5;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.7);
}
.betterslack-actions--dialog {
  justify-content: flex-end;
  padding: 4px 24px 20px;
  margin-top: 0;
}

/* Slack has no reusable switch class, so this is built from its variables. */
.betterslack-switch { position: relative; width: 38px; height: 22px; flex: 0 0 auto; cursor: pointer; }
.betterslack-switch input { position: absolute; opacity: 0; width: 0; height: 0; }
.betterslack-switch__track {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background: rgba(var(--sk_foreground_max, 29, 28, 29), 0.4);
  transition: background 120ms ease;
}
.betterslack-switch__thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  transition: transform 120ms ease;
}
.betterslack-switch input:checked + .betterslack-switch__track {
  background: var(--dt_color-content-hgl-2, #007a5a);
}
.betterslack-switch input:checked + .betterslack-switch__track .betterslack-switch__thumb {
  transform: translateX(16px);
}
.betterslack-switch input:focus-visible + .betterslack-switch__track {
  box-shadow: 0 0 0 2px rgba(var(--sk_highlight, 18, 100, 163), 1);
}

.betterslack-empty {
  padding: 32px 16px;
  text-align: center;
  font-size: 14px;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.6);
}
.betterslack-hint {
  margin: 4px 0 16px;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.7);
}
.betterslack-actions { display: flex; align-items: center; gap: 12px; margin-top: 12px; }

/* Installing from a URL.
 *
 * This block had no rules of its own, which is not the same as having no
 * design: the row stayed display:block, so the field fell back to the browser
 * default of 174px -- a stub next to a full-height button -- and the whole
 * thing sat flush against the toolbar above it with nothing to separate them.
 */
.betterslack-remote {
  padding: 0 0 14px;
  margin-bottom: 14px;
  border-bottom: 1px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.13);
}
.betterslack-remote__row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.betterslack-remote__row .betterslack-search { flex: 1 1 auto; width: auto; }
.betterslack-remote__row .c-button { flex: 0 0 auto; }
.betterslack-status {
  flex: 0 1 auto;
  min-width: 0;
  font-size: 13px;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.7);
}
.betterslack-status { font-size: 13px; color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.7); }
.betterslack-danger { color: var(--dt_color-content-imp, #c01343); }

.betterslack-info {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 16px;
  margin: 16px 0 0;
  font-size: 13px;
}
.betterslack-info dt { color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.7); }
.betterslack-info dd {
  margin: 0;
  font-family: Monaco, Menlo, monospace;
  font-size: 12px;
  word-break: break-all;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1);
}

/* Dialogs opened by mods through api.ui.modal: the same Slack shell, sized to
   the content rather than to a fixed panel height. */
/*
 * Slack ships .c-dialog at opacity 0 and fades it in with its own transition,
 * which never runs for a dialog we built. The panel has carried this override
 * since it moved into the light DOM; api.ui.modal did not, so every dialog a
 * mod opened was in the document, focusable, and completely invisible.
 */
.betterslack-widget_dialog { z-index: 1014; opacity: 1; }
.betterslack-widget_content { height: auto; max-height: min(640px, calc(100% - 64px)); }
.betterslack-widget_content .betterslack-body { flex: 0 1 auto; padding-bottom: 8px; }
.betterslack-widget_titles { flex: 1; min-width: 0; }
.betterslack-widget_subtitle { margin: 4px 0 0; }
.betterslack-widget_footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 24px 20px;
}

/* Slack pins the top offset on .c-popover__content, so this layer is ours. */
/*
 * Above the dialog, not below it.
 *
 * A menu is opened *from* something, and often from inside one of ours -- the
 * overflow button in a profile dialog is the case that showed this. At 1013,
 * under the dialog's 1014, that menu drew behind the thing that opened it and
 * the options were simply invisible. A menu is transient and always belongs on
 * top of whatever it was summoned from; tests/requires.test.mjs holds the two
 * in that order so a renumbering cannot quietly swap them back.
 */
.betterslack-menu_layer {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 1015;
  will-change: transform;
}
.betterslack-menu_layer .c-menu {
  min-width: 180px;
  border-radius: 6px;
  background: rgba(var(--sk_primary_background, 255, 255, 255), 1);
  box-shadow: 0 0 0 1px rgba(var(--sk_foreground_low, 29, 28, 29), 0.13),
    0 4px 12px 0 rgba(0, 0, 0, 0.12);
}
`;
  var WIDGET_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }

:host, .toast-stack {
  --w-bg: var(--dt_color-base-pry, #ffffff);
  --w-raised: var(--dt_color-base-sec, #f8f8f8);
  --w-text: var(--dt_color-content-pry, #1d1c1d);
  --w-dim: var(--dt_color-content-sec, #454447);
  --w-border: var(--dt_color-otl-sec, rgba(94, 93, 96, 0.45));
  --w-green: var(--dt_color-content-hgl-2, #007a5a);
  --w-danger: var(--dt_color-content-imp, #c01343);
  --w-warn: var(--dt_color-content-hgl-3, #6b5000);
  --w-info: var(--dt_color-content-hgl-1, #1264a3);
  --w-font: Lato, Slack-Lato, appleLogo, sans-serif;
}

/* ---- toasts ---- */
.toast-stack {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  z-index: 2147482000;
  display: flex;
  flex-direction: column-reverse;
  gap: 8px;
  align-items: center;
  pointer-events: none;
  font-family: var(--w-font);
}
.toast {
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: min(560px, 86vw);
  padding: 9px 16px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  background: #1d1c1d;
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.32);
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 150ms ease, transform 150ms ease;
  pointer-events: auto;
}
.toast[data-shown="true"] { opacity: 1; transform: translateY(0); }
.toast[data-leaving="true"] { opacity: 0; transform: translateY(6px); }
.toast--success { background: var(--w-green); }
.toast--error { background: var(--w-danger); }
.toast--warning { background: var(--w-warn); }
.toast--info { background: var(--w-info); }
.toast__text { min-width: 0; }
.toast__action {
  all: unset;
  cursor: pointer;
  font-weight: 900;
  text-decoration: underline;
  white-space: nowrap;
}
.toast__action:focus-visible { outline: 2px solid #fff; outline-offset: 2px; border-radius: 3px; }

@media (prefers-reduced-motion: reduce) {
  .toast { transition: none; }
}
`;
  var LAUNCHER_CSS = `
.betterslack-launcher svg,
.betterslack-toolbar-button svg,
.betterslack-action svg {
  width: 20px;
  height: 20px;
  display: block;
}

/*
 * Slack sizes its channel-header buttons from a per-page class
 * (p-view_header_search_action_button and friends) rather than from a shared
 * modifier, so a generic icon button lands at 36px next to their 28px. Borrow
 * one of theirs and the name would lie about what the button is; this states
 * the size directly instead.
 */
.p-view_header__actions .betterslack-toolbar-button {
  width: 28px;
  height: 28px;
}

/*
 * Somebody's status, wherever a mod draws one.
 *
 * The node comes from api.slack.statusNode, so its look belongs here rather
 * than in each mod that shows one -- two of them do, and a status that is 16px
 * in one and 20px in the other is the drift this API exists to stop. Sized
 * against Slack's own inline emoji, which is 20px in a message and smaller in
 * a sidebar row.
 */
.betterslack-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}
.betterslack-status__emoji {
  flex: 0 0 auto;
  width: 15px;
  height: 15px;
  object-fit: contain;
  vertical-align: -2px;
}
.betterslack-status__emoji--char { font-size: 14px; line-height: 15px; }

/*
 * The same emoji again, inside a tooltip.
 *
 * Slack draws one there at the size of the sentence beside it rather than at
 * the size it had in the row -- the row's is a marker, the tooltip's is part of
 * the reading. Sized here rather than in the tooltip's own block because these
 * are the status classes, and the picture is the status.
 */
.betterslack-tooltip__heading { display: flex; align-items: center; gap: 6px; }
.betterslack-tooltip__icon { flex: 0 0 auto; display: flex; align-items: center; }
.betterslack-tooltip__icon .betterslack-status__emoji { width: 16px; height: 16px; }
.betterslack-tooltip__icon .betterslack-status__emoji--char { font-size: 15px; line-height: 16px; }
.betterslack-status__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Slack's unread badge, on our own button: the same pill, the same red, the
 * same place. Anything else in that strip would read as a Slack control that
 * had gone wrong. */
/*
 * The launcher dims and brightens with the icons beside it.
 *
 * Slack's rail icons do that by taking a colour from the strip; the mark has
 * four of its own and cannot, so opacity stands in for the tint it does not
 * have. Without this it would be the one button in the column that does not
 * react to a pointer.
 */
.betterslack-launcher { position: relative; opacity: 0.82; transition: opacity 80ms ease; }
.betterslack-launcher:hover,
.betterslack-launcher:focus-visible { opacity: 1; }
.betterslack-launcher__badge {
  position: absolute;
  top: -2px;
  right: -2px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: rgba(var(--sk_highlight_accent, 224, 30, 90), 1);
  color: #fff;
  font: 700 11px/16px Lato, Slack-Lato, sans-serif;
  text-align: center;
  pointer-events: none;
}
`;
  var VIEW_CSS = `
/*
 * What is under a view is not merely covered: it is taken off the screen.
 *
 * Covering it leaves Slack's conversation mounted, sized and, as far as Slack
 * is concerned, being looked at -- so a message arriving in the channel you
 * left behind is marked read, and the unread you were relying on is gone. A
 * mod may not cost somebody a message.
 *
 * Written as :has() on the panel rather than as a class somebody has to
 * remember to take off: the rule stops matching the moment the view unmounts,
 * so there is no restore step to get wrong. :has() is supported in Slack 4.51,
 * measured.
 */
.p-client_workspace__tabpanel:has(> .betterslack-view) > *:not(.betterslack-view) {
  display: none !important;
}

.betterslack-view {
  position: absolute;
  inset: 0;
  z-index: 300;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--dt_color-base-pry, #1a1d21);
  color: var(--dt_color-content-pry, #d1d2d3);
  animation: betterslack-view-enter var(--sm-motion-base, 200ms) var(--sm-motion-ease, cubic-bezier(.2, .9, .25, 1));
}

@keyframes betterslack-view-enter {
  from { opacity: 0; transform: translateX(var(--sm-motion-shift, 8px)); }
  to { opacity: 1; transform: none; }
}

.betterslack-view-tab .p-tab_rail__button__icon_inner {
  display: flex;
  align-items: center;
  justify-content: center;
}
.betterslack-view-tab .p-tab_rail__button__icon_inner svg { width: 20px; height: 20px; }
.betterslack-view-tab.p-tab_rail__button--active .p-tab_rail__button__icon_inner svg { width: 22px; height: 22px; }
`;

  // src/runtime/ui/strings.ts
  var PANEL_STRINGS = {
    en: {
      title: "BetterSlack",
      close: "Close",
      themes: "Themes",
      plugins: "Plugins",
      css: "Custom CSS",
      about: "About",
      installed: "Installed",
      browse: "Browse",
      search: "Search mods\u2026",
      noMatch: "Nothing matches that search.",
      allInstalled: "Everything in the catalogue is already installed.",
      nothingInstalled: "Nothing installed yet \u2014 the Browse shelf is where you start.",
      sortLabel: "Sort",
      sortRecent: "Recently installed",
      sortAz: "Name A\u2013Z",
      sortZa: "Name Z\u2013A",
      sortEnabled: "Switched on first",
      byLine: "v{version} \xB7 by {author}",
      filterAll: "All",
      backToList: "\u2039 All mods",
      settingsTitle: "Settings",
      install: "Install",
      enable: "Enable",
      disable: "Disable",
      remove: "Remove",
      notRunning: "not running",
      settingsCount: "Settings ({count})",
      settingsHide: "Hide settings",
      textLines: "{count} line(s)",
      textExpand: "Expand",
      textSave: "Save",
      textRestore: "Restore the original",
      uses: "Uses {names}",
      needs: "Needs {names}",
      enableIt: "Enable it",
      enableThem: "Enable them",
      enableAll: "Enable all {count}",
      notInCatalogue: "Not in the catalogue: {names}",
      cancel: "Cancel",
      requiresTitle: "{name} needs {count} plugin(s)",
      requiresBody: "A theme is CSS. This one needs behaviour CSS cannot do, which lives in plugins \u2014 code that keeps running after the theme is switched off. Enabling them is your call.",
      safeTitle: "Safe mode \u2014 nothing is loaded",
      safeAsked: "Started with --safe. Your mods are untouched; start again without it to load them.",
      safeCrashed: "{reason}. Switch off whatever you suspect, then start BetterSlack again.",
      skippedTitle: "{count} mod folder(s) were skipped",
      skippedBody: "These are in the mods folder but could not be read, so they are not listed above. The message says which file and why.",
      updateTitle: "An update is available",
      /**
       * Both numbers, where the eye lands. Used whenever the published version is
       * known, which is nearly always; the body then says only what will happen.
       */
      updateTitleVersion: "BetterSlack {current} \u2192 {latest}",
      updateGit: "Updating fetches that version and rebuilds.",
      /** No version to name: a branch that moved without a release on it. */
      updateGitCount: "{count} change(s) since this copy{headline}. Updating fetches them and rebuilds.",
      updateHeadline: " \u2014 latest: {subject}",
      updatePackage: "Updating downloads that version from GitHub and replaces this copy \u2014 your mods and settings are kept, they live outside it.",
      updateGo: "Update and restart",
      updateWorking: "Updating\u2026",
      updateGitHub: "Open GitHub",
      updatePulling: "Pulling and rebuilding\u2026",
      updateDownloading: "Downloading and rebuilding\u2026",
      updateDone: "Updated. Slack is restarting\u2026",
      updateFailed: "Could not update: {reason}",
      /** The dot on a tab and on the launcher. Read out; never drawn as words. */
      updateAvailable: "Update available",
      /**
       * The second line of a status tooltip. Slack words its own the same way,
       * and this is the app's dictionary rather than a mod's because the node it
       * goes on comes from api.slack.statusNode -- shared, so it cannot reach any
       * one mod's strings.
       */
      statusUntil: "Until {when}",
      /** The start screen, under the mark. */
      splashLoading: "Starting up\u2026",
      splashStarting: "Starting {name} \u2014 {done} of {total}",
      modUpdateTitle: "{name} {current} \u2192 {version}",
      modUpdateBody: "Updating replaces this mod alone, and reapplies it if it is on.",
      modUpdateGo: "Update",
      modUpdateWorking: "Downloading\u2026",
      modUpdateBlocked: "{name} {version} needs BetterSlack {needs}, and this is {running}. Update BetterSlack first \u2014 taking it now would leave a mod calling things this version does not have.",
      networkTo: "Talks to {addresses}, through BetterSlack.",
      networkUnset: "Talks to a server of your choosing, once you give its address.",
      slackTooOld: "Written against Slack {wanted}, and this is {have}. It may not find what it expects.",
      cssHint: "Applied after every theme, so it always wins. Slack exposes its palette as CSS custom properties (--dt_color-*), which is a steadier target than its class names.",
      cssSave: "Save and apply",
      cssApplied: "Applied.",
      aboutBody: "BetterSlack injects into the Slack renderer over the Chrome DevTools Protocol, carried on a private pipe rather than a debugging port \u2014 nothing listens on the network. Nothing of Slack.app is changed beyond, with your permission, its icon while it starts, so Slack updates cannot break your install, but mods stay loaded only while the loader runs.",
      dockIconTitle: "BetterSlack\u2019s icon in the Dock",
      dockIconBody: "BetterSlack can show its icon (or your theme\u2019s) on Slack in the Dock. To do that it puts the icon on Slack.app just before starting it, which macOS only allows with the App Management permission. Open System Settings and switch BetterSlack on there (if it is not listed, add it with +).",
      dockIconOpen: "Open System Settings",
      dockIconLater: "Later",
      dockIconAfter: "Once BetterSlack is switched on in App Management, restart it so the Dock picks up the icon.",
      dockIconRestart: "Restart",
      dockIconStill: "macOS still refuses: switch BetterSlack on in System Settings \u203A Privacy & Security \u203A App Management.",
      dockIconPending: "This theme changes the icon in the Dock. macOS shows a new icon only once the app starts again: restart BetterSlack now? It takes a few seconds.",
      dockIconRow: "Icon in the Dock",
      dockIconOk: "Slack wears BetterSlack\u2019s icon in the Dock.",
      dockIconRefused: "Slack keeps its own icon: macOS needs the App Management permission for BetterSlack.",
      dockIconAllow: "Allow\u2026",
      updatesTitle: "Updates",
      updatesHint: "BetterSlack and your mods are checked when Slack starts, then every hour.",
      updatesCheck: "Check for updates",
      updatesChecking: "Checking\u2026",
      updatesFailed: "Could not check: the update server did not answer.",
      updatesNone: "Everything is up to date (checked at {time}).",
      updatesFound: "{count} update(s) available (checked at {time}): see the dot on the Themes, Plugins or About tab.",
      hotReload: "Hot reload",
      hotReloadHint: "Reapply a mod as soon as its file changes on disk.",
      version: "Version",
      catalogue: "Catalogue",
      yourMods: "Your mods",
      transport: "Transport",
      repository: "Repository",
      contribute: "Submit a mod",
      remoteHint: "Install from a GitHub URL \u2014 a repository, or a folder inside one.",
      remotePlaceholder: "github.com/someone/their-mods/tree/main/my-plugin",
      remoteFetch: "Read it",
      remoteReading: "Reading\u2026",
      remoteInstalling: "Installing\u2026",
      remoteInstalled: "{name} installed. It is off until you switch it on.",
      remoteAccept: "Install anyway",
      remoteFrom: "From",
      remoteKind: "Kind",
      remoteScripts: "Code that will run",
      remoteNoScripts: "none \u2014 this one is stylesheets only",
      remoteSize: "Size",
      remoteBadge: "unreviewed",
      remoteBadgeHint: "From {source}. Nobody in this project has read it.",
      remoteWarningPlugin: "This is somebody else\u2019s code, and nobody here has read it. A plugin runs unsandboxed in your signed-in Slack: it can read every message you can, and the session token. Install it only if you trust whoever wrote it.",
      remoteWarningTheme: "This is somebody else\u2019s theme, and nobody here has read it. A theme is CSS, so it cannot read your messages \u2014 but it can hide or fake parts of the interface. Install it only if you trust whoever wrote it.",
      backupTitle: "Backup",
      backupHint: "Your settings and the mods you wrote or installed yourself. Catalogue mods come back with the project, so they are not in it.",
      backupExport: "Save a backup",
      backupImport: "Restore one",
      backupSaved: "Saved to your downloads.",
      backupWorking: "Restoring\u2026",
      backupRestored: "Restored {detail}.",
      diagTitle: "What the mods cost",
      diagHint: "Time spent starting, and how often Slack has undone each mod\u2019s work.",
      diagTiming: "{ms} ms \xB7 {mounts} mounts",
      diagCopy: "Copy a report",
      diagCopied: "Copied",
      diagCopyFailed: "Could not copy"
    },
    fr: {
      title: "BetterSlack",
      close: "Fermer",
      themes: "Th\xE8mes",
      plugins: "Plugins",
      css: "CSS personnalis\xE9",
      about: "\xC0 propos",
      installed: "Install\xE9s",
      browse: "Parcourir",
      search: "Rechercher un mod\u2026",
      noMatch: "Aucun r\xE9sultat pour cette recherche.",
      allInstalled: "Tout le catalogue est d\xE9j\xE0 install\xE9.",
      nothingInstalled: "Rien d\u2019install\xE9 pour l\u2019instant \u2014 tout commence dans l\u2019onglet Parcourir.",
      sortLabel: "Trier",
      sortRecent: "Install\xE9s r\xE9cemment",
      sortAz: "Nom A\u2013Z",
      sortZa: "Nom Z\u2013A",
      sortEnabled: "Activ\xE9s d\u2019abord",
      byLine: "v{version} \xB7 par {author}",
      filterAll: "Tous",
      backToList: "\u2039 Tous les mods",
      settingsTitle: "R\xE9glages",
      install: "Installer",
      enable: "Activer",
      disable: "D\xE9sactiver",
      remove: "Retirer",
      notRunning: "n\u2019a pas d\xE9marr\xE9",
      settingsCount: "R\xE9glages ({count})",
      settingsHide: "Masquer les r\xE9glages",
      textLines: "{count} ligne(s)",
      textExpand: "Agrandir",
      textSave: "Enregistrer",
      textRestore: "R\xE9tablir le texte d\u2019origine",
      uses: "Utilise {names}",
      needs: "N\xE9cessite {names}",
      enableIt: "Activer le plugin",
      enableThem: "Activer les plugins",
      enableAll: "Activer les {count} plugins",
      notInCatalogue: "Absent du catalogue : {names}",
      cancel: "Annuler",
      requiresTitle: "{name} n\xE9cessite {count} plugin(s)",
      requiresBody: "Un th\xE8me, c\u2019est du CSS. Celui-ci a besoin d\u2019un comportement que le CSS ne permet pas, et ce comportement rel\xE8ve des plugins \u2014 du code qui continue de s\u2019ex\xE9cuter une fois le th\xE8me d\xE9sactiv\xE9. \xC0 vous de d\xE9cider de les activer.",
      safeTitle: "Mode sans \xE9chec \u2014 rien n\u2019est charg\xE9",
      safeAsked: "D\xE9marr\xE9 avec --safe. Vos mods sont intacts ; relancez sans l\u2019option pour les charger.",
      safeCrashed: "{reason}. D\xE9sactivez ce que vous suspectez, puis relancez BetterSlack.",
      skippedTitle: "{count} dossier(s) de mod ignor\xE9(s)",
      skippedBody: "Ils sont dans le dossier mods mais n\u2019ont pas pu \xEAtre lus, donc ils ne sont pas list\xE9s ci-dessus. Le message indique quel fichier et pourquoi.",
      updateTitle: "Une mise \xE0 jour est disponible",
      updateTitleVersion: "BetterSlack {current} \u2192 {latest}",
      updateGit: "Mettre \xE0 jour r\xE9cup\xE8re cette version et reconstruit.",
      updateGitCount: "{count} changement(s) depuis votre copie{headline}. Mettre \xE0 jour les r\xE9cup\xE8re et reconstruit.",
      updateHeadline: " \u2014 dernier : {subject}",
      updatePackage: "Mettre \xE0 jour t\xE9l\xE9charge cette version depuis GitHub et remplace cette copie \u2014 vos mods et vos r\xE9glages sont conserv\xE9s, ils sont stock\xE9s ailleurs.",
      updateGo: "Mettre \xE0 jour et relancer",
      updateWorking: "Mise \xE0 jour\u2026",
      updateGitHub: "Ouvrir GitHub",
      updatePulling: "R\xE9cup\xE9ration et reconstruction\u2026",
      updateDownloading: "T\xE9l\xE9chargement et reconstruction\u2026",
      updateDone: "Mis \xE0 jour. Slack red\xE9marre\u2026",
      updateFailed: "Mise \xE0 jour impossible : {reason}",
      updateAvailable: "Mise \xE0 jour disponible",
      statusUntil: "Jusqu\u2019\xE0 {when}",
      splashLoading: "D\xE9marrage\u2026",
      splashStarting: "D\xE9marrage de {name} \u2014 {done} sur {total}",
      modUpdateTitle: "{name} {current} \u2192 {version}",
      modUpdateBody: "Mettre \xE0 jour ne remplace que ce mod, et le r\xE9applique s\u2019il est activ\xE9.",
      modUpdateGo: "Mettre \xE0 jour",
      modUpdateWorking: "T\xE9l\xE9chargement\u2026",
      modUpdateBlocked: "{name} {version} n\xE9cessite BetterSlack {needs}, et vous avez {running}. Mettez d'abord BetterSlack \xE0 jour \u2014 sinon ce mod appellerait des choses que cette version n'a pas.",
      networkTo: "Communique avec {addresses}, via BetterSlack.",
      networkUnset: "Communique avec un serveur de votre choix, une fois son adresse indiqu\xE9e.",
      slackTooOld: "\xC9crit pour Slack {wanted}, et vous avez {have}. Il peut ne pas trouver ce qu'il attend.",
      cssHint: "Appliqu\xE9 apr\xE8s tous les th\xE8mes, il l\u2019emporte donc toujours. Slack expose sa palette en propri\xE9t\xE9s CSS personnalis\xE9es (--dt_color-*), une cible plus stable que ses noms de classe.",
      cssSave: "Enregistrer et appliquer",
      cssApplied: "Appliqu\xE9.",
      aboutBody: "BetterSlack s\u2019injecte dans le processus de rendu de Slack via le Chrome DevTools Protocol, achemin\xE9 par un pipe priv\xE9 plut\xF4t que par un port de d\xE9bogage \u2014 rien n\u2019\xE9coute sur le r\xE9seau. Rien n\u2019est chang\xE9 dans Slack.app hormis, avec votre permission, son ic\xF4ne pendant son lancement : une mise \xE0 jour de Slack ne peut donc pas casser votre installation, mais les mods ne restent charg\xE9s que tant que le loader s\u2019ex\xE9cute.",
      dockIconTitle: "L\u2019ic\xF4ne de BetterSlack dans le Dock",
      dockIconBody: "BetterSlack peut afficher son ic\xF4ne (ou celle de votre th\xE8me) sur Slack dans le Dock. Pour cela, il pose l\u2019ic\xF4ne sur Slack.app juste avant de le lancer, ce que macOS n\u2019autorise qu\u2019avec la permission Gestion des apps. Ouvrez les R\xE9glages Syst\xE8me et activez BetterSlack (s\u2019il n\u2019est pas dans la liste, ajoutez-le avec +).",
      dockIconOpen: "Ouvrir les R\xE9glages Syst\xE8me",
      dockIconLater: "Plus tard",
      dockIconAfter: "Une fois BetterSlack activ\xE9 dans Gestion des apps, relancez-le pour que le Dock prenne l\u2019ic\xF4ne.",
      dockIconRestart: "Relancer",
      dockIconStill: "macOS refuse toujours : activez BetterSlack dans R\xE9glages Syst\xE8me \u203A Confidentialit\xE9 et s\xE9curit\xE9 \u203A Gestion des apps.",
      dockIconPending: "Ce th\xE8me change l\u2019ic\xF4ne dans le Dock. macOS n\u2019affiche une nouvelle ic\xF4ne qu\u2019au red\xE9marrage de l\u2019app : relancer BetterSlack maintenant ? Cela prend quelques secondes.",
      dockIconRow: "Ic\xF4ne dans le Dock",
      dockIconOk: "Slack porte l\u2019ic\xF4ne de BetterSlack dans le Dock.",
      dockIconRefused: "Slack garde son ic\xF4ne : macOS demande la permission Gestion des apps pour BetterSlack.",
      dockIconAllow: "Autoriser\u2026",
      updatesTitle: "Mises \xE0 jour",
      updatesHint: "BetterSlack et vos mods sont v\xE9rifi\xE9s au d\xE9marrage de Slack, puis toutes les heures.",
      updatesCheck: "V\xE9rifier les mises \xE0 jour",
      updatesChecking: "V\xE9rification\u2026",
      updatesFailed: "V\xE9rification impossible : le serveur de mises \xE0 jour n\u2019a pas r\xE9pondu.",
      updatesNone: "Tout est \xE0 jour (v\xE9rifi\xE9 \xE0 {time}).",
      updatesFound: "{count} mise(s) \xE0 jour disponible(s) (v\xE9rifi\xE9 \xE0 {time}) : voir la pastille sur l\u2019onglet Th\xE8mes, Plugins ou \xC0 propos.",
      hotReload: "Rechargement \xE0 chaud",
      hotReloadHint: "R\xE9appliquer un mod d\xE8s que son fichier change sur le disque.",
      version: "Version",
      catalogue: "Catalogue",
      yourMods: "Vos mods",
      transport: "Transport",
      repository: "D\xE9p\xF4t",
      contribute: "Proposer un mod",
      remoteHint: "Installer depuis une URL GitHub \u2014 un d\xE9p\xF4t, ou un dossier dedans.",
      remotePlaceholder: "github.com/quelquun/ses-mods/tree/main/mon-plugin",
      remoteFetch: "Examiner",
      remoteReading: "Analyse\u2026",
      remoteInstalling: "Installation\u2026",
      remoteInstalled: "{name} est install\xE9, et restera d\xE9sactiv\xE9 tant que vous ne l\u2019activerez pas.",
      remoteAccept: "Installer quand m\xEAme",
      remoteFrom: "Provenance",
      remoteKind: "Type",
      remoteScripts: "Code qui s\u2019ex\xE9cutera",
      remoteNoScripts: "aucun \u2014 uniquement des feuilles de style",
      remoteSize: "Taille",
      remoteBadge: "non relu",
      remoteBadgeHint: "Depuis {source}. Personne dans ce projet ne l\u2019a lu.",
      remoteWarningPlugin: "C\u2019est le code de quelqu\u2019un d\u2019autre, que personne ici n\u2019a relu. Un plugin s\u2019ex\xE9cute sans isolation dans votre session Slack : il peut lire tous les messages auxquels vous avez acc\xE8s, ainsi que votre jeton de session. Ne l\u2019installez que si vous faites confiance \xE0 son auteur.",
      remoteWarningTheme: "C\u2019est le th\xE8me de quelqu\u2019un d\u2019autre, que personne ici n\u2019a lu. Un th\xE8me est du CSS, il ne peut donc pas lire vos messages \u2014 mais il peut masquer ou falsifier des parties de l\u2019interface. Ne l\u2019installez que si vous faites confiance \xE0 son auteur.",
      backupTitle: "Sauvegarde",
      backupHint: "Vos r\xE9glages, et les mods que vous avez \xE9crits ou install\xE9s vous-m\xEAme. Ceux du catalogue reviennent avec le projet : ils ne figurent pas dans la sauvegarde.",
      backupExport: "Enregistrer une sauvegarde",
      backupImport: "Restaurer une sauvegarde",
      backupSaved: "Enregistr\xE9 dans vos t\xE9l\xE9chargements.",
      backupWorking: "Restauration\u2026",
      backupRestored: "{detail} \u2014 restaur\xE9.",
      diagTitle: "Ce que co\xFBtent les mods",
      diagHint: "Temps pass\xE9 au d\xE9marrage, et nombre de fois o\xF9 Slack a d\xE9fait le travail de chaque mod.",
      diagTiming: "{ms} ms \xB7 {mounts} remontages",
      diagCopy: "Copier un rapport",
      diagCopied: "Copi\xE9",
      diagCopyFailed: "Copie impossible"
    }
  };

  // src/runtime/web-api.ts
  var CONFIG_KEY = "localConfig_v2";
  var METHOD_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$/;
  var WebApiError = class extends Error {
    constructor(method, slackError) {
      super(`${method} failed: ${slackError}`);
      this.method = method;
      this.slackError = slackError;
    }
  };
  function currentTeamId() {
    const fromUrl = location.pathname.match(/\/client\/(T[A-Z0-9]+)/i)?.[1] ?? null;
    const drawn = drawnTeams();
    if (drawn.size === 0) return fromUrl;
    if (fromUrl && drawn.has(fromUrl)) return fromUrl;
    let best = null;
    let bestCount = 0;
    for (const [team, count] of drawn) {
      if (count > bestCount) {
        best = team;
        bestCount = count;
      }
    }
    return best ?? fromUrl;
  }
  function drawnTeams() {
    const seen = /* @__PURE__ */ new Map();
    const client = document.querySelector(".p-client_container");
    if (!client) return seen;
    for (const image of client.querySelectorAll("img")) {
      const team = /\/(T[A-Z0-9]+)-U[A-Z0-9]+-/i.exec(image.src)?.[1];
      if (team) seen.set(team, (seen.get(team) ?? 0) + 1);
    }
    return seen;
  }
  function drawnChannelId() {
    const message = document.querySelector('[data-qa="message_container"][data-msg-channel-id]');
    return message?.getAttribute("data-msg-channel-id") ?? null;
  }
  function readTeamConfig() {
    const teamId = currentTeamId();
    if (!teamId) return null;
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed.teams?.[teamId] ?? null;
    } catch {
      return null;
    }
  }
  var DIRECTORY_TTL = 60 * 1e3;
  function createWebApi() {
    let cachedTeam;
    const directory = /* @__PURE__ */ new Map();
    let directoryTeam;
    let emojiTeam;
    let emojiMap = null;
    let cached = null;
    const config = () => {
      const team = currentTeamId();
      if (team !== cachedTeam) {
        cachedTeam = team;
        cached = readTeamConfig();
      }
      return cached;
    };
    const call = async (method, params = {}) => {
      if (!METHOD_PATTERN.test(method)) {
        throw new WebApiError(method, "invalid method name");
      }
      const token = config()?.token;
      if (!token) throw new WebApiError(method, "no session token for this workspace");
      const body = new FormData();
      body.append("token", token);
      for (const [key, value] of Object.entries(params)) body.append(key, String(value));
      const response = await fetch(`/api/${method}`, {
        method: "POST",
        body,
        credentials: "include"
      });
      if (!response.ok) throw new WebApiError(method, `HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload.ok) throw new WebApiError(method, payload.error ?? "unknown error");
      return payload;
    };
    return {
      get available() {
        return typeof config()?.token === "string";
      },
      get teamDomain() {
        return config()?.domain ?? null;
      },
      get selfId() {
        return config()?.user_id ?? null;
      },
      call,
      async userInfo(userId) {
        const res = await call("users.info", {
          user: userId,
          include_locale: true
        });
        return res.user;
      },
      async users(userIds) {
        const team = currentTeamId();
        if (team !== directoryTeam) {
          directoryTeam = team;
          directory.clear();
        }
        const wanted = [...new Set(userIds)].filter((id) => id);
        const now = Date.now();
        const missing = wanted.filter((id) => {
          const held = directory.get(id);
          return !held || now - held.at > DIRECTORY_TTL;
        });
        if (missing.length) {
          try {
            const res = await call("users.info", {
              users: missing.join(","),
              include_locale: true
            });
            for (const user of res.users ?? []) directory.set(user.id, { user, at: now });
          } catch {
            const each = await Promise.all(
              missing.map(
                (id) => call("users.info", { user: id, include_locale: true }).then((res) => res.user).catch(() => null)
              )
            );
            for (const user of each) if (user) directory.set(user.id, { user, at: now });
          }
        }
        const out = /* @__PURE__ */ new Map();
        for (const id of wanted) {
          const held = directory.get(id);
          if (held) out.set(id, held.user);
        }
        return out;
      },
      emoji() {
        const team = currentTeamId();
        if (team !== emojiTeam) {
          emojiTeam = team;
          emojiMap = null;
        }
        if (emojiMap) return emojiMap;
        emojiMap = (async () => {
          const out = /* @__PURE__ */ new Map();
          let raw = {};
          try {
            const res = await call("emoji.list");
            raw = res.emoji ?? {};
          } catch {
            return out;
          }
          for (const name of Object.keys(raw)) {
            const seen = /* @__PURE__ */ new Set();
            let target = name;
            let value = raw[target];
            while (typeof value === "string" && value.startsWith("alias:") && !seen.has(target)) {
              seen.add(target);
              target = value.slice("alias:".length);
              value = raw[target];
            }
            if (typeof value === "string" && !value.startsWith("alias:")) out.set(name, value);
          }
          return out;
        })();
        return emojiMap;
      },
      presence: (userId) => call("users.getPresence", { user: userId }),
      teamInfo: () => call("team.info"),
      dndInfo: (userId) => call("dnd.info", { user: userId }),
      async availability(userId) {
        const [presence, dnd] = await Promise.all([
          call("users.getPresence", { user: userId }).catch(() => null),
          call("dnd.info", { user: userId }).catch(() => null)
        ]);
        const snoozed = Boolean(dnd?.snooze_enabled) || Boolean(dnd?.dnd_enabled && isInDndWindow(dnd));
        if (snoozed) return { state: "dnd", presence, dnd };
        if (!presence) return { state: "unknown", presence, dnd };
        return { state: presence.presence === "active" ? "active" : "away", presence, dnd };
      }
    };
  }
  function isInDndWindow(dnd) {
    const start = Number(dnd.next_dnd_start_ts ?? 0);
    const end = Number(dnd.next_dnd_end_ts ?? 0);
    if (!start || !end) return false;
    const now = Date.now() / 1e3;
    return now >= start && now < end;
  }
  function userIdFromAvatarUrl(url) {
    if (!url) return null;
    const match = url.match(/\/T[A-Z0-9]+-(U[A-Z0-9]+)-/i);
    return match ? match[1].toUpperCase() : null;
  }

  // src/runtime/slack-api.ts
  var ACTIONS_GROUP = '[data-qa="message-actions"]';
  var ACTIONS_ITEM_CLASS = "c-message_actions__overflow_item c-message_actions__overflow_item--button";
  var MORE_ACTIONS = '[data-qa="more_message_actions"]';
  var MESSAGE = '[data-qa="message_container"]';
  var COMPOSER_EDITOR = ".ql-editor";
  var COMPOSER = '[data-qa="message_input"]';
  var CONVERSATION_ROUTE = /\/client\/[^/]+\/([CDG][A-Z0-9]{2,})(?:\/|$)/;
  var TOOLBARS = {
    /** Bottom strip of the rail: "Créer un nouveau", focus mode, avatar. */
    controlStrip: {
      container: ".p-control_strip",
      buttonClass: "c-button-unstyled p-control_strip__circle_button",
      /*
       * Anchored on BetterSlack's own launcher, not on Slack's coachmark wrapper.
       *
       * Inserting next to `.c-coachmark-anchor:has([data-qa="user-button"])`
       * freezes the renderer solid -- grey window, no error, no console, Slack
       * has to be killed. Slack's coachmark code evidently reacts to changes
       * around that node and ends up in a loop with whatever put them there.
       * Bisected against a running client: the same button anchored here is fine,
       * anchored there hangs every time.
       */
      before: "#betterslack-control-button",
      placement: "right"
    },
    /**
     * Formatting row under the message box: bold, italic, link…
     * Anchored on whatever element holds the bold button, rather than on the
     * composer body, so the button lands beside its peers and not at the end of
     * an unrelated container.
     */
    composer: {
      container: '*:has(> [data-qa="bold-composer-button"])',
      buttonClass: "c-button-unstyled c-icon_button c-icon_button--size_smedium p-composer__button c-icon_button--default",
      before: void 0,
      placement: "top"
    },
    /**
     * Right-hand end of the top bar, beside Slack's own help and account
     * controls. The place for a switch that belongs to the whole client rather
     * than to the conversation on screen.
     *
     * The container is a direct child on purpose: `display_flex` and
     * `align_items_center` are utility classes that appear all over Slack's
     * markup, and matching them anywhere under the right container would put the
     * button in whichever one happened to come first.
     */
    topNav: {
      container: ".p-ia4_top_nav__right_container > .display_flex.align_items_center",
      buttonClass: "c-button-unstyled c-icon_button c-icon_button--size_medium c-icon_button--default",
      before: void 0,
      placement: "bottom"
    },
    /** Right-hand side of the channel header: huddle, search, more. */
    channelHeader: {
      container: ".p-view_header__actions",
      buttonClass: "c-button-unstyled c-icon_button c-icon_button--size_medium c-icon_button--default",
      before: void 0,
      placement: "bottom"
    }
  };
  var cachedHost = null;
  function rememberHost(url) {
    try {
      cachedHost = new URL(url).origin;
    } catch {
    }
  }
  function describeMessage(element) {
    const channelId = element.getAttribute("data-msg-channel-id");
    const ts = element.getAttribute("data-msg-ts");
    let permalink = null;
    const timestampLink = element.querySelector("a.c-timestamp");
    if (timestampLink?.href) {
      permalink = timestampLink.href;
      rememberHost(permalink);
    } else if (cachedHost && channelId && ts) {
      permalink = `${cachedHost}/archives/${channelId}/p${ts.replace(".", "")}`;
    }
    const body = element.querySelector('[data-qa="message-text"]');
    return {
      element,
      channelId,
      ts,
      permalink,
      text: (body?.textContent ?? element.textContent ?? "").trim()
    };
  }
  function addMessageAction(pluginId, action) {
    const nodeId = `betterslack-action-${pluginId}-${action.id}`;
    const cleanup = onEach(ACTIONS_GROUP, (group) => {
      if (group.querySelector(`#${CSS.escape(nodeId)}`)) return;
      const message = group.closest(MESSAGE) ?? document.querySelector(".c-message_kit__hover--hovered")?.closest(MESSAGE) ?? null;
      if (!message) return;
      if (action.when && !action.when(describeMessage(message))) return;
      const button = h("button", {
        class: "c-button-unstyled c-icon_button c-icon_button--size_smedium c-message_actions__button betterslack-action",
        type: "button",
        "aria-label": action.label,
        "data-qa": `betterslack_${pluginId}_${action.id}`
      });
      button.innerHTML = action.icon;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        action.onClick(describeMessage(message), event);
      });
      attachTooltip(button, {
        title: action.label,
        subtitle: action.description,
        placement: "top"
      });
      const item = h("div", { class: ACTIONS_ITEM_CLASS, id: nodeId }, [button]);
      const more = group.querySelector(MORE_ACTIONS)?.closest(`.c-message_actions__overflow_item`);
      if (more) more.before(item);
      else group.append(item);
    });
    return () => {
      cleanup();
      for (const node of document.querySelectorAll(`#${CSS.escape(nodeId)}`)) node.remove();
    };
  }
  var drawnEmoji = /* @__PURE__ */ new Map();
  function harvestEmoji() {
    for (const img of document.querySelectorAll(".c-emoji img[data-stringify-emoji]")) {
      const name = img.getAttribute("data-stringify-emoji")?.replace(/^:|:$/g, "");
      if (!name || drawnEmoji.has(name)) continue;
      if (img.src) drawnEmoji.set(name, img.src);
    }
    return drawnEmoji;
  }
  function describeStatus(who, customEmoji) {
    const profile = who && "profile" in who && who.profile ? who.profile : who;
    if (!profile) return null;
    const text = (profile.status_text ?? "").trim();
    const emoji2 = (profile.status_emoji ?? "").replace(/^:|:$/g, "").trim() || null;
    if (!text && !emoji2) return null;
    const expiration = Number(profile.status_expiration ?? 0);
    return {
      text,
      emoji: emoji2,
      imageUrl: emoji2 ? imageForEmoji(emoji2, profile, customEmoji) : null,
      // 0 means "no end", which is not the same as the epoch.
      expiresAt: expiration > 0 ? new Date(expiration * 1e3) : null
    };
  }
  function imageForEmoji(name, profile, customEmoji) {
    const sent = profile?.status_emoji_display_info?.find(
      (entry) => !entry.emoji_name || entry.emoji_name.replace(/^:|:$/g, "") === name
    );
    if (sent?.display_url) return sent.display_url;
    return customEmoji?.get(name) ?? harvestEmoji().get(name) ?? null;
  }
  function statusNode(status, profile, options = {}) {
    const { showText = true, placement = "right", hint, tooltipOn } = options;
    const node = h("span", { class: "betterslack-status" });
    if (status.emoji) {
      const unicode = profile?.status_emoji_display_info?.find((e) => e.unicode)?.unicode;
      if (status.imageUrl) {
        node.append(h("img", {
          class: "betterslack-status__emoji",
          src: status.imageUrl,
          alt: status.emoji,
          loading: "lazy"
        }));
      } else if (unicode) {
        node.append(h("span", { class: "betterslack-status__emoji betterslack-status__emoji--char" }, [
          // Slack sends it as codepoints joined by dashes: "1f1eb-1f1f7".
          unicode.split("-").map((point) => String.fromCodePoint(parseInt(point, 16))).join("")
        ]));
      }
    }
    if (showText && status.text) {
      node.append(h("span", { class: "betterslack-status__text" }, [status.text]));
    }
    const title = status.text || hint || (status.emoji ? `:${status.emoji}:` : "");
    if (title) {
      attachTooltip(tooltipOn ?? node, {
        title,
        subtitle: [
          status.expiresAt ? untilSentence(status.expiresAt) : "",
          // Not repeated when it is already the title.
          status.text ? hint ?? "" : ""
        ],
        placement,
        icon: node.querySelector(".betterslack-status__emoji") ?? void 0
      });
    }
    return node;
  }
  function untilSentence(when) {
    let locale = "en";
    try {
      locale = createI18n().locale;
    } catch {
    }
    const day = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "long" });
    const time = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" });
    return statusStrings()("statusUntil", { when: `${day.format(when)}, ${time.format(when)}` });
  }
  var statusTranslator = null;
  function statusStrings() {
    statusTranslator ?? (statusTranslator = createI18n().strings(PANEL_STRINGS));
    return statusTranslator;
  }
  var PROFILE_PANE = '[data-qa="member_profile_pane"]';
  var PROFILE_AVATAR = ".p-r_member_profile__avatar__img";
  var SELECTORS = Object.freeze({
    message: MESSAGE,
    messageActions: ACTIONS_GROUP,
    composer: COMPOSER,
    composerEditor: COMPOSER_EDITOR,
    channelSidebar: '[data-qa="channel-sidebar"]',
    tabRail: '[data-qa="tab_rail_desktop"]',
    topNav: '[data-qa="top-nav"]',
    messageText: '[data-qa="message-text"]',
    profilePane: PROFILE_PANE,
    profileAvatar: PROFILE_AVATAR
  });
  function installViewCss() {
    if (document.getElementById("betterslack-view-css")) return;
    const node = h("style", { id: "betterslack-view-css" });
    node.textContent = VIEW_CSS;
    (document.head ?? document.documentElement)?.append(node);
  }
  var TAB_MENU = ".p-tab_rail__tab_menu";
  var VIEW_PANE = ".p-client_workspace__tabpanel";
  var VIEW_OPEN_CLASS = "betterslack-view-open";
  function addView(pluginId, options) {
    installViewCss();
    const nodeId = `betterslack-view-${pluginId}-${options.id}`;
    const tabId = `betterslack-tab-${pluginId}-${options.id}`;
    let open = false;
    let mounted = null;
    let unmountView = null;
    let dimmed = [];
    const tab = h("button", {
      class: "c-button-unstyled p-tab_rail__button c-tabs__tab js-tab c-tabs__tab--full_width betterslack-view-tab",
      id: tabId,
      type: "button",
      role: "tab",
      tabindex: "0",
      "aria-selected": "false",
      "aria-label": options.label,
      "data-qa": `betterslack_view_${pluginId}_${options.id}`
    });
    const iconInner = h("div", { class: "p-tab_rail__button__icon_inner" });
    iconInner.innerHTML = options.icon;
    tab.append(h("span", { class: "c-tabs__tab_content" }, [
      h("div", { class: "p-tab_rail__button__icon" }, [iconInner]),
      h("div", { class: "p-tab_rail__button__label" }, [options.label])
    ]));
    tab.addEventListener("click", () => show());
    const unmountTab = keepMounted(TAB_MENU, `${tabId}-hook`, () => {
      const hook = h("div", { class: "p-autoclog__hook" });
      hook.append(tab);
      return hook;
    });
    const lightTab = (on) => {
      tab.classList.toggle("p-tab_rail__button--active", on);
      tab.classList.toggle("c-tabs__tab--active", on);
      tab.setAttribute("aria-selected", String(on));
    };
    const dimSlacksTabs = () => {
      dimmed = [...document.querySelectorAll(".p-tab_rail__button--active")].filter((button) => button !== tab);
      for (const button of dimmed) {
        button.classList.remove("p-tab_rail__button--active", "c-tabs__tab--active");
        button.setAttribute("aria-selected", "false");
      }
    };
    const lightSlacksTabs = () => {
      for (const button of dimmed) {
        if (!button.isConnected) continue;
        button.classList.add("p-tab_rail__button--active", "c-tabs__tab--active");
        button.setAttribute("aria-selected", "true");
      }
      dimmed = [];
    };
    const show = () => {
      if (open) {
        refresh();
        return;
      }
      open = true;
      document.documentElement.classList.add(VIEW_OPEN_CLASS);
      lightTab(true);
      dimSlacksTabs();
      unmountView = keepMounted(VIEW_PANE, nodeId, () => {
        mounted = h("section", {
          class: "betterslack-view",
          role: "region",
          "aria-label": options.label
        }, [options.render()]);
        return mounted;
      });
      options.onOpen?.();
    };
    const close = () => {
      if (!open) return;
      open = false;
      unmountView?.();
      unmountView = null;
      mounted = null;
      document.documentElement.classList.remove(VIEW_OPEN_CLASS);
      lightTab(false);
      lightSlacksTabs();
      options.onClose?.();
    };
    const refresh = () => {
      if (!open || !mounted) return;
      mounted.replaceChildren(options.render());
    };
    const onNavigate = () => close();
    const nav = window.navigation;
    nav?.addEventListener("currententrychange", onNavigate);
    window.addEventListener("popstate", onNavigate);
    const onRailClick = (event) => {
      if (!open) return;
      const button = event.target?.closest?.(".p-tab_rail__button");
      if (button && button !== tab) close();
    };
    document.addEventListener("click", onRailClick, true);
    return {
      open: show,
      close,
      isOpen: () => open,
      element: () => mounted,
      refresh,
      tabSelector: `#${tabId}`,
      dispose: () => {
        close();
        unmountTab();
        tab.remove();
        nav?.removeEventListener("currententrychange", onNavigate);
        window.removeEventListener("popstate", onNavigate);
        document.removeEventListener("click", onRailClick, true);
      }
    };
  }
  function addProfileButton(pluginId, button) {
    const nodeId = `betterslack-profile-${pluginId}-${button.id}`;
    const cleanup = onEach(PROFILE_PANE, (pane) => {
      if (pane.querySelector(`#${CSS.escape(nodeId)}`)) return;
      const element = h("button", {
        class: "c-button c-button--outline c-button--medium betterslack-profile-button",
        type: "button",
        id: nodeId,
        "data-qa": `betterslack_${pluginId}_${button.id}`
      });
      if (button.icon) element.innerHTML = button.icon;
      element.append(h("span", {}, [button.label]));
      element.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const avatar = pane.querySelector(PROFILE_AVATAR);
        button.onClick({ element: pane, userId: userIdFromAvatarUrl(avatar?.src) });
      });
      const container = pane.querySelector(".p-r_member_profile__container") ?? pane;
      container.append(h("div", { class: "betterslack-profile-row" }, [element]));
    });
    return () => {
      cleanup();
      for (const node of document.querySelectorAll(`#${CSS.escape(nodeId)}`)) {
        node.closest(".betterslack-profile-row")?.remove();
        node.remove();
      }
    };
  }
  function addToolbarButton(pluginId, toolbar, button) {
    const spec2 = TOOLBARS[toolbar];
    const nodeId = `betterslack-tb-${pluginId}-${button.id}`;
    const unmount = keepMounted(
      spec2.container,
      nodeId,
      () => {
        const element = h("button", {
          class: `${spec2.buttonClass} betterslack-toolbar-button`,
          type: "button",
          "aria-label": button.label,
          "data-qa": `betterslack_${pluginId}_${button.id}`
        });
        element.innerHTML = button.icon;
        element.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          button.onClick(event);
        });
        attachTooltip(element, {
          title: button.label,
          subtitle: button.description,
          placement: spec2.placement
        });
        return element;
      },
      // Prepend rather than append when the anchor is missing: the end of a
      // container is where the app's own re-renders land.
      { before: button.before ?? spec2.before, position: "prepend" }
    );
    return () => {
      unmount();
      for (const node of document.querySelectorAll(`#${CSS.escape(nodeId)}`)) node.remove();
    };
  }
  function escapeHtml(value) {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  var composer = {
    element: () => document.querySelector(COMPOSER_EDITOR),
    focus() {
      const editor = composer.element();
      if (!editor) return false;
      editor.focus();
      return document.activeElement === editor || editor.contains(document.activeElement);
    },
    caretToEnd() {
      const editor = composer.element();
      if (!editor) return;
      const selection = window.getSelection();
      if (!selection) return;
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    },
    insertText(text) {
      if (!composer.focus()) return false;
      composer.caretToEnd();
      return document.execCommand("insertText", false, text);
    },
    insertLink(url, text) {
      if (!composer.focus()) return false;
      composer.caretToEnd();
      let safe;
      try {
        safe = new URL(url);
      } catch {
        return false;
      }
      if (safe.protocol !== "https:" && safe.protocol !== "http:") return false;
      return document.execCommand(
        "insertHTML",
        false,
        `<a href="${escapeHtml(safe.href)}">${escapeHtml(text)}</a>`
      );
    },
    isEmpty() {
      const editor = composer.element();
      if (!editor) return true;
      return editor.innerText.replace(/\n/g, "").trim() === "";
    }
  };
  var DEAF = {
    on: () => () => {
    },
    onMessage: () => () => {
    },
    onMessageChanged: () => () => {
    },
    onMessageDeleted: () => () => {
    },
    onReaction: () => () => {
    },
    onMembership: () => () => {
    },
    onConversation: () => () => {
    },
    onUserChanged: () => () => {
    },
    onPresence: () => () => {
    },
    onTyping: () => () => {
    },
    onRead: () => () => {
    },
    onPin: () => () => {
    },
    onSaved: () => () => {
    },
    onEmojiChanged: () => () => {
    },
    deliver: () => {
    },
    watching: () => []
  };
  function onTeamChange(handler) {
    let last = currentTeamId();
    const check = () => {
      const now = currentTeamId();
      if (now === last) return;
      const before = last;
      last = now;
      handler(now, before);
    };
    const nav = window.navigation;
    nav?.addEventListener("currententrychange", check);
    window.addEventListener("popstate", check);
    const timer = setInterval(check, 2e3);
    return () => {
      nav?.removeEventListener("currententrychange", check);
      window.removeEventListener("popstate", check);
      clearInterval(timer);
    };
  }
  var WINDOW_MATERIALS = Object.freeze([
    "hud",
    "fullscreen-ui",
    "under-window",
    "titlebar",
    "none"
  ]);
  async function setMaterial(name) {
    if (!WINDOW_MATERIALS.includes(name)) {
      throw new Error(`"${name}" is not a window material BetterSlack will set`);
    }
    const bridge = window.desktop?.window;
    if (typeof bridge?.getWindowId !== "function" || typeof bridge?.callBrowserWindowMethod !== "function") {
      return false;
    }
    try {
      const id = await bridge.getWindowId();
      await bridge.callBrowserWindowMethod(id, "setVibrancy", name === "none" ? null : name);
      return true;
    } catch {
      return false;
    }
  }
  function createSlackApi(pluginId) {
    const web = createWebApi();
    return {
      addMessageAction: (action) => addMessageAction(pluginId, action),
      addToolbarButton: (toolbar, button) => addToolbarButton(pluginId, toolbar, button),
      addProfileButton: (button) => addProfileButton(pluginId, button),
      addView: (options) => addView(pluginId, options),
      web,
      openConversation(channelId) {
        const team = currentTeamId();
        if (!team) return;
        window.location.href = `slack://channel?team=${team}&id=${encodeURIComponent(channelId)}`;
      },
      openMessage(channelId, ts, options = {}) {
        const team = options.team ?? currentTeamId();
        if (!team || !ts) return;
        window.location.href = `slack://channel?team=${encodeURIComponent(team)}&id=${encodeURIComponent(channelId)}&message=${encodeURIComponent(ts)}`;
      },
      async openDirectMessage(userId) {
        const res = await web.call("conversations.open", {
          users: userId,
          return_im: true
        });
        const id = res.channel?.id ?? null;
        if (id) this.openConversation(id);
        return id;
      },
      openUserProfile(userId) {
        const team = currentTeamId();
        if (!team) return;
        window.location.href = `slack://user?team=${team}&id=${encodeURIComponent(userId)}`;
      },
      async hideConversation(channelId) {
        await web.call("conversations.close", { channel: channelId });
      },
      async startHuddle(userId) {
        await this.openDirectMessage(userId);
        const button = await waitFor(
          '[data-qa="huddle_channel_header_button__start_button"]',
          8e3
        );
        if (!button) return false;
        button.click();
        return true;
      },
      async openStatusEditor() {
        const button = document.querySelector('[data-qa="user-button"]');
        if (!button) return false;
        button.click();
        const item = await waitFor('[data-qa="main-menu-custom-status-item"]', 4e3);
        if (!item) return false;
        item.click();
        return true;
      },
      async vipUsers() {
        const res = await web.call("users.prefs.get");
        return String(res.prefs?.vip_users ?? "").split(",").map((id) => id.trim()).filter(Boolean);
      },
      async setVip(userId, isVip) {
        const current = await this.vipUsers();
        const next = isVip ? [.../* @__PURE__ */ new Set([...current, userId])] : current.filter((id) => id !== userId);
        await web.call("users.prefs.set", { name: "vip_users", value: next.join(",") });
        return isVip;
      },
      async filesFrom(userId, limit = 20) {
        const res = await web.call("files.list", {
          user: userId,
          count: limit
        });
        return Array.isArray(res.files) ? res.files : [];
      },
      describeMessage,
      composer,
      describeStatus,
      renderMrkdwn: (text, options) => renderMrkdwn(text, options),
      /*
       * Replaced by `createPluginApi`, which has the bridge.
       *
       * The socket is the loader's -- the page cannot see it -- so a SlackApi
       * built on its own has no way to reach the events. Every listener answers
       * with a cleanup that does nothing rather than throwing: the docs page
       * builds one of these to draw its previews, and a preview may not be the
       * thing that decides whether an API member exists.
       */
      events: DEAF,
      onTeamChange: (handler) => onTeamChange(handler),
      statusNode,
      emojiUrl: (name, customEmoji) => {
        const clean = String(name ?? "").replace(/^:|:$/g, "").trim();
        if (!clean) return null;
        return imageForEmoji(clean, null, customEmoji);
      },
      avatarUrl: (url, size) => typeof url === "string" && /-\d+$/.test(url) ? url.replace(/-\d+$/, `-${size}`) : null,
      userIdFromMessage: (message) => userIdFromAvatarUrl(
        message.element.querySelector(".c-message_kit__avatar img, .c-avatar img")?.src
      ),
      currentChannelId: () => {
        const fromUrl = location.pathname.match(CONVERSATION_ROUTE)?.[1] ?? null;
        return drawnChannelId()?.toUpperCase() ?? fromUrl;
      },
      currentTeamId: () => currentTeamId(),
      /*
       * Filled in by `createPluginApi`, which is where the settings live. Left
       * inert here so `createSlackApi` still satisfies the type on its own, and
       * so a caller that somehow reaches this copy gets an honest "no" rather
       * than a promise nobody keeps.
       */
      desktop: {
        supported: false,
        keys: () => [],
        get: () => void 0,
        launched: () => void 0,
        needsRestart: () => false,
        set: async () => void 0,
        clear: async () => void 0,
        managed: () => ({}),
        materials: WINDOW_MATERIALS,
        setMaterial
      },
      restart: async () => void 0,
      selectors: SELECTORS
    };
  }

  // src/runtime/ui/palette.ts
  var HOST_ID = "betterslack-palette";
  function statusFor(command) {
    const status = command.status;
    if (!status || !status.imageUrl && !status.text) return null;
    return h("span", { class: "betterslack-palette__status", title: status.text ?? "" }, [
      status.imageUrl ? h("img", { class: "betterslack-palette__status_emoji", src: status.imageUrl, alt: status.emoji ?? "" }) : null,
      status.text ? h("span", { class: "betterslack-palette__status_text" }, [status.text]) : null
    ].filter(Boolean));
  }
  function rank(commands, query) {
    const words2 = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words2.length === 0) return commands;
    const scored = [];
    commands.forEach((command, order2) => {
      const title = command.title.toLowerCase();
      const rest = `${command.source ?? ""} ${command.subtitle ?? ""} ${command.section ?? ""}`.toLowerCase();
      let score = 0;
      let matched = true;
      for (const word of words2) {
        if (title.startsWith(word)) score += 4;
        else if (new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(title)) score += 3;
        else if (title.includes(word)) score += 2;
        else if (rest.includes(word)) score += 1;
        else {
          matched = false;
          break;
        }
      }
      if (!matched && command.always) {
        matched = true;
        score = 1;
      }
      if (matched) scored.push({ command, score, order: order2 });
    });
    return scored.sort((a, b) => b.score - a.score || a.order - b.order).map((entry) => entry.command);
  }
  function closePalette() {
    document.getElementById(HOST_ID)?.remove();
  }
  function isPaletteOpen() {
    return Boolean(document.getElementById(HOST_ID));
  }
  function iconFor(command) {
    const icon = command.icon?.trim();
    if (icon && /^https?:\/\//.test(icon)) {
      return h("img", { class: "betterslack-palette__icon", src: icon, alt: "", loading: "lazy" });
    }
    const box = h("span", { class: "betterslack-palette__icon betterslack-palette__icon--glyph" });
    box.textContent = icon && icon.length <= 2 ? icon : command.title.slice(0, 1).toUpperCase();
    return box;
  }
  function openPalette(source2, labels) {
    closePalette();
    const modes = labels.modes ?? [];
    let mode = null;
    let query = "";
    let shown = [];
    let index = 0;
    let rows = [];
    let generation = 0;
    const input = h("input", {
      class: "betterslack-palette__input",
      type: "text",
      placeholder: labels.placeholder,
      spellcheck: "false",
      "aria-label": labels.placeholder
    });
    const chip = h("span", { class: "betterslack-palette__chip", hidden: "hidden" });
    const list = h("div", { class: "betterslack-palette__list", role: "listbox" });
    const footerAction = h("span", { class: "betterslack-palette__hint" });
    const footerCount = h("span", { class: "betterslack-palette__count" });
    const close = () => {
      window.removeEventListener("keydown", onKey, true);
      document.getElementById(HOST_ID)?.remove();
    };
    const run = (command) => {
      if (!command) return;
      if (!command.keepOpen) close();
      void Promise.resolve(command.run()).catch((err) => {
        console.error(`[betterslack] "${command.title}" failed`, err);
      });
    };
    const select = (next) => {
      if (rows.length === 0) return;
      index = (next + rows.length) % rows.length;
      rows.forEach((row, position) => row.setAttribute("aria-selected", String(position === index)));
      rows[index]?.scrollIntoView({ block: "nearest" });
    };
    const modesBar = h(
      "div",
      { class: "betterslack-palette__modes" },
      modes.map((entry) => {
        const button = h("button", { class: "betterslack-palette__mode", type: "button" }, [
          h("kbd", {}, [entry.prefix]),
          entry.label
        ]);
        button.addEventListener("click", () => {
          input.value = entry.prefix;
          onInput();
          input.focus();
        });
        return button;
      })
    );
    if (modes.length === 0) modesBar.setAttribute("hidden", "hidden");
    let busy = false;
    const paintFooter = () => {
      if (busy) {
        footerCount.replaceChildren(
          h("span", { class: "betterslack-palette__spinner" }),
          h("span", {}, [labels.searching ?? "\u2026"])
        );
        footerCount.classList.add("betterslack-palette__count--busy");
        return;
      }
      footerCount.classList.remove("betterslack-palette__count--busy");
      footerCount.textContent = shown.length > 0 ? `${shown.length}` : "";
    };
    const paint = (entries) => {
      shown = entries;
      list.replaceChildren();
      rows = [];
      if (shown.length === 0) {
        list.append(busy ? h("div", { class: "betterslack-palette__searching" }, [
          h("span", { class: "betterslack-palette__spinner" }),
          h("span", {}, [labels.searching ?? labels.empty])
        ]) : h("div", { class: "betterslack-empty" }, [labels.empty]));
        paintFooter();
        footerAction.textContent = "";
        return;
      }
      const grouped = /* @__PURE__ */ new Map();
      for (const command of shown) {
        const key = command.section ?? "";
        const bucket = grouped.get(key);
        if (bucket) bucket.push(command);
        else grouped.set(key, [command]);
      }
      for (const [heading, commands] of grouped) {
        if (heading) list.append(h("div", { class: "betterslack-palette__section" }, [heading]));
        for (const command of commands) {
          const row = h("button", {
            class: "betterslack-palette__row",
            type: "button",
            role: "option"
          }, [
            iconFor(command),
            h("span", { class: "betterslack-palette__text" }, [
              h("span", { class: "betterslack-palette__titleline" }, [
                h("span", { class: "betterslack-palette__title" }, [
                  command.titleNode ? command.titleNode() : command.title
                ]),
                statusFor(command)
              ].filter(Boolean)),
              command.subtitle || command.subtitleNode ? h("span", { class: "betterslack-palette__sub" }, [
                command.subtitleNode ? command.subtitleNode() : command.subtitle ?? ""
              ]) : null
            ].filter(Boolean)),
            command.source ? h("span", { class: "betterslack-palette__source" }, [command.source]) : null
          ].filter(Boolean));
          const position = rows.length;
          row.addEventListener("click", () => run(command));
          row.addEventListener("mouseenter", () => select(position));
          rows.push(row);
          list.append(row);
        }
      }
      shown = [...grouped.values()].flat();
      paintFooter();
      footerAction.textContent = `\u21B5 ${labels.openHint ?? "open"} \xB7 esc ${labels.closeHint ?? "close"}`;
      select(0);
    };
    const update = () => {
      if (modes.length > 0) {
        if (!mode && query === "") modesBar.removeAttribute("hidden");
        else modesBar.setAttribute("hidden", "hidden");
      }
      const mine = ++generation;
      const answer = typeof source2 === "function" ? source2(query, mode?.id ?? null) : source2;
      if (Array.isArray(answer)) {
        paint(rank(answer, query));
        return;
      }
      paintFooter();
      void answer.then((entries) => {
        if (mine !== generation || !isPaletteOpen()) return;
        paint(rank(entries, query));
      });
    };
    const onInput = () => {
      const raw = input.value;
      if (!mode) {
        const found = modes.find((entry) => raw.startsWith(entry.prefix));
        if (found) {
          mode = found;
          input.value = raw.slice(found.prefix.length);
          chip.textContent = found.label;
          chip.removeAttribute("hidden");
          input.placeholder = found.placeholder ?? labels.placeholder;
        }
      }
      query = input.value.trim();
      update();
    };
    const clearMode = () => {
      mode = null;
      chip.setAttribute("hidden", "hidden");
      chip.textContent = "";
      input.placeholder = labels.placeholder;
      query = "";
      update();
    };
    function onKey(event) {
      if (!isPaletteOpen()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (mode) clearMode();
        else close();
        return;
      }
      if (event.key === "Backspace" && mode && input.value === "") {
        event.preventDefault();
        clearMode();
        return;
      }
      if (event.key === "ArrowDown" || event.ctrlKey && event.key === "n") {
        event.preventDefault();
        event.stopPropagation();
        select(index + 1);
        return;
      }
      if (event.key === "ArrowUp" || event.ctrlKey && event.key === "p") {
        event.preventDefault();
        event.stopPropagation();
        select(index - 1);
        return;
      }
      if (event.key === "Home" && !event.shiftKey && input.value === "") {
        select(0);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        run(shown[index]);
      }
    }
    input.addEventListener("input", onInput);
    const host = h("div", { id: HOST_ID, class: "betterslack-palette", role: "dialog", "aria-modal": "true" }, [
      h("div", { class: "betterslack-palette__box" }, [
        h("div", { class: "betterslack-palette__search" }, [
          h("span", { class: "betterslack-palette__search_icon" }, ["\u2318"]),
          chip,
          input
        ]),
        list,
        modesBar,
        h("div", { class: "betterslack-palette__footer" }, [footerAction, footerCount])
      ])
    ]);
    host.addEventListener("mousedown", (event) => {
      if (event.target === host) close();
    });
    document.body.append(host);
    window.addEventListener("keydown", onKey, true);
    update();
    queueMicrotask(() => input.focus());
    close.refresh = () => {
      if (isPaletteOpen()) update();
    };
    close.setMode = (id, next) => {
      if (!isPaletteOpen()) return;
      if (id === null) {
        clearMode();
        if (next !== void 0) input.value = next;
        onInput();
        input.focus();
        return;
      }
      const found = modes.find((entry) => entry.id === id);
      if (!found) return;
      input.value = found.prefix + (next ?? input.value);
      mode = null;
      chip.setAttribute("hidden", "hidden");
      onInput();
      input.focus();
    };
    close.setBusy = (on) => {
      if (busy === on) return;
      busy = on;
      if (!isPaletteOpen()) return;
      if (shown.length === 0) update();
      else paintFooter();
    };
    return close;
  }

  // src/runtime/ui/widgets.ts
  var TOAST_HOST_ID = "betterslack-toast-host";
  function makeHost(id) {
    const existing = document.getElementById(id);
    if (existing?.shadowRoot) return { host: existing, root: existing.shadowRoot };
    const host = h("div", { id });
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = WIDGET_CSS;
    root.append(style);
    document.body.append(host);
    return { host, root };
  }
  function toast(message, options = {}) {
    const { variant = "info", duration = 2200, action } = options;
    const { root } = makeHost(TOAST_HOST_ID);
    let stack = root.querySelector(".toast-stack");
    if (!stack) {
      stack = h("div", { class: "toast-stack", role: "status", "aria-live": "polite" });
      root.append(stack);
    }
    const node = h("div", { class: `toast toast--${variant}` }, [
      h("span", { class: "toast__text" }, [message])
    ]);
    let timer;
    const dismiss = () => {
      clearTimeout(timer);
      node.dataset.leaving = "true";
      setTimeout(() => node.remove(), 160);
    };
    if (action) {
      const button = h("button", { class: "toast__action", type: "button" }, [action.label]);
      button.addEventListener("click", () => {
        action.onClick();
        dismiss();
      });
      node.append(button);
    }
    stack.append(node);
    requestAnimationFrame(() => {
      node.dataset.shown = "true";
    });
    if (duration > 0) timer = setTimeout(dismiss, duration);
    return { dismiss };
  }
  function modal(options) {
    const {
      title,
      subtitle,
      content,
      actions = [],
      width = 520,
      dismissible = true,
      onClose
    } = options;
    const host = h("div", {
      class: "c-dialog betterslack-dialog betterslack-widget_dialog",
      role: "presentation"
    });
    document.body.append(host);
    const body = h("div", { class: "c-dialog__body betterslack-body" });
    if (typeof content === "string") body.append(h("p", { class: "betterslack-hint" }, [content]));
    else if (content) body.append(content);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", onKeyDown, true);
      host.remove();
      onClose?.();
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape" && dismissible) {
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    const closeButton = h("button", {
      class: "c-button-unstyled c-icon_button c-icon_button--size_medium c-icon_button--default betterslack-close",
      type: "button",
      "aria-label": "Close"
    });
    closeButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true" style="--s:20px"><path fill="currentColor" d="M5.72 5.72a.75.75 0 0 1 1.06 0L10 8.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L11.06 10l3.22 3.22a.75.75 0 1 1-1.06 1.06L10 11.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L8.94 10 5.72 6.78a.75.75 0 0 1 0-1.06Z"/></svg>';
    closeButton.addEventListener("click", close);
    const titles = h("div", { class: "betterslack-widget_titles" }, [
      h("h1", { class: "c-dialog__title" }, [title]),
      ...subtitle ? [h("p", { class: "betterslack-hint betterslack-widget_subtitle" }, [subtitle])] : []
    ]);
    const header = h("div", { class: "c-dialog__header betterslack-header" }, [titles]);
    if (dismissible) header.append(closeButton);
    const footer = h("div", { class: "c-dialog__footer betterslack-widget_footer" });
    for (const action of actions) {
      const variant = action.variant === "primary" ? "c-button--primary" : action.variant === "danger" ? "c-button--danger" : "c-button--outline";
      const button = h("button", {
        class: `c-button ${variant} c-button--medium`,
        type: "button"
      }, [action.label]);
      button.addEventListener("click", async () => {
        const keepOpen = await action.onClick?.() === false;
        if (!keepOpen) close();
      });
      footer.append(button);
    }
    const content_ = h("div", {
      class: "c-dialog__content betterslack-content betterslack-widget_content",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": title,
      style: `width: min(${width}px, calc(100% - 32px)); max-width: min(${width}px, calc(100% - 32px));`
    }, [header, body, ...actions.length > 0 ? [footer] : []]);
    host.append(content_);
    if (dismissible) {
      host.addEventListener("mousedown", (event) => {
        if (event.target === host) close();
      });
    }
    queueMicrotask(() => host.querySelector(".c-button, .betterslack-close")?.focus());
    return { close, body };
  }
  function confirm(options) {
    const { title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false } = options;
    return new Promise((resolve) => {
      let answered = false;
      const settle = (value) => {
        if (answered) return;
        answered = true;
        resolve(value);
      };
      modal({
        title,
        content: message,
        width: 420,
        actions: [
          { label: cancelLabel, variant: "default", onClick: () => settle(false) },
          { label: confirmLabel, variant: danger ? "danger" : "primary", onClick: () => settle(true) }
        ],
        onClose: () => settle(false)
      });
    });
  }

  // src/runtime/ui/menu.ts
  var LAYER_ID = "betterslack-menu-layer";
  var MARGIN = 8;
  function closeMenu() {
    document.getElementById(LAYER_ID)?.remove();
  }
  function openMenu(anchor, items, options = {}) {
    closeMenu();
    const doc = anchor.ownerDocument;
    let arming;
    const close = () => {
      clearTimeout(arming);
      (doc.defaultView ?? window).removeEventListener("resize", place);
      doc.removeEventListener("mousedown", onDown, true);
      doc.removeEventListener("keydown", onKey, true);
      doc.getElementById(LAYER_ID)?.remove();
      options.onClose?.();
    };
    const onDown = (event) => {
      const layer2 = doc.getElementById(LAYER_ID);
      if (layer2 && !layer2.contains(event.target)) close();
    };
    const onKey = (event) => {
      if (event.key === "Escape") close();
    };
    const list = h("div", { class: "c-menu__items", role: "menu", tabindex: "-1" });
    for (const item of items) {
      const button = h("button", {
        class: "c-button-unstyled c-menu_item__button",
        role: "menuitem",
        type: "button",
        ...item.disabled ? { disabled: "disabled", "aria-disabled": "true" } : {}
      }, [
        item.icon ? h("span", { class: "c-menu_item__icon" }) : null,
        h("div", { class: `c-menu_item__label${item.danger ? " betterslack-danger" : ""}` }, [item.label])
      ].filter(Boolean));
      if (item.icon) {
        const icon = button.querySelector(".c-menu_item__icon");
        if (icon) icon.innerHTML = item.icon;
      }
      if (!item.disabled) {
        button.addEventListener("click", () => {
          close();
          item.onSelect();
        });
      }
      list.append(h("div", { class: "c-menu_item__li", "data-qa": "menu_item_button-wrapper" }, [button]));
    }
    const layer = h("div", { id: LAYER_ID, class: "betterslack-menu_layer" }, [
      h("div", { class: "c-menu" }, [h("div", { class: "c-menu__items_scroller" }, [list])])
    ]);
    doc.body.append(layer);
    const view = doc.defaultView ?? window;
    const scroller = layer.querySelector(".c-menu__items_scroller");
    function place() {
      if (scroller) scroller.style.maxHeight = "";
      const rect = anchor.getBoundingClientRect();
      const { width, height } = layer.getBoundingClientRect();
      const edge = options.align === "left" ? rect.left : rect.right - width;
      const left = Math.max(MARGIN, Math.min(edge, view.innerWidth - width - MARGIN));
      const below = view.innerHeight - rect.bottom - 4 - MARGIN;
      const above = rect.top - 4 - MARGIN;
      let top;
      if (height <= below) top = rect.bottom + 4;
      else if (height <= above) top = rect.top - height - 4;
      else {
        const room = Math.max(below, above);
        if (scroller) {
          scroller.style.maxHeight = `${Math.max(120, room)}px`;
          scroller.style.overflowY = "auto";
        }
        const fitted = Math.min(height, Math.max(120, room));
        top = below >= above ? rect.bottom + 4 : rect.top - fitted - 4;
      }
      layer.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
    }
    place();
    view.addEventListener("resize", place);
    arming = setTimeout(() => {
      doc.addEventListener("mousedown", onDown, true);
      doc.addEventListener("keydown", onKey, true);
    }, 0);
    return close;
  }

  // src/runtime/slack-events.ts
  var NOT_A_POST = /* @__PURE__ */ new Set([
    "message_changed",
    "message_deleted",
    "message_replied",
    "channel_join",
    "channel_leave",
    "group_join",
    "group_leave"
  ]);
  var str = (value) => typeof value === "string" ? value : "";
  var orNull = (value) => typeof value === "string" && value ? value : null;
  function createSlackEvents(bridge) {
    const subscriptions = /* @__PURE__ */ new Set();
    let told = "";
    const watching = () => {
      const all = /* @__PURE__ */ new Set();
      for (const sub of subscriptions) for (const type of sub.types) all.add(type);
      return [...all].sort();
    };
    const publish = () => {
      const types = watching();
      const key = types.join(",");
      if (key === told) return;
      told = key;
      void bridge.request({ type: "slack.watch", types }).catch(() => {
        told = "";
      });
    };
    const on = (types, handler) => {
      const sub = { types: new Set(types.filter(Boolean)), handler };
      subscriptions.add(sub);
      publish();
      return () => {
        subscriptions.delete(sub);
        publish();
      };
    };
    const shaped = (types, read, handler) => on(types, (event) => {
      const value = read(event);
      if (value !== null) handler(value);
    });
    const team = (event) => orNull(event.teamId) ?? orNull(event.team);
    return {
      on,
      watching,
      onMessage: (handler) => shaped(["message"], (event) => {
        const subtype = orNull(event.subtype);
        if (subtype && NOT_A_POST.has(subtype)) return null;
        const channelId = orNull(event.channel);
        const ts = orNull(event.ts);
        if (!channelId || !ts) return null;
        return {
          channelId,
          teamId: team(event),
          ts,
          userId: orNull(event.user),
          text: str(event.text),
          threadTs: orNull(event.thread_ts),
          subtype,
          botId: orNull(event.bot_id) ?? orNull(event.app_id),
          raw: event
        };
      }, handler),
      onMessageChanged: (handler) => shaped(["message"], (event) => {
        if (event.subtype !== "message_changed") return null;
        const message = event.message ?? {};
        const previous = event.previous_message ?? {};
        const channelId = orNull(event.channel);
        const ts = orNull(message.ts) ?? orNull(event.ts);
        const before = str(previous.text);
        const after = str(message.text);
        if (!channelId || !ts || !before || before === after) return null;
        return {
          channelId,
          teamId: team(event),
          ts,
          userId: orNull(message.user) ?? orNull(previous.user),
          before,
          after,
          botId: orNull(message.bot_id) ?? orNull(previous.bot_id) ?? orNull(message.app_id) ?? orNull(previous.app_id),
          raw: event
        };
      }, handler),
      onMessageDeleted: (handler) => shaped(["message"], (event) => {
        if (event.subtype !== "message_deleted") return null;
        const previous = event.previous_message ?? {};
        const channelId = orNull(event.channel);
        const ts = orNull(event.deleted_ts) ?? orNull(previous.ts);
        if (!channelId || !ts) return null;
        return {
          channelId,
          teamId: team(event),
          ts,
          userId: orNull(previous.user),
          text: str(previous.text),
          botId: orNull(previous.bot_id) ?? orNull(previous.app_id),
          raw: event
        };
      }, handler),
      onReaction: (handler) => shaped(["reaction_added", "reaction_removed"], (event) => {
        const item = event.item ?? {};
        const channelId = orNull(item.channel) ?? orNull(event.channel);
        const ts = orNull(item.ts);
        const userId = orNull(event.user);
        const emoji2 = orNull(event.reaction);
        if (!channelId || !ts || !userId || !emoji2) return null;
        return {
          added: event.type === "reaction_added",
          channelId,
          teamId: team(event),
          ts,
          emoji: emoji2,
          userId,
          raw: event
        };
      }, handler),
      onMembership: (handler) => shaped(
        ["member_joined_channel", "member_left_channel", "message"],
        (event) => {
          const joining = event.type === "member_joined_channel" || event.subtype === "channel_join" || event.subtype === "group_join";
          const leaving = event.type === "member_left_channel" || event.subtype === "channel_leave" || event.subtype === "group_leave";
          if (!joining && !leaving) return null;
          const channelId = orNull(event.channel);
          const userId = orNull(event.user);
          if (!channelId || !userId) return null;
          return { joined: joining, channelId, teamId: team(event), userId, raw: event };
        },
        handler
      ),
      onConversation: (handler) => shaped(
        [
          "channel_created",
          "channel_rename",
          "channel_archive",
          "channel_unarchive",
          "channel_deleted",
          "group_rename",
          "group_archive",
          "group_unarchive"
        ],
        (event) => {
          const channel2 = typeof event.channel === "object" && event.channel ? event.channel : {};
          const channelId = orNull(channel2.id) ?? orNull(event.channel);
          if (!channelId) return null;
          const kind = event.type.includes("created") ? "created" : event.type.includes("rename") ? "renamed" : event.type.includes("unarchive") ? "unarchived" : event.type.includes("archive") ? "archived" : "deleted";
          return {
            kind,
            channelId,
            teamId: team(event),
            name: orNull(channel2.name),
            raw: event
          };
        },
        handler
      ),
      onUserChanged: (handler) => shaped(["user_change"], (event) => {
        const user = event.user ?? {};
        const userId = orNull(user.id);
        if (!userId) return null;
        return { userId, teamId: team(event) ?? orNull(user.team_id), user, raw: event };
      }, handler),
      onPresence: (handler) => shaped(["presence_change"], (event) => {
        const userIds = Array.isArray(event.users) ? event.users.map(str).filter(Boolean) : [orNull(event.user)].filter((id) => Boolean(id));
        if (userIds.length === 0) return null;
        return { userIds, presence: str(event.presence), teamId: team(event), raw: event };
      }, handler),
      onTyping: (handler) => shaped(["user_typing"], (event) => {
        const channelId = orNull(event.channel);
        const userId = orNull(event.user);
        if (!channelId || !userId) return null;
        return { channelId, teamId: team(event), userId, raw: event };
      }, handler),
      onRead: (handler) => shaped(
        ["channel_marked", "im_marked", "group_marked", "thread_marked"],
        (event) => {
          const channelId = orNull(event.channel);
          if (!channelId) return null;
          return { channelId, teamId: team(event), ts: str(event.ts), raw: event };
        },
        handler
      ),
      onPin: (handler) => shaped(["pin_added", "pin_removed"], (event) => {
        const item = event.item ?? {};
        const message = item.message ?? {};
        return {
          added: event.type === "pin_added",
          channelId: orNull(event.channel_id) ?? orNull(event.channel) ?? orNull(item.channel),
          teamId: team(event),
          ts: orNull(message.ts) ?? orNull(item.ts),
          raw: event
        };
      }, handler),
      onSaved: (handler) => shaped(["star_added", "star_removed"], (event) => {
        const item = event.item ?? {};
        const message = item.message ?? {};
        return {
          added: event.type === "star_added",
          channelId: orNull(item.channel) ?? orNull(event.channel),
          teamId: team(event),
          ts: orNull(message.ts) ?? orNull(item.ts),
          raw: event
        };
      }, handler),
      onEmojiChanged: (handler) => shaped(["emoji_changed"], (event) => ({
        kind: str(event.subtype) || "add",
        names: Array.isArray(event.names) ? event.names.map(str).filter(Boolean) : [orNull(event.name)].filter((n) => Boolean(n)),
        teamId: team(event),
        raw: event
      }), handler),
      deliver(event) {
        if (typeof event?.type !== "string") return;
        for (const sub of [...subscriptions]) {
          if (!sub.types.has(event.type)) continue;
          try {
            sub.handler(event);
          } catch (err) {
            console.error("[betterslack] a listener threw on a Slack event:", err);
          }
        }
      }
    };
  }

  // tests/slack-fixture.mjs
  var SLACK_FIXTURE = `
<div class="p-client_container">
  <div class="p-view_header__actions">
    <button data-qa="avatar_stack" aria-label="View all members"></button>
  </div>
  <div class="p-control_strip">
    <div class="c-coachmark-anchor">
      <button data-qa="user-button">
        <span class="c-avatar" data-mask="mask__base-member">
          <img src="https://ca.slack-edge.com/T0EXAMPLE1-U0EXAMPLE1-480e63356723-48">
          <!-- Where Slack keeps your own availability, and swaps the modifier
               the moment it changes. Measured against Slack 4.51. -->
          <span class="c-avatar__presence c-presence c-presence--active block"></span>
        </span>
        <svg data-qa="presence_indicator" aria-label="Active"></svg>
      </button>
    </div>
  </div>

  <div class="p-tab_rail p-tab_rail__desktop" data-qa="tab_rail_desktop">
    <div class="p-tab_rail__tab_container" data-qa="tabs_full_height_class">
      <div class="p-tab_rail__tab_menu" data-qa="tabs_full_width_class">
        <button class="p-tab_rail__button p-tab_rail__button--active" data-qa="tab_rail_home_button">
          <div class="p-tab_rail__button__icon"></div>
          <div class="p-tab_rail__button__label">Home</div>
        </button>
        <button class="p-tab_rail__button" data-qa="tab_rail_dms_button">
          <div class="p-tab_rail__button__icon"></div>
          <div class="p-tab_rail__button__label">DMs</div>
        </button>
      </div>
    </div>
  </div>

  <div class="p-client_workspace__tabpanel">
  <div class="p-channel_sidebar" data-qa="channel-sidebar">
    <div class="p-ia4_sidebar_header p-ia4_home_header">
      <div class="p-ia4_sidebar_header__title">Acme</div>
      <div class="p-ia4_sidebar_header__controls"></div>
    </div>
    <div class="p-channel_sidebar__list"></div>
  </div>

  <div class="p-view_contents p-view_contents--primary">
    <div class="p-message_pane">
      <div data-qa="message_container"
           data-msg-ts="1786386808.130969"
           data-msg-channel-id="C0BFQCYBRAB">
        <div class="c-message_kit__avatar">
          <img src="https://ca.slack-edge.com/T0EXAMPLE1-U0EXAMPLE2-dc5119d9e23c-48">
        </div>
        <a class="c-timestamp" href="https://acme.slack.com/archives/C0BFQCYBRAB/p1786386808130969"></a>
        <div data-qa="message-text">hello world</div>
        <div data-qa="message-actions"></div>
      </div>

      <div data-qa="message_input">
        <div class="ql-editor"><p><br></p></div>
        <div><button data-qa="bold-composer-button"></button></div>
      </div>
    </div>
  </div>
  </div>

  <div data-qa="member_profile_pane">
    <div class="p-r_member_profile__container">
      <img class="p-r_member_profile__avatar__img"
           src="https://ca.slack-edge.com/T0EXAMPLE1-U0EXAMPLE2-dc5119d9e23c-512">
    </div>
  </div>
</div>`;

  // src/shared/protocol.ts
  var SLACK_PREFS = [
    { key: "windowVibrancy", type: "boolean", restart: true, defaults: true, note: "A translucent window: macOS vibrancy, Windows 11 acrylic. Off by default." },
    { key: "userTheme", type: "string", restart: false, defaults: false, note: "Slack's own light/dark choice." },
    { key: "systemThemeSyncEnabled", type: "boolean", restart: false, defaults: false, note: "Follow the operating system's light/dark setting." },
    { key: "launchOnStartup", type: "boolean", restart: false, defaults: false, note: "Start Slack when you sign in." },
    { key: "runFromTray", type: "boolean", restart: false, defaults: false, note: "Keep Slack in the menu bar or tray when its window closes." },
    { key: "hideOnStartup", type: "boolean", restart: false, defaults: false, note: "Start without showing the window." },
    { key: "autoHideMenuBar", type: "boolean", restart: false, defaults: false, note: "Windows and Linux: hide the menu bar until Alt." },
    { key: "useHwAcceleration", type: "boolean", restart: true, defaults: true, note: "GPU acceleration." },
    { key: "shouldUseHighContrastColors", type: "boolean", restart: false, defaults: false, note: "Higher-contrast colours throughout." },
    { key: "spellcheckerLanguage", type: "string", restart: false, defaults: false, note: "Language tag the spell checker uses." },
    { key: "notificationMethod", type: "string", restart: true, defaults: false, note: "How desktop notifications are delivered. Read by the main process at launch." },
    { key: "notificationPlayback", type: "string", restart: true, defaults: false, note: `Who plays a notification's sound: "web" is Slack, in the page; "system" hands it to the operating system with the files Slack ships. Read at launch -- and on macOS 12 and later Slack forces "system" at every launch, so a value written here does not survive there.` },
    { key: "zoomLevel", type: "number", restart: true, defaults: false, note: "Interface zoom, in Chromium steps." }
  ];
  var NET_TIMEOUT_MS = 25e3;

  // src/loader/net.ts
  var MAX_ANSWER_BYTES = 4 * 1024 * 1024;
  var MAX_FORM_BYTES = 64 * 1024;
  var MAX_FORM_FIELDS = 50;
  function httpsUrl(value) {
    let url;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url;
  }
  function allowedBases(record, values) {
    const bases = [];
    for (const key of record.network?.settings ?? []) {
      const declared = record.settings?.find((field) => field.key === key);
      const value = key in values ? values[key] : declared?.default;
      if (typeof value !== "string" || !value.trim()) continue;
      const base = httpsUrl(value.trim());
      if (base) bases.push(base);
    }
    return bases;
  }
  function within(url, base) {
    if (url.origin !== base.origin) return false;
    if (/%2f|%5c/i.test(url.pathname)) return false;
    if (url.pathname === base.pathname) return true;
    const folder = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
    return url.pathname.startsWith(folder);
  }
  function isForm(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const entries = Object.entries(value);
    return entries.length <= MAX_FORM_FIELDS && entries.every(([key, field]) => key !== "" && typeof field === "string");
  }
  var TooLarge = class extends Error {
  };
  var failure = (error) => ({ error });
  function isTimeout(err) {
    const name = err?.name;
    return name === "TimeoutError" || name === "AbortError";
  }
  async function readCapped(response, max) {
    if (Number(response.headers.get("content-length") ?? "0") > max) {
      await response.body?.cancel().catch(() => void 0);
      throw new TooLarge();
    }
    if (!response.body) return "";
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel().catch(() => void 0);
        throw new TooLarge();
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  }
  function parseJson(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  async function netRequest(record, enabled, values, request, fetchImpl = fetch) {
    if (!record || record.type !== "plugin" || !enabled) return failure("blocked");
    const url = typeof request.url === "string" ? httpsUrl(request.url) : null;
    if (!url) return failure("blocked");
    url.hash = "";
    if (!allowedBases(record, values).some((base) => within(url, base))) return failure("blocked");
    const method = request.method ?? (request.form === void 0 ? "GET" : "POST");
    if (method !== "GET" && method !== "POST") return failure("invalid");
    let body;
    if (request.form !== void 0) {
      if (method !== "POST" || !isForm(request.form)) return failure("invalid");
      body = new URLSearchParams(request.form).toString();
      if (body.length > MAX_FORM_BYTES) return failure("invalid");
    }
    let response;
    try {
      response = await fetchImpl(url.href, {
        method,
        body,
        headers: body === void 0 ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
        redirect: "manual",
        signal: AbortSignal.timeout(NET_TIMEOUT_MS)
      });
    } catch (err) {
      return failure(isTimeout(err) ? "timeout" : "network");
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => void 0);
      return { status: response.status, json: null };
    }
    try {
      return { status: response.status, json: parseJson(await readCapped(response, MAX_ANSWER_BYTES)) };
    } catch (err) {
      if (err instanceof TooLarge) return failure("too-large");
      return failure(isTimeout(err) ? "timeout" : "network");
    }
  }

  // src/runtime/ui/kit.ts
  function createKit(doc = document) {
    const el2 = (tag, props = {}, children = []) => {
      const node = doc.createElement(tag);
      for (const [key, value] of Object.entries(props)) {
        if (value === void 0 || value === null) continue;
        if (key === "class") node.className = String(value);
        else if (key === "html") node.innerHTML = String(value);
        else if (key.includes("-")) node.setAttribute(key, String(value));
        else node[key] = value;
      }
      for (const child of children) {
        if (child === null || child === void 0 || child === false) continue;
        node.append(typeof child === "string" ? doc.createTextNode(child) : child);
      }
      return node;
    };
    const button = (label, { variant = "default", icon, onClick, title, wide, onHover } = {}) => {
      const node = el2("button", { class: `sm-btn sm-btn--${variant}`, title, type: "button" }, [
        icon ? el2("span", { class: "sm-btn__icon", html: icon }) : null,
        el2("span", { textContent: label })
      ]);
      if (wide) node.classList.add("sm-btn--wide");
      if (onClick) node.addEventListener("click", onClick);
      if (onHover) hoverable(node, onHover);
      return node;
    };
    const iconButton = (glyph, { onClick, title, danger } = {}) => {
      const node = el2("button", {
        class: `sm-icon-btn${danger ? " sm-icon-btn--danger" : ""}`,
        title,
        type: "button",
        "aria-label": title ?? "",
        html: glyph
      });
      if (onClick) node.addEventListener("click", onClick);
      return node;
    };
    const hoverable = (node, { enter, leave }) => {
      node.addEventListener("mouseenter", enter);
      node.addEventListener("focus", enter);
      node.addEventListener("mouseleave", leave);
      node.addEventListener("blur", leave);
      return node;
    };
    const field = (label, control2, hint) => el2("div", { class: "sm-field" }, [
      el2("label", { class: "sm-field__label", textContent: label }),
      control2,
      hint ? el2("p", { class: "sm-field__hint", textContent: hint }) : null
    ]);
    const input = (props = {}) => {
      const { class: extra, ...rest } = props;
      return el2("input", {
        class: extra ? `sm-input ${String(extra)}` : "sm-input",
        type: "text",
        spellcheck: false,
        ...rest
      });
    };
    const select = (options, { onChange, title } = {}) => {
      const node = el2("select", { class: "sm-input sm-select", title });
      for (const option of options) {
        node.append(el2("option", { value: option.value, textContent: option.label }));
      }
      if (onChange) node.addEventListener("change", () => onChange(node.value));
      return node;
    };
    const segmented = (options, { onChange } = {}) => {
      const node = el2("div", { class: "sm-segmented", role: "tablist" });
      let value = options[0]?.value ?? "";
      const buttons = /* @__PURE__ */ new Map();
      const set = (next) => {
        value = next;
        for (const [key, item] of buttons) item.setAttribute("aria-selected", String(key === next));
      };
      for (const option of options) {
        const item = el2("button", {
          class: "sm-segmented__item",
          type: "button",
          role: "tab",
          title: option.title
        }, [
          el2("span", { textContent: option.label }),
          option.count === void 0 ? null : el2("em", { textContent: String(option.count) })
        ]);
        item.addEventListener("click", () => {
          set(option.value);
          onChange?.(option.value);
        });
        buttons.set(option.value, item);
        node.append(item);
      }
      set(value);
      return { node, set, value: () => value };
    };
    const card = (title, children, { actions, subtitle } = {}) => el2("section", { class: "sm-card" }, [
      title ? el2("header", { class: "sm-card__head" }, [
        el2("div", {}, [
          el2("h2", { textContent: title }),
          subtitle ? el2("p", { textContent: subtitle }) : null
        ]),
        actions ? el2("div", { class: "sm-card__actions" }, actions) : null
      ]) : null,
      el2("div", { class: "sm-card__body" }, children)
    ]);
    const emptyState = (title, body, action) => el2("div", { class: "sm-empty" }, [
      el2("h3", { textContent: title }),
      el2("p", { textContent: body }),
      action ?? null
    ]);
    const CHECKER = "linear-gradient(45deg,rgba(0,0,0,.28) 25%,transparent 25%),linear-gradient(-45deg,rgba(0,0,0,.28) 25%,transparent 25%),linear-gradient(45deg,transparent 75%,rgba(0,0,0,.28) 75%),linear-gradient(-45deg,transparent 75%,rgba(0,0,0,.28) 75%)";
    const swatch = (css, { size = "md" } = {}) => {
      const node = el2("span", { class: `sm-swatch sm-swatch--${size}` });
      node.style.backgroundImage = `linear-gradient(${css}, ${css}), ${CHECKER}`;
      return node;
    };
    const popover = (content, anchor, { onClose } = {}) => {
      const node = el2("div", { class: "sm-popover" }, [content]);
      doc.body.append(node);
      const place = () => {
        const box = anchor.getBoundingClientRect();
        const own = node.getBoundingClientRect();
        const margin = 8;
        let top = box.bottom + 6;
        if (top + own.height > doc.documentElement.clientHeight - margin) {
          top = Math.max(margin, box.top - own.height - 6);
        }
        let left = box.left;
        if (left + own.width > doc.documentElement.clientWidth - margin) {
          left = Math.max(margin, doc.documentElement.clientWidth - own.width - margin);
        }
        node.style.top = `${top}px`;
        node.style.left = `${left}px`;
      };
      place();
      const close = () => {
        doc.removeEventListener("mousedown", outside, true);
        doc.removeEventListener("keydown", escape2, true);
        doc.defaultView.removeEventListener("resize", place);
        node.remove();
        onClose?.();
      };
      const outside = (event) => {
        const target = event.target;
        if (!node.contains(target) && !anchor.contains(target)) close();
      };
      const escape2 = (event) => {
        if (event.key === "Escape") close();
      };
      doc.addEventListener("mousedown", outside, true);
      doc.addEventListener("keydown", escape2, true);
      doc.defaultView.addEventListener("resize", place);
      return { node, close, place };
    };
    const confirm2 = ({ title, body, action, cancel: cancelLabel, danger }) => new Promise((resolve) => {
      const scrim = el2("div", { class: "sm-scrim" });
      const cancel = button(cancelLabel, { variant: "ghost" });
      const go = button(action, { variant: danger ? "danger" : "primary" });
      const dialog = el2("div", { class: "sm-dialog", role: "dialog", "aria-modal": "true" }, [
        el2("h2", { textContent: title }),
        el2("p", { textContent: body }),
        el2("div", { class: "sm-dialog__actions" }, [cancel, go])
      ]);
      scrim.append(dialog);
      doc.body.append(scrim);
      const close = (answer) => {
        doc.removeEventListener("keydown", key, true);
        scrim.remove();
        resolve(answer);
      };
      const key = (event) => {
        if (event.key === "Escape") close(false);
      };
      cancel.addEventListener("click", () => close(false));
      go.addEventListener("click", () => close(true));
      scrim.addEventListener("mousedown", (event) => {
        if (event.target === scrim) close(false);
      });
      doc.addEventListener("keydown", key, true);
      go.focus();
    });
    const copyText = async (text) => {
      try {
        await doc.defaultView.navigator.clipboard.writeText(text);
        return true;
      } catch {
        const scratch = el2("textarea", { value: text });
        scratch.style.position = "fixed";
        scratch.style.opacity = "0";
        doc.body.append(scratch);
        scratch.select();
        const done = doc.execCommand("copy");
        scratch.remove();
        return done;
      }
    };
    return {
      el: el2,
      button,
      iconButton,
      field,
      input,
      select,
      segmented,
      card,
      emptyState,
      swatch,
      popover,
      confirm: confirm2,
      copyText,
      hoverable,
      CHECKER,
      code: (options = {}) => createCodeEditor(doc, options)
    };
  }

  // src/runtime/ui/kit-css.ts
  var KIT_CSS = `/* The design system, as a stylesheet.
 *
 * Injected by a mod into whatever document it is building in -- a window it
 * opened, most often, where none of Slack's own stylesheet exists. Everything
 * is prefixed sm- so it cannot collide with Slack's classes if it is put into
 * the client itself.
 *
 * The palette below is Slack's own dark one, fixed rather than read from the
 * app's tokens: a tool that repaints itself with the theme being edited becomes
 * unreadable exactly when the theme is wrong, which is the moment you need it.
 * A mod that wants to follow the theme can override these five variables.
 */

:root {
  --sm-bg: #1a1d21;
  --sm-raised: #222529;
  --sm-raised-2: #27292d;
  --sm-hover: rgba(255, 255, 255, .04);
  --sm-line: rgba(255, 255, 255, .13);
  --sm-line-soft: rgba(255, 255, 255, .07);
  --sm-text: #d1d2d3;
  --sm-bright: #f8f8f8;
  --sm-muted: #9a9b9d;
  --sm-accent: #1d9bd1;
  --sm-primary: #007a5a;
  --sm-primary-hover: #148567;
  --sm-danger: #e01e5a;
  --sm-good: #2bac76;
  --sm-focus: #1264a3;
  --sm-font: Lato, Slack-Lato, appleLogo, -apple-system, sans-serif;
  --sm-mono: Monaco, Menlo, Consolas, monospace;

  /* How the kit moves.
   *
   * Values, not rules, so the whole design system has one tempo and anything
   * that wants to change it changes six numbers rather than forty
   * declarations. A mod with an opinion -- the Motion mod is the one this was
   * built for -- redefines these on the root of whatever document the kit is
   * in, and every control below follows without knowing it exists.
   *
   * Set to 0 and the kit is still: sm-motion-shift and sm-motion-pop are the
   * only sources of travel in here.
   */
  --sm-motion-quick: 120ms;
  --sm-motion-base: 200ms;
  --sm-motion-ease: cubic-bezier(.2, .9, .25, 1);
  --sm-motion-spring: cubic-bezier(.22, 1.4, .36, 1);
  --sm-motion-shift: 8px;
  --sm-motion-pop: .06;
}

/* ================================================================== motion */

/* A design system with no transitions is a design system that is finished
 * everywhere except in time. Every rule here is additive -- it sets transition,
 * animation or transform and nothing else -- so a document that zeroes the
 * tokens above gets exactly the layout it had before. */

.sm-btn,
.sm-icon-btn,
.sm-input,
.sm-select,
.sm-swatch,
.sm-segmented__item {
  transition:
    background-color var(--sm-motion-quick) var(--sm-motion-ease),
    border-color var(--sm-motion-quick) var(--sm-motion-ease),
    color var(--sm-motion-quick) var(--sm-motion-ease),
    box-shadow var(--sm-motion-quick) var(--sm-motion-ease),
    transform var(--sm-motion-quick) var(--sm-motion-ease);
}

.sm-swatch:hover {
  transform: translateY(calc(var(--sm-motion-shift) * -.35))
             scale(calc(1 + var(--sm-motion-pop) * .8));
}

.sm-btn:active,
.sm-icon-btn:active,
.sm-swatch:active,
.sm-segmented__item:active {
  transform: scale(calc(1 - var(--sm-motion-pop)));
  transition-duration: 60ms;
}

@keyframes sm-motion-arrive {
  from {
    opacity: 0;
    transform: translateY(calc(var(--sm-motion-shift) * .8))
               scale(calc(1 - var(--sm-motion-pop)));
  }
  to { opacity: 1; transform: none; }
}

@keyframes sm-motion-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

.sm-dialog, .sm-popover { animation: sm-motion-arrive var(--sm-motion-base) var(--sm-motion-spring); }
.sm-scrim { animation: sm-motion-fade var(--sm-motion-base) var(--sm-motion-ease); }

/* The kit is used in windows a mod opened, which have no other stylesheet and
 * so no other chance to honour this. Fades stay; travel goes -- which is what
 * reduced motion asks for, rather than stillness. */
@media (prefers-reduced-motion: reduce) {
  :root { --sm-motion-shift: 0px; --sm-motion-pop: 0; }
}

/* ================================================================ controls */

.sm-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 12px 1px;
  border-radius: 4px;
  border: none;
  font: 900 15px/1 var(--sm-font);
  color: var(--sm-bright);
  background: transparent;
  cursor: pointer;
  white-space: nowrap;
}
.sm-btn--primary { background: var(--sm-primary); }
.sm-btn--primary:hover { background: var(--sm-primary-hover); }
.sm-btn--default { box-shadow: inset 0 0 0 1px var(--sm-line); }
.sm-btn--default:hover { background: var(--sm-hover); }
.sm-btn--ghost { color: var(--sm-text); box-shadow: inset 0 0 0 1px var(--sm-line); }
.sm-btn--ghost:hover { background: var(--sm-hover); color: var(--sm-bright); }
.sm-btn[data-on="true"] { background: var(--sm-danger); color: #fff; box-shadow: none; }
.sm-btn--wide { width: 100%; justify-content: center; }
.sm-btn:disabled { opacity: .55; cursor: default; }
.sm-btn:focus-visible, .sm-segmented__item:focus-visible {
  outline: none;
  box-shadow: 0 0 0 4px rgba(29, 155, 209, .5);
}
.sm-btn__icon { display: flex; }
.sm-btn__icon svg { width: 16px; height: 16px; }

.sm-icon-btn {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--sm-muted);
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
}
.sm-icon-btn:hover { background: var(--sm-hover); color: var(--sm-bright); }
.sm-icon-btn--danger:hover { background: rgba(224, 30, 90, .16); color: #ff8ba7; }

.sm-input {
  width: 100%;
  min-width: 0;
  height: 36px;
  padding: 0 11px;
  border-radius: 4px;
  border: 1px solid var(--sm-line);
  background: var(--sm-bg);
  color: var(--sm-bright);
  font: 15px/1 var(--sm-font);
}
.sm-input:focus { outline: none; border-color: var(--sm-focus); box-shadow: 0 0 0 1px var(--sm-focus); }
.sm-input::placeholder { color: var(--sm-muted); }
.sm-select { appearance: none; padding-right: 30px;
  background-image: linear-gradient(45deg, transparent 50%, var(--sm-muted) 50%),
                    linear-gradient(135deg, var(--sm-muted) 50%, transparent 50%);
  background-position: calc(100% - 15px) 15px, calc(100% - 10px) 15px;
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;
}

.sm-field { margin-bottom: 14px; }
.sm-field__label { display: block; font-weight: 700; color: var(--sm-bright); margin-bottom: 4px; font-size: 14px; }
.sm-field__hint { margin: 4px 0 0; font-size: 13px; color: var(--sm-muted); }

.sm-segmented {
  display: flex;
  gap: 2px;
  padding: 2px;
  background: var(--sm-bg);
  border: 1px solid var(--sm-line-soft);
  border-radius: 6px;
  margin: 10px 0 0;
  overflow-x: auto;
}
.sm-segmented__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--sm-muted);
  font: 700 13px/1 var(--sm-font);
  cursor: pointer;
  white-space: nowrap;
}
.sm-segmented__item:hover { color: var(--sm-bright); background: var(--sm-hover); }
.sm-segmented__item[aria-selected="true"] { background: var(--sm-raised-2); color: var(--sm-bright); }
.sm-segmented__item em {
  font-style: normal;
  font-size: 11px;
  color: var(--sm-muted);
  background: rgba(255, 255, 255, .08);
  border-radius: 8px;
  padding: 1px 6px;
}


/* ================================================================= swatches */

.sm-swatch {
  display: block;
  flex: 0 0 auto;
  border-radius: 4px;
  border: 1px solid var(--sm-line);
  background-size: 10px 10px;
  background-position: 0 0, 0 5px, 5px -5px, -5px 0;
}
.sm-swatch--sm { width: 18px; height: 18px; border-radius: 3px; }
.sm-swatch--md { width: 30px; height: 30px; }
.sm-swatch--lg { width: 46px; height: 46px; border-radius: 6px; }

/* ================================================================== popover */

.sm-popover {
  position: fixed;
  z-index: 50;
  width: 260px;
  padding: 12px;
  border-radius: 8px;
  background: var(--sm-raised-2);
  border: 1px solid var(--sm-line);
  box-shadow: 0 12px 32px rgba(0, 0, 0, .55);
}
/* =================================================================== dialog */

.sm-scrim {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, .6);
}
.sm-dialog {
  width: min(440px, calc(100vw - 32px));
  padding: 20px;
  border-radius: 8px;
  background: var(--sm-raised);
  border: 1px solid var(--sm-line);
  box-shadow: 0 18px 48px rgba(0, 0, 0, .6);
}
.sm-dialog h2 { margin: 0 0 8px; font-size: 20px; font-weight: 900; color: var(--sm-bright); }
.sm-dialog p { margin: 0 0 18px; font-size: 15px; color: var(--sm-text); }
.sm-dialog__actions { display: flex; justify-content: flex-end; gap: 8px; }
.sm-btn--danger { background: var(--sm-danger); color: #fff; }
.sm-btn--danger:hover { background: #c4184a; }


` + CODE_CSS;

  // src/runtime/ui/disclosure.ts
  var DISCLOSURE_CLASS = {
    /** On the element that opens it. */
    trigger: "betterslack-disclosure",
    /** On the wrapper holding what it opened. */
    panel: "betterslack-disclosure__panel",
    /** Inside the wrapper. The pair is what makes an unfold animatable. */
    inner: "betterslack-disclosure__inner",
    /**
     * On the wrapper between being closed and being gone.
     *
     * Closing has to be a state rather than a removal, or there is nothing left
     * on screen to animate. Nothing here decides how long that lasts: the panel
     * is asked what its own stylesheet says, and with no animation on it the
     * answer is zero and it goes at once -- a client without Motion must not
     * wait for something that is not happening.
     */
    closing: "betterslack-disclosure__panel--closing"
  };
  var CLOSE_GRACE_MS = 80;
  function animatedFor(element) {
    const style = getComputedStyle(element);
    const times = `${style.animationDuration},${style.transitionDuration}`.split(",").map((part) => {
      const value = part.trim();
      if (value.endsWith("ms")) return Number.parseFloat(value);
      if (value.endsWith("s")) return Number.parseFloat(value) * 1e3;
      return 0;
    }).filter((value) => Number.isFinite(value));
    return times.length ? Math.max(...times) : 0;
  }
  function createDisclosure(options) {
    const open = /* @__PURE__ */ new Set();
    const panels = /* @__PURE__ */ new Map();
    const hit = (target) => {
      const from = target;
      const element = typeof from?.closest === "function" ? from.closest(options.trigger) : null;
      if (!element) return null;
      const key = options.keyFor(element);
      return key ? { element, key } : null;
    };
    const closing = /* @__PURE__ */ new Map();
    const takeAway = (panel) => {
      closing.get(panel)?.();
      closing.delete(panel);
      panel.remove();
    };
    const fold = (key, now = false) => {
      const panel = panels.get(key);
      panels.delete(key);
      if (!panel) return;
      if (now || !panel.isConnected) {
        takeAway(panel);
        return;
      }
      panel.classList.add(DISCLOSURE_CLASS.closing);
      const ms = animatedFor(panel);
      if (ms <= 0) {
        takeAway(panel);
        return;
      }
      const done = () => takeAway(panel);
      panel.addEventListener("animationend", done, { once: true });
      panel.addEventListener("transitionend", done, { once: true });
      const timer = setTimeout(done, ms + CLOSE_GRACE_MS);
      closing.set(panel, () => {
        clearTimeout(timer);
        panel.removeEventListener("animationend", done);
        panel.removeEventListener("transitionend", done);
      });
    };
    const unfold = (element, key) => {
      fold(key, true);
      const content = options.content(element, key);
      if (!content) return;
      const where = options.anchor?.(element, key) ?? element;
      if (!where.parentNode) return;
      const inner = document.createElement("div");
      inner.className = DISCLOSURE_CLASS.inner;
      inner.append(content);
      const panel = document.createElement("div");
      panel.className = DISCLOSURE_CLASS.panel;
      panel.append(inner);
      where.after(panel);
      panels.set(key, panel);
    };
    const toggle = (event) => {
      const found = hit(event.target);
      if (!found) return;
      event.preventDefault();
      event.stopPropagation();
      if (open.has(found.key)) {
        open.delete(found.key);
        fold(found.key);
      } else {
        open.add(found.key);
        unfold(found.element, found.key);
      }
      found.element.setAttribute("aria-expanded", String(open.has(found.key)));
      options.onToggle?.(open.has(found.key), found.key);
    };
    const onKey = (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (!hit(event.target)) return;
      toggle(event);
    };
    document.addEventListener("click", toggle, true);
    document.addEventListener("keydown", onKey, true);
    const refresh = () => {
      const mine = /* @__PURE__ */ new Set([...panels.values(), ...closing.keys()]);
      for (const stray of document.querySelectorAll(`.${DISCLOSURE_CLASS.panel}`)) {
        if (!mine.has(stray)) stray.remove();
      }
      const wanted = /* @__PURE__ */ new Set();
      for (const element of document.querySelectorAll(options.trigger)) {
        const key = options.keyFor(element);
        if (!key) continue;
        wanted.add(key);
        element.classList.add(DISCLOSURE_CLASS.trigger);
        element.setAttribute("role", "button");
        element.setAttribute("tabindex", "0");
        if (options.label) element.setAttribute("title", options.label);
        element.setAttribute("aria-expanded", String(open.has(key)));
        if (open.has(key) && !panels.get(key)?.isConnected) unfold(element, key);
      }
      for (const key of [...panels.keys()]) if (!wanted.has(key)) fold(key);
    };
    const dispose = () => {
      document.removeEventListener("click", toggle, true);
      document.removeEventListener("keydown", onKey, true);
      for (const key of [...panels.keys()]) fold(key, true);
      for (const panel of [...closing.keys()]) takeAway(panel);
      open.clear();
      for (const stray of document.querySelectorAll(`.${DISCLOSURE_CLASS.panel}`)) stray.remove();
      for (const element of document.querySelectorAll(`.${DISCLOSURE_CLASS.trigger}`)) {
        element.classList.remove(DISCLOSURE_CLASS.trigger);
        element.removeAttribute("aria-expanded");
        element.removeAttribute("role");
        element.removeAttribute("tabindex");
      }
    };
    return Object.assign(dispose, {
      refresh,
      rebuild: () => {
        for (const [key, panel] of panels) {
          const inner = panel.querySelector(`.${DISCLOSURE_CLASS.inner}`);
          const trigger = [...document.querySelectorAll(options.trigger)].find((element) => options.keyFor(element) === key);
          if (!inner || !trigger) continue;
          const content = options.content(trigger, key);
          inner.replaceChildren(...content ? [content] : []);
        }
      },
      isOpen: (key) => open.has(key),
      close: (key) => {
        open.delete(key);
        fold(key);
        refresh();
      },
      closeAll: () => {
        for (const key of [...open]) {
          open.delete(key);
          fold(key);
        }
        refresh();
      }
    });
  }
  var DISCLOSURE_CSS = `
.${DISCLOSURE_CLASS.trigger} { cursor: pointer; }
.${DISCLOSURE_CLASS.trigger}:hover { color: var(--dt_color-content-highlight, #1d9bd1); }
.${DISCLOSURE_CLASS.trigger}::after {
  content: '';
  display: inline-block;
  width: 0;
  height: 0;
  margin-left: 4px;
  vertical-align: .12em;
  border-left: 3.5px solid transparent;
  border-right: 3.5px solid transparent;
  border-top: 4px solid currentColor;
}
.${DISCLOSURE_CLASS.trigger}[aria-expanded="true"]::after { transform: rotate(180deg); }
.${DISCLOSURE_CLASS.panel} { display: grid; grid-template-rows: 1fr; }
.${DISCLOSURE_CLASS.inner} { overflow: hidden; min-height: 0; }
`;

  // src/runtime/helpers.ts
  var CACHE_KEYS = 40;
  var BUTTON_CLASSES = {
    composer: "c-button-unstyled c-icon_button c-icon_button--size_smedium p-composer__button c-icon_button--default",
    header: "c-button-unstyled c-icon_button c-icon_button--size_medium c-icon_button--default",
    strip: "c-button-unstyled p-control_strip__circle_button",
    message: "c-button-unstyled c-icon_button c-icon_button--size_smedium c-message_actions__button"
  };
  var isMac = () => {
    if (typeof navigator === "undefined") return false;
    const hint = `${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`;
    return /Mac|iPhone|iPad/.test(hint);
  };
  function parseCombo(combo) {
    const parts = combo.toLowerCase().split("+").map((p) => p.trim());
    const key = parts[parts.length - 1] ?? "";
    const want = {
      mod: parts.includes("mod"),
      ctrl: parts.includes("ctrl"),
      shift: parts.includes("shift"),
      alt: parts.includes("alt") || parts.includes("option"),
      meta: parts.includes("cmd") || parts.includes("meta")
    };
    const code = key.length === 1 ? `Key${key.toUpperCase()}` : null;
    return (event) => {
      if (want.mod && !event.metaKey && !event.ctrlKey) return false;
      if (!want.mod && want.meta !== event.metaKey) return false;
      if (!want.mod && want.ctrl !== event.ctrlKey) return false;
      if (want.shift !== event.shiftKey) return false;
      if (want.alt !== event.altKey) return false;
      return code ? event.code === code : event.key.toLowerCase() === key;
    };
  }
  function describeCombo(combo) {
    const mac = isMac();
    return combo.toLowerCase().split("+").map((part) => {
      const p = part.trim();
      if (p === "mod") return mac ? "\u2318" : "Ctrl";
      if (p === "shift") return mac ? "\u21E7" : "Shift";
      if (p === "alt" || p === "option") return mac ? "\u2325" : "Alt";
      if (p === "cmd" || p === "meta") return mac ? "\u2318" : "Win";
      if (p === "ctrl") return mac ? "\u2303" : "Ctrl";
      return p.toUpperCase();
    }).join(mac ? "" : "+");
  }
  function createHelpers(ctx) {
    const scopedCss = /* @__PURE__ */ new Map();
    const applyCss = () => ctx.css([...scopedCss.values()].join("\n"));
    return {
      disclosure(options) {
        scopedCss.set("disclosure", DISCLOSURE_CSS);
        applyCss();
        return ctx.track(createDisclosure(options));
      },
      toggle({ key, className, defaultOn = false, whenOn, onChange }) {
        const flag = className ?? `betterslack-${ctx.pluginId}-${key}`;
        if (whenOn) {
          scopedCss.set(`toggle:${key}`, whenOn.replace(/&/g, `html.${flag}`));
          applyCss();
        }
        const apply = (on) => {
          document.documentElement.classList.toggle(flag, on);
          onChange?.(on);
        };
        apply(ctx.settings.get(key, defaultOn) === true);
        ctx.track(() => document.documentElement.classList.remove(flag));
        return {
          get on() {
            return document.documentElement.classList.contains(flag);
          },
          async set(on) {
            apply(on);
            await ctx.settings.set(key, on);
          },
          async toggle() {
            const next = !document.documentElement.classList.contains(flag);
            apply(next);
            await ctx.settings.set(key, next);
            return next;
          }
        };
      },
      hotkey: (combo, handler, options) => {
        const matches = parseCombo(combo);
        return ctx.track(
          onShortcut((event) => matches(event) && (options?.when?.() ?? true), handler)
        );
      },
      describeHotkey: describeCombo,
      cache(name, options = {}) {
        const store2 = `cache:${name}`;
        const limit = Math.max(1, options.keys ?? CACHE_KEYS);
        let entries = ctx.settings.get(store2, {}) ?? {};
        let writing = null;
        const persist = () => {
          if (writing) return;
          writing = Promise.resolve().then(async () => {
            writing = null;
            const keys = Object.keys(entries);
            if (keys.length > limit) {
              const oldest = keys.sort((a, b) => (entries[a]?.at ?? 0) - (entries[b]?.at ?? 0));
              for (const key of oldest.slice(0, keys.length - limit)) delete entries[key];
            }
            await ctx.settings.set(store2, entries).catch(() => void 0);
          });
        };
        const write2 = (key, value) => {
          entries = { ...entries, [key]: { at: Date.now(), value } };
          persist();
        };
        return {
          get: (key) => entries[key]?.value,
          set: write2,
          swr(key, load, onFresh) {
            const held = entries[key]?.value;
            void Promise.resolve().then(load).then((fresh) => {
              if (fresh === void 0) return;
              if (JSON.stringify(fresh) === JSON.stringify(held)) {
                write2(key, fresh);
                return;
              }
              write2(key, fresh);
              onFresh(fresh);
            }).catch(() => void 0);
            return held;
          }
        };
      },
      poll(handler, everyMs) {
        let timer;
        let running = false;
        const tick = () => {
          if (running || document.visibilityState === "hidden") return;
          running = true;
          void Promise.resolve(handler()).finally(() => {
            running = false;
          });
        };
        const start = () => {
          if (timer !== void 0) return;
          tick();
          timer = setInterval(tick, everyMs);
        };
        const stop = () => {
          if (timer === void 0) return;
          clearInterval(timer);
          timer = void 0;
        };
        const onVisibility = () => document.visibilityState === "hidden" ? stop() : start();
        document.addEventListener("visibilitychange", onVisibility);
        if (document.visibilityState !== "hidden") start();
        ctx.track(() => {
          document.removeEventListener("visibilitychange", onVisibility);
          stop();
        });
        return () => {
          document.removeEventListener("visibilitychange", onVisibility);
          stop();
        };
      },
      badge(selector, id, value) {
        const nodeId = `betterslack-badge-${ctx.pluginId}-${id}`;
        scopedCss.set(`badge:${id}`, `
        #${nodeId} {
          position: absolute; top: -2px; right: -2px; min-width: 16px; height: 16px;
          padding: 0 4px; border-radius: 999px; display: grid; place-items: center;
          font: 700 10px/1 Lato, sans-serif; color: #fff;
          background: var(--dt_color-content-imp, #c01343);
        }
        #${nodeId}[hidden] { display: none; }
      `);
        applyCss();
        const refresh = () => {
          const node = document.getElementById(nodeId);
          if (!node) return;
          const next = value();
          node.textContent = next === null ? "" : String(next);
          node.toggleAttribute("hidden", next === null || next === 0 || next === "");
        };
        const cleanup = keepMounted(selector, nodeId, () => {
          const node = h("span", { "aria-hidden": "true" });
          queueMicrotask(refresh);
          return node;
        });
        const timer = setInterval(refresh, 1e3);
        return ctx.track(() => {
          clearInterval(timer);
          cleanup();
        });
      },
      each: (selector, handler) => ctx.track(onEach(selector, handler)),
      mount: (container, id, factory, options) => ctx.track(keepMounted(container, id, factory, options ?? {})),
      tooltip: (element, title, subtitle) => ctx.track(attachTooltip(element, { title, subtitle })),
      async copy(text, message = "Copied") {
        try {
          await navigator.clipboard.writeText(text);
          ctx.toast(message, { variant: "success" });
          return true;
        } catch {
          ctx.toast("Could not copy", { variant: "error" });
          return false;
        }
      },
      iconButton({ icon, label, description, surface = "header", onClick }) {
        const button = h("button", {
          class: `${BUTTON_CLASSES[surface]} betterslack-icon-button`,
          type: "button",
          "aria-label": label
        });
        button.innerHTML = icon;
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          onClick(event);
        });
        ctx.track(attachTooltip(button, {
          title: label,
          subtitle: description,
          placement: surface === "strip" ? "right" : "top"
        }));
        return button;
      },
      field(label, value) {
        return h("div", { class: "p-rimeto_member_profile_field__contact_info" }, [
          h("div", { class: "p-rimeto_member_profile_field" }, [
            h("div", { class: "p-rimeto_member_profile_field__primary" }, [
              h("div", { class: "p-rimeto_member_profile_field__label" }, [label]),
              h("div", { class: "p-rimeto_member_profile_field__value" }, [value])
            ])
          ])
        ]);
      },
      section(title, children) {
        return h("div", { class: "p-r_member_profile_section" }, [
          h("div", { style: "display: flex;" }, [
            h("div", { class: "p-r_member_profile_section_header", style: "flex: 1 1 0%;" }, [title])
          ]),
          h("div", { class: "p-r_member_profile_section_content" }, children)
        ]);
      },
      debounce(fn, ms) {
        let timer;
        return (...args) => {
          clearTimeout(timer);
          timer = setTimeout(() => fn(...args), ms);
        };
      }
    };
  }

  // src/runtime/ui/markdown.ts
  var ESCAPES2 = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  };
  function escapeHtml2(text) {
    return text.replace(/[&<>"']/g, (c) => ESCAPES2[c]);
  }
  function safeUrl(url) {
    const trimmed = url.trim();
    if (/^(https?:|mailto:|slack:|data:image\/)/i.test(trimmed)) return trimmed;
    if (/^[\w./-]+$/.test(trimmed)) return trimmed;
    return null;
  }
  function inline(text, resolve) {
    return text.replace(/`([^`]+)`/g, (_, code) => `<code class="sm-md__code">${code}</code>`).replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, alt, href) => {
      const src = resolve(href);
      return src ? `<img class="sm-md__img" src="${src}" alt="${alt}">` : whole;
    }).replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, label, href) => {
      const url = resolve(href);
      return url ? `<a class="sm-md__link" href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>` : whole;
    }).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>").replace(/(^|[\s(])_([^_\n]+)_/g, "$1<em>$2</em>");
  }
  function renderMarkdown(source2, options = {}) {
    const resolve = options.resolve ?? ((href) => safeUrl(href));
    const lines = escapeHtml2(source2.replace(/\r\n?/g, "\n")).split("\n");
    const out = [];
    let list = null;
    let paragraph = [];
    let fence = null;
    const closeParagraph = () => {
      if (!paragraph.length) return;
      out.push(`<p>${inline(paragraph.join(" "), resolve)}</p>`);
      paragraph = [];
    };
    const closeList = () => {
      if (!list) return;
      out.push(`</${list}>`);
      list = null;
    };
    for (const line of lines) {
      if (fence !== null) {
        if (/^\s*```/.test(line)) {
          out.push(`<pre class="sm-md__pre"><code>${fence.join("\n")}</code></pre>`);
          fence = null;
        } else {
          fence.push(line);
        }
        continue;
      }
      if (/^\s*```/.test(line)) {
        closeParagraph();
        closeList();
        fence = [];
        continue;
      }
      const heading = line.match(/^(#{1,4})\s+(.*)$/);
      if (heading) {
        closeParagraph();
        closeList();
        const level = heading[1].length;
        out.push(`<h${level} class="sm-md__h${level}">${inline(heading[2], resolve)}</h${level}>`);
        continue;
      }
      const bullet = line.match(/^\s*[-*]\s+(.*)$/);
      const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (bullet || numbered) {
        closeParagraph();
        const wanted = bullet ? "ul" : "ol";
        if (list !== wanted) {
          closeList();
          list = wanted;
          out.push(`<${wanted} class="sm-md__list">`);
        }
        out.push(`<li>${inline((bullet ?? numbered)[1], resolve)}</li>`);
        continue;
      }
      if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
        closeParagraph();
        closeList();
        out.push('<hr class="sm-md__rule">');
        continue;
      }
      if (/^\s*&gt;\s?/.test(line)) {
        closeParagraph();
        closeList();
        out.push(`<blockquote class="sm-md__quote">${inline(line.replace(/^\s*&gt;\s?/, ""), resolve)}</blockquote>`);
        continue;
      }
      if (line.trim() === "") {
        closeParagraph();
        closeList();
        continue;
      }
      paragraph.push(line.trim());
    }
    if (fence !== null) out.push(`<pre class="sm-md__pre"><code>${fence.join("\n")}</code></pre>`);
    closeParagraph();
    closeList();
    return out.join("\n");
  }

  // mods/plugins/code-highlight/tokenise.js
  function escapeHtml3(text) {
    return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  var words = (list) => list.join("|");
  function spec({ line, block, strings = `"'`, keywords = [], builtins = [], extra = [], early = [] }) {
    const parts = [];
    parts.push(...early);
    if (block) parts.push(`(?<comment1>${block[0]}[\\s\\S]*?(?:${block[1]}|$))`);
    if (line) parts.push(`(?<comment2>${line}[^\\n]*)`);
    for (const q of strings) {
      const e = q === "`" ? "`" : q;
      parts.push(`(?<string${strings.indexOf(q)}>${e}(?:\\\\.|[^\\\\${e === "`" ? "`" : e}])*${e}?)`);
    }
    parts.push(...extra);
    parts.push("(?<number>\\b(?:0[xXbBoO][\\da-fA-F_]+|\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\b)");
    if (keywords.length) parts.push(`(?<keyword>\\b(?:${words(keywords)})\\b)`);
    if (builtins.length) parts.push(`(?<builtin>\\b(?:${words(builtins)})\\b)`);
    parts.push("(?<fn>\\b[A-Za-z_$][\\w$]*(?=\\s*\\())");
    parts.push("(?<punct>[{}()\\[\\];,.:=+\\-*/%<>!&|^~?]+)");
    return new RegExp(parts.join("|"), "g");
  }
  var JS_KEYWORDS = [
    "const",
    "let",
    "var",
    "function",
    "return",
    "if",
    "else",
    "for",
    "while",
    "do",
    "break",
    "continue",
    "class",
    "extends",
    "new",
    "this",
    "super",
    "import",
    "export",
    "from",
    "as",
    "default",
    "async",
    "await",
    "yield",
    "try",
    "catch",
    "finally",
    "throw",
    "typeof",
    "instanceof",
    "in",
    "of",
    "delete",
    "void",
    "switch",
    "case"
  ];
  var JS_BUILTINS = [
    "true",
    "false",
    "null",
    "undefined",
    "NaN",
    "Infinity",
    "console",
    "window",
    "document",
    "Object",
    "Array",
    "String",
    "Number",
    "Boolean",
    "Promise",
    "Math",
    "JSON",
    "Map",
    "Set"
  ];
  var LANGUAGES = {
    javascript: spec({ line: "//", block: ["/\\*", "\\*/"], strings: `"'\``, keywords: JS_KEYWORDS, builtins: JS_BUILTINS }),
    typescript: spec({
      line: "//",
      block: ["/\\*", "\\*/"],
      strings: `"'\``,
      keywords: [
        ...JS_KEYWORDS,
        "interface",
        "type",
        "enum",
        "implements",
        "readonly",
        "public",
        "private",
        "protected",
        "abstract",
        "declare",
        "namespace",
        "satisfies",
        "keyof"
      ],
      builtins: [...JS_BUILTINS, "string", "number", "boolean", "any", "unknown", "never", "void"]
    }),
    python: spec({
      line: "#",
      strings: `"'`,
      keywords: [
        "def",
        "class",
        "return",
        "if",
        "elif",
        "else",
        "for",
        "while",
        "break",
        "continue",
        "import",
        "from",
        "as",
        "try",
        "except",
        "finally",
        "raise",
        "with",
        "lambda",
        "yield",
        "global",
        "nonlocal",
        "pass",
        "assert",
        "del",
        "async",
        "await",
        "not",
        "and",
        "or",
        "is",
        "in"
      ],
      builtins: [
        "True",
        "False",
        "None",
        "self",
        "cls",
        "print",
        "len",
        "range",
        "dict",
        "list",
        "set",
        "tuple",
        "str",
        "int",
        "float",
        "bool",
        "open",
        "super"
      ]
    }),
    json: spec({
      strings: '"',
      early: ['(?<property>"(?:\\\\.|[^"\\\\])*"(?=\\s*:))'],
      builtins: ["true", "false", "null"]
    }),
    bash: spec({
      line: "#",
      strings: `"'`,
      keywords: [
        "if",
        "then",
        "else",
        "elif",
        "fi",
        "for",
        "while",
        "do",
        "done",
        "case",
        "esac",
        "function",
        "return",
        "export",
        "local",
        "source"
      ],
      builtins: [
        "echo",
        "cd",
        "ls",
        "cat",
        "grep",
        "sed",
        "awk",
        "curl",
        "git",
        "npm",
        "pnpm",
        "yarn",
        "docker",
        "kubectl",
        "sudo",
        "mkdir",
        "rm",
        "cp",
        "mv",
        "chmod",
        "ssh"
      ],
      extra: ["(?<variable>\\$\\{?[A-Za-z_][\\w]*\\}?|\\$\\d)"]
    }),
    sql: spec({
      line: "--",
      block: ["/\\*", "\\*/"],
      strings: `'"`,
      keywords: [
        "SELECT",
        "FROM",
        "WHERE",
        "INSERT",
        "INTO",
        "VALUES",
        "UPDATE",
        "SET",
        "DELETE",
        "CREATE",
        "TABLE",
        "ALTER",
        "DROP",
        "INDEX",
        "JOIN",
        "LEFT",
        "RIGHT",
        "INNER",
        "OUTER",
        "ON",
        "GROUP",
        "ORDER",
        "BY",
        "HAVING",
        "LIMIT",
        "OFFSET",
        "AS",
        "AND",
        "OR",
        "NOT",
        "IN",
        "IS",
        "NULL",
        "DISTINCT",
        "UNION",
        "WITH",
        "RETURNING",
        "select",
        "from",
        "where",
        "insert",
        "into",
        "update",
        "delete",
        "join",
        "group",
        "order",
        "by",
        "limit",
        "and",
        "or",
        "not",
        "null"
      ],
      builtins: ["COUNT", "SUM", "AVG", "MIN", "MAX", "COALESCE", "NOW", "count", "sum", "avg"]
    }),
    go: spec({
      line: "//",
      block: ["/\\*", "\\*/"],
      strings: `"\``,
      keywords: [
        "func",
        "package",
        "import",
        "return",
        "if",
        "else",
        "for",
        "range",
        "switch",
        "case",
        "default",
        "break",
        "continue",
        "go",
        "defer",
        "chan",
        "select",
        "type",
        "struct",
        "interface",
        "map",
        "var",
        "const"
      ],
      builtins: [
        "nil",
        "true",
        "false",
        "error",
        "string",
        "int",
        "int64",
        "float64",
        "bool",
        "byte",
        "make",
        "new",
        "len",
        "cap",
        "append",
        "panic",
        "recover",
        "fmt"
      ]
    }),
    rust: spec({
      line: "//",
      block: ["/\\*", "\\*/"],
      strings: '"',
      keywords: [
        "fn",
        "let",
        "mut",
        "const",
        "static",
        "struct",
        "enum",
        "impl",
        "trait",
        "pub",
        "use",
        "mod",
        "match",
        "if",
        "else",
        "loop",
        "while",
        "for",
        "in",
        "return",
        "break",
        "continue",
        "move",
        "ref",
        "where",
        "async",
        "await",
        "dyn",
        "unsafe",
        "crate",
        "self"
      ],
      builtins: [
        "Some",
        "None",
        "Ok",
        "Err",
        "Option",
        "Result",
        "Vec",
        "String",
        "str",
        "bool",
        "u8",
        "u32",
        "u64",
        "i32",
        "i64",
        "f64",
        "usize",
        "println",
        "true",
        "false"
      ]
    }),
    java: spec({
      line: "//",
      block: ["/\\*", "\\*/"],
      strings: `"'`,
      keywords: [
        "public",
        "private",
        "protected",
        "class",
        "interface",
        "extends",
        "implements",
        "static",
        "final",
        "void",
        "new",
        "return",
        "if",
        "else",
        "for",
        "while",
        "do",
        "switch",
        "case",
        "break",
        "continue",
        "try",
        "catch",
        "finally",
        "throw",
        "throws",
        "import",
        "package",
        "abstract",
        "synchronized",
        "this",
        "super",
        "instanceof"
      ],
      builtins: [
        "String",
        "int",
        "long",
        "double",
        "float",
        "boolean",
        "char",
        "byte",
        "true",
        "false",
        "null",
        "System",
        "List",
        "Map",
        "Integer",
        "Object"
      ]
    }),
    php: spec({
      line: "//",
      block: ["/\\*", "\\*/"],
      strings: `"'`,
      keywords: [
        "function",
        "class",
        "public",
        "private",
        "protected",
        "static",
        "return",
        "if",
        "else",
        "elseif",
        "foreach",
        "for",
        "while",
        "switch",
        "case",
        "break",
        "continue",
        "new",
        "use",
        "namespace",
        "extends",
        "implements",
        "try",
        "catch",
        "finally",
        "throw",
        "echo"
      ],
      builtins: ["true", "false", "null", "array", "string", "int", "bool", "this", "self"],
      extra: ["(?<variable>\\$[A-Za-z_]\\w*)"]
    }),
    css: spec({
      block: ["/\\*", "\\*/"],
      strings: `"'`,
      extra: ["(?<selector>^[^\\n{}]+(?=\\s*\\{))", "(?<property>[-\\w]+(?=\\s*:))", "(?<variable>--[\\w-]+)"],
      builtins: ["important", "inherit", "initial", "none", "auto", "var", "calc", "rgb", "rgba"]
    }),
    html: spec({
      block: ["<!--", "-->"],
      strings: `"'`,
      extra: ["(?<tag><\\/?[A-Za-z][\\w:-]*)", "(?<attr>\\s[A-Za-z-]+(?=\\s*=))"]
    }),
    yaml: spec({
      line: "#",
      strings: `"'`,
      extra: ["(?<property>^\\s*[-\\w.]+(?=\\s*:))", "(?<punct2>^\\s*-\\s)"],
      builtins: ["true", "false", "null", "yes", "no"]
    }),
    graphql: spec({
      line: "#",
      strings: '"',
      keywords: [
        "query",
        "mutation",
        "subscription",
        "fragment",
        "on",
        "type",
        "input",
        "enum",
        "interface",
        "union",
        "scalar",
        "schema",
        "extend",
        "implements",
        "directive"
      ],
      builtins: ["ID", "String", "Int", "Float", "Boolean", "true", "false", "null"],
      early: ["(?<property>\\b[A-Za-z_]\\w*(?=\\s*:))", "(?<variable>\\$\\w+)", "(?<meta>@\\w+)"]
    }),
    kotlin: spec({
      line: "//",
      block: ["/\\*", "\\*/"],
      strings: `"'`,
      keywords: [
        "fun",
        "val",
        "var",
        "class",
        "object",
        "interface",
        "data",
        "sealed",
        "when",
        "if",
        "else",
        "for",
        "while",
        "return",
        "import",
        "package",
        "override",
        "suspend",
        "companion",
        "private",
        "public",
        "internal",
        "lateinit",
        "init"
      ],
      builtins: ["String", "Int", "Long", "Double", "Boolean", "List", "Map", "true", "false", "null", "it", "this"]
    }),
    swift: spec({
      line: "//",
      block: ["/\\*", "\\*/"],
      strings: '"',
      keywords: [
        "func",
        "let",
        "var",
        "class",
        "struct",
        "enum",
        "protocol",
        "extension",
        "guard",
        "if",
        "else",
        "for",
        "while",
        "return",
        "import",
        "switch",
        "case",
        "defer",
        "init",
        "self",
        "private",
        "public",
        "internal",
        "static",
        "override",
        "async",
        "await",
        "throws",
        "try"
      ],
      builtins: ["String", "Int", "Double", "Bool", "Array", "Dictionary", "true", "false", "nil", "print"]
    }),
    ruby: spec({
      line: "#",
      strings: `"'`,
      keywords: [
        "def",
        "end",
        "class",
        "module",
        "if",
        "elsif",
        "else",
        "unless",
        "while",
        "until",
        "do",
        "return",
        "require",
        "require_relative",
        "yield",
        "begin",
        "rescue",
        "ensure",
        "then",
        "case",
        "when",
        "attr_accessor",
        "attr_reader"
      ],
      builtins: ["nil", "true", "false", "self", "puts", "new", "nil?", "each", "map"],
      extra: ["(?<variable>[@$]\\w+)", "(?<meta>:\\w+)"]
    }),
    c: spec({
      line: "//",
      block: ["/\\*", "\\*/"],
      strings: `"'`,
      keywords: [
        "int",
        "char",
        "float",
        "double",
        "void",
        "long",
        "short",
        "unsigned",
        "signed",
        "struct",
        "union",
        "enum",
        "typedef",
        "static",
        "const",
        "extern",
        "return",
        "if",
        "else",
        "for",
        "while",
        "do",
        "switch",
        "case",
        "break",
        "continue",
        "goto",
        "sizeof",
        "class",
        "namespace",
        "template",
        "public",
        "private",
        "protected",
        "virtual",
        "new",
        "delete"
      ],
      builtins: ["NULL", "true", "false", "printf", "malloc", "free", "std", "cout", "string", "vector"],
      extra: ["(?<meta>^\\s*#\\s*\\w+)"]
    }),
    dockerfile: spec({
      line: "#",
      strings: `"'`,
      keywords: [
        "FROM",
        "RUN",
        "CMD",
        "LABEL",
        "EXPOSE",
        "ENV",
        "ADD",
        "COPY",
        "ENTRYPOINT",
        "VOLUME",
        "USER",
        "WORKDIR",
        "ARG",
        "ONBUILD",
        "HEALTHCHECK",
        "SHELL",
        "AS"
      ],
      extra: ["(?<variable>\\$\\{?\\w+\\}?)"]
    }),
    toml: spec({
      line: "#",
      strings: `"'`,
      extra: ["(?<selector>^\\s*\\[+[^\\]\\n]+\\]+)", "(?<property>^\\s*[\\w.-]+(?=\\s*=))"],
      builtins: ["true", "false"]
    }),
    diff: spec({
      extra: ["(?<added>^\\+[^\\n]*)", "(?<removed>^-[^\\n]*)", "(?<meta>^@@[^\\n]*|^diff [^\\n]*)"]
    })
  };
  var ALIAS = {
    comment1: "comment",
    comment2: "comment",
    string0: "string",
    string1: "string",
    string2: "string",
    punct2: "punct",
    property: "property",
    selector: "selector"
  };
  function highlight(code, language) {
    const pattern = LANGUAGES[language];
    if (!pattern) return escapeHtml3(code);
    let out = "";
    let last = 0;
    pattern.lastIndex = 0;
    const rx = new RegExp(pattern.source, "gm");
    for (let m = rx.exec(code); m !== null; m = rx.exec(code)) {
      if (m[0] === "") {
        rx.lastIndex += 1;
        continue;
      }
      const name = Object.keys(m.groups).find((k) => m.groups[k] !== void 0);
      if (!name) continue;
      out += escapeHtml3(code.slice(last, m.index));
      out += `<span class="bshl-${ALIAS[name] ?? name}">${escapeHtml3(m[0])}</span>`;
      last = m.index + m[0].length;
    }
    return out + escapeHtml3(code.slice(last));
  }

  // mods/plugins/code-highlight/detect.js
  var SIGNS = [
    ["diff", [
      [/^@@ -\d+.* \+\d+.* @@/m, 6],
      [/^diff --git /m, 6],
      [/^[+-][^+-]/m, 2]
    ]],
    ["graphql", [
      [/\b(query|mutation|subscription)\s+\w*\s*[({]/, 6],
      [/^\s*(type|input|enum|interface|scalar|union)\s+\w+\s*[{@]/m, 6],
      [/\bfragment \w+ on \w+/, 6],
      [/^\s*\w+(\(.*\))?\s*:\s*\[?[A-Z]\w*!?\]?!?\s*$/m, 3],
      [/[;=]\s*$/m, -3]
    ]],
    ["dockerfile", [
      [/^\s*FROM\s+\S+/m, 7],
      [/^\s*(RUN|CMD|COPY|ADD|ENTRYPOINT|WORKDIR|EXPOSE|ENV)\s+/m, 3]
    ]],
    ["toml", [
      [/^\s*\[[\w.-]+\]\s*$/m, 5],
      [/^\s*[\w.-]+\s*=\s*["\d[]/m, 3]
    ]],
    ["ruby", [
      [/^\s*def \w+[!?]?/m, 4],
      [/^\s*end\s*$/m, 4],
      [/\b(require|require_relative|attr_accessor|puts)\b/, 3],
      [/\b(nil|elsif|unless)\b/, 3],
      [/[;{]\s*$/m, -2]
    ]],
    ["kotlin", [
      [/\bfun \w+\s*\(/, 5],
      [/\b(val|var) \w+\s*[:=]/, 3],
      [/\b(data class|sealed class|companion object|suspend fun)\b/, 5]
    ]],
    ["swift", [
      [/\bfunc \w+\s*\(/, 4],
      [/\b(guard|let|var) .*\bin\b|\bguard let\b/, 3],
      [/@(objc|IBOutlet|State|Published)\b/, 5],
      [/\bprint\(".*"\)/, 2],
      [/\bnil\b/, 2]
    ]],
    ["c", [
      [/^\s*#\s*(include|define|ifndef|pragma)\b/m, 7],
      [/\b(int|void|char|float|double)\s+\w+\s*\([^)]*\)\s*\{/, 4],
      [/\bstd::|\bcout\s*<</, 5],
      [/\bprintf\s*\(/, 3]
    ]],
    ["json", [
      [/^\s*[{[]/, 2],
      [/"[^"]*"\s*:/, 3],
      // Two quoted keys rather than one. People paste fragments -- a slice of a
      // payload that starts mid-object -- and a fragment has no opening brace to
      // score on; measured against a real message that was being missed.
      [/"[^"]*"\s*:[\s\S]*?"[^"]*"\s*:/, 3],
      [/[}\]]\s*$/, 1],
      [/\b(function|def|const|SELECT)\b/i, -6]
    ]],
    ["html", [
      [/<\/[a-z][\w-]*>/i, 4],
      [/^\s*<(!doctype|html|div|span|p|body|head|script)\b/im, 4],
      [/<[a-z][\w-]*\s+[a-z-]+=/i, 2]
    ]],
    ["css", [
      [/^[^\n{}]+\{[^}]*:[^}]*;/m, 4],
      [/(^|\n)\s*(--[\w-]+|[a-z-]+)\s*:\s*[^;]+;/, 2],
      [/@(media|import|keyframes|supports)\b/, 3],
      [/\b(function|def|return)\b/, -4]
    ]],
    ["sql", [
      [/\bselect\b[\s\S]*\bfrom\b/i, 6],
      [/\b(insert into|update .* set|delete from|create table|alter table)\b/i, 6],
      [/\b(inner|left|right) join\b/i, 3]
    ]],
    ["bash", [
      [/^#!\/(bin|usr)/, 8],
      [/^\s*\$ /m, 4],
      [/\b(sudo|apt-get|brew install|chmod|mkdir -p|rm -rf)\b/, 4],
      [/\b(npm|pnpm|yarn|git|docker|kubectl) [a-z]/, 3],
      [/\$\{?\w+\}?/, 1],
      [/[;{}]\s*$/m, -1]
    ]],
    ["python", [
      [/^\s*def \w+\s*\(.*\)\s*:/m, 6],
      [/^\s*(from|import) [\w.]+/m, 3],
      [/^\s*class \w+.*:/m, 4],
      [/\b(elif|None|True|False|self)\b/, 3],
      [/\bprint\(/, 2],
      [/[;{]\s*$/m, -3]
    ]],
    ["go", [
      [/^\s*package \w+/m, 6],
      [/\bfunc \w*\s*\(/, 5],
      [/:=/, 3],
      [/\b(nil|struct|interface\{\})\b/, 2]
    ]],
    ["rust", [
      [/\bfn \w+\s*\(/, 5],
      [/\blet (mut )?\w+/, 3],
      [/\b(Some|None|Ok|Err)\(/, 4],
      [/->\s*\w+|::\w+/, 2],
      [/println!/, 4]
    ]],
    ["php", [
      [/<\?php/, 8],
      [/\$this->/, 5],
      [/\$\w+\s*=/, 3],
      [/\b(echo|namespace|use [\w\\]+;)\b/, 2]
    ]],
    ["java", [
      [/\b(public|private|protected)\s+(static\s+)?(final\s+)?[\w<>[\]]+\s+\w+\s*\(/, 5],
      [/\bSystem\.out\.print/, 6],
      [/^\s*(package|import)\s+[\w.]+;/m, 4],
      [/\bnew [A-Z]\w*\(/, 2]
    ]],
    ["typescript", [
      [/\binterface \w+\s*\{/, 5],
      [/:\s*(string|number|boolean|void|any|unknown)\b/, 4],
      [/\btype \w+\s*=/, 4],
      [/\b(readonly|implements|enum)\b/, 2],
      [/\bimport .* from ['"]/, 1]
    ]],
    ["javascript", [
      [/\b(const|let)\s+\w+\s*=/, 3],
      [/=>/, 2],
      [/\bfunction\s*\w*\s*\(/, 3],
      [/\b(console\.log|require\(|module\.exports)/, 4],
      [/\bimport .* from ['"]/, 2],
      [/:\s*(string|number|boolean)\b/, -2]
    ]],
    ["yaml", [
      [/^\s*[-\w.]+:\s*($|[^\s{[])/m, 3],
      // Two key lines rather than one: a single `word:` is a sentence in half the
      // messages ever written, and was scoring the same as a config file.
      [/^\s*[-\w.]+:\s*($|[^\s{[])[\s\S]*?^\s*[-\w.]+:\s*($|[^\s{[])/m, 3],
      [/^\s*- \w/m, 2],
      [/^---\s*$/m, 4],
      [/[{};]/, -2]
    ]]
  ];
  var FLOOR = 4;
  function detect(code) {
    const text = code.slice(0, 4e3);
    if (text.trim().length < 12) return null;
    let best = null;
    let bestScore = 0;
    for (const [language, signs] of SIGNS) {
      let score = 0;
      for (const [pattern, weight] of signs) if (pattern.test(text)) score += weight;
      if (score > bestScore) {
        bestScore = score;
        best = language;
      }
    }
    return bestScore >= FLOOR ? best : null;
  }

  // mods/plugins/theme-builder/colour.js
  function parseColour(input) {
    const text = String(input ?? "").trim();
    const hex = text.match(/^#([0-9a-f]{3,8})$/i);
    if (hex) {
      let digits = hex[1];
      if (digits.length === 3 || digits.length === 4) digits = [...digits].map((d) => d + d).join("");
      if (digits.length !== 6 && digits.length !== 8) return null;
      const n = parseInt(digits.slice(0, 6), 16);
      const a = digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1;
      return { r: n >> 16 & 255, g: n >> 8 & 255, b: n & 255, a };
    }
    const fn = text.match(/^rgba?\(([^)]+)\)$/i);
    if (fn) {
      const parts = fn[1].split(/[,/]/).map((p) => parseFloat(p));
      if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null;
      const a = parts.length > 3 && !Number.isNaN(parts[3]) ? parts[3] : 1;
      const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
      return { r: clamp(parts[0]), g: clamp(parts[1]), b: clamp(parts[2]), a: Math.max(0, Math.min(1, a)) };
    }
    return null;
  }
  function formatCss({ r, g, b, a }) {
    if (a >= 1) return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
    return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`;
  }
  function flatten(colour, backdrop) {
    if (colour.a >= 1) return { ...colour, a: 1 };
    const a = colour.a;
    return {
      r: Math.round(colour.r * a + backdrop.r * (1 - a)),
      g: Math.round(colour.g * a + backdrop.g * (1 - a)),
      b: Math.round(colour.b * a + backdrop.b * (1 - a)),
      a: 1
    };
  }
  function channel(value) {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }
  function luminance({ r, g, b }) {
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  }
  function contrast(foreground, background) {
    const fg = flatten(foreground, background);
    const [light, dark] = [luminance(fg), luminance(background)].sort((a, b) => b - a);
    return (light + 0.05) / (dark + 0.05);
  }
  function readability(ratio) {
    if (ratio >= 7) return { grade: "AAA", ok: true };
    if (ratio >= 4.5) return { grade: "AA", ok: true };
    if (ratio >= 3) return { grade: "AA Large", ok: false };
    return { grade: "Fail", ok: false };
  }
  function shade(colour, amount) {
    const target = amount >= 0 ? 255 : 0;
    const k = Math.abs(amount);
    return {
      r: Math.round(colour.r + (target - colour.r) * k),
      g: Math.round(colour.g + (target - colour.g) * k),
      b: Math.round(colour.b + (target - colour.b) * k),
      a: colour.a
    };
  }
  function derivePalette(background, accent) {
    const dark = luminance(background) < 0.4;
    const step = (amount) => shade(background, dark ? amount : -amount);
    return {
      bg: background,
      raised: step(0.05),
      chrome: dark ? shade(background, -0.35) : shade(background, -0.06),
      surface: step(0.1),
      selected: step(0.13),
      hover: step(0.03),
      text: dark ? shade(background, 0.92) : shade(background, -0.85),
      bright: dark ? shade(background, 0.98) : shade(background, -0.95),
      muted: dark ? shade(background, 0.5) : shade(background, -0.45),
      accent,
      accentText: dark ? shade(accent, 0.45) : shade(accent, -0.25),
      danger: dark ? { r: 221, g: 61, b: 72, a: 1 } : { r: 192, g: 19, b: 67, a: 1 }
    };
  }

  // mods/plugins/theme-builder/roles.js
  var ROLES = [
    { key: "bg", seed: true },
    { key: "accent", seed: true },
    { key: "chrome" },
    { key: "raised" },
    { key: "surface" },
    { key: "selected" },
    { key: "hover" },
    { key: "text" },
    { key: "bright" },
    { key: "muted" },
    { key: "accentText" },
    { key: "danger" }
  ];

  // scripts/api-previews.js
  var kit = createKit(document);
  var $ = (id) => document.getElementById(id);
  var store = /* @__PURE__ */ new Map();
  var helperCss = document.createElement("style");
  var toasted = () => {
  };
  var helpers = createHelpers({
    pluginId: "api-page",
    css: (text) => {
      helperCss.textContent = text;
    },
    toast: (message) => toasted(message),
    settings: {
      get: (key, fallback) => store.has(key) ? store.get(key) : fallback,
      set: async (key, value) => {
        store.set(key, value);
      }
    },
    /*
     * Every cleanup a helper hands back, collected for whoever is drawing.
     *
     * `helpers.mount`, `each`, `badge`, `hotkey` and `poll` all keep observing
     * after the call returns -- that is what they are for -- and in the client
     * the plugin host holds their cleanups. Here the drawing panel does: without
     * it, `keepMounted` from one entry went on putting its button into the next
     * entry's fake client, and `helpers.mount`'s demo showed a `kept` button
     * nobody on that page had asked for.
     */
    track: (cleanup) => {
      TRACKED.push(cleanup);
      return cleanup;
    }
  });
  var TRACKED = [];
  function installStyles() {
    if (document.getElementById("sm-kit-css")) return;
    const style = document.createElement("style");
    style.id = "sm-kit-css";
    style.textContent = KIT_CSS;
    const panel = document.createElement("style");
    panel.id = "betterslack-panel-css";
    panel.textContent = PANEL_CSS;
    const launcher = document.createElement("style");
    launcher.id = "betterslack-launcher-css";
    launcher.textContent = LAUNCHER_CSS;
    document.head.append(style, panel, launcher, helperCss);
  }
  var el = (tag, className, children = []) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.append(...children);
    return node;
  };
  function control(spec2, state, draw) {
    const id = `pg-${spec2.key}-${Math.random().toString(36).slice(2, 7)}`;
    let input;
    if (spec2.type === "select") {
      input = kit.select(spec2.options.map((o) => ({ value: o, label: o })), {
        value: state[spec2.key],
        onChange: (value) => {
          state[spec2.key] = value;
          draw();
        }
      });
    } else if (spec2.type === "boolean") {
      input = document.createElement("input");
      input.type = "checkbox";
      input.className = "pg__check";
      input.checked = Boolean(state[spec2.key]);
      input.addEventListener("change", () => {
        state[spec2.key] = input.checked;
        draw();
      });
    } else if (spec2.type === "textarea") {
      input = kit.el("textarea", { class: "api-input", rows: "8", spellcheck: "false" }, [state[spec2.key] ?? ""]);
      input.addEventListener("input", () => {
        state[spec2.key] = input.value;
        draw();
      });
    } else {
      input = kit.input({ value: state[spec2.key], type: spec2.type === "number" ? "number" : "text" });
      input.addEventListener("input", () => {
        state[spec2.key] = spec2.type === "number" ? Number(input.value) : input.value;
        draw();
      });
    }
    input.id = id;
    const label = el("label", "pg__label");
    label.htmlFor = id;
    label.textContent = spec2.label || spec2.key;
    return el("div", "pg__control", [label, input]);
  }
  var MOUNTED = /* @__PURE__ */ new Map();
  function playground(name, render) {
    const slot = document.querySelector(`[data-demo="${name}"]`);
    if (!slot) return;
    let controls = [];
    try {
      controls = JSON.parse(slot.dataset.controls || "[]");
    } catch {
      controls = [];
    }
    const state = {};
    for (const c of controls) state[c.key] = c.value;
    const stage = el("div", "pg__stage slack-stage");
    stage.dataset.theme = document.getElementById("stage-theme")?.value ?? "midnight";
    let cleanups = [];
    const teardown = () => {
      for (const stop of cleanups.splice(0)) {
        try {
          stop();
        } catch {
        }
      }
      stage.replaceChildren();
    };
    const keep = (stop) => {
      if (typeof stop === "function") cleanups.push(stop);
    };
    const draw = () => {
      teardown();
      TRACKED.length = 0;
      try {
        const made = render(state, { stage, keep });
        if (made !== void 0) stage.replaceChildren(...[].concat(made).filter(Boolean));
      } catch (err) {
        stage.textContent = `this demo threw: ${err.message}`;
      }
      for (const stop of TRACKED.splice(0)) keep(stop);
    };
    const parts = [el("div", "pg", [stage])];
    if (controls.length) {
      parts.push(el("div", "pg-knobs", [
        el("p", "pg-knobs__title", [document.documentElement.lang === "fr" ? "Param\xE8tres" : "Props"]),
        el("div", "pg__controls", controls.map((c) => control(c, state, draw)))
      ]));
    }
    slot.replaceChildren(...parts);
    const entry = {
      drawn: true,
      draw: () => {
        draw();
        entry.drawn = true;
      },
      teardown: () => {
        teardown();
        entry.drawn = false;
      }
    };
    MOUNTED.set(slot.closest(".panel")?.id ?? name, entry);
    return entry;
  }
  function copyButton(text) {
    const button = el("button", "pg__copy");
    button.type = "button";
    button.textContent = "Copy";
    button.addEventListener("click", async () => {
      const ok = await kit.copyText(text());
      button.textContent = ok ? "Copied" : "Press \u2318C";
      setTimeout(() => {
        button.textContent = "Copy";
      }, 1600);
    });
    return button;
  }
  var GLYPHS = [
    "\u270E",
    "\u{1F5D1}",
    "\u22EF",
    "\u2699",
    "\u2713",
    "\u2715",
    "\uFF0B",
    "\u21BB",
    "\u2605",
    "\u2913",
    "\u21E7",
    "\u29C9",
    "svg"
  ];
  var GLYPH_SVG = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 13.5V16h2.5l7.4-7.4-2.5-2.5L4 13.5Zm11.8-6.9a.7.7 0 0 0 0-1L14.4 4.2a.7.7 0 0 0-1 0l-1.2 1.2 2.5 2.5 1.1-1.3Z" fill="currentColor"/></svg>';
  var KIT = {
    el: {
      render: (v) => kit.el(v.tag, { class: v.className }, [v.text])
    },
    button: {
      render: (v) => kit.button(v.label, { variant: v.variant, wide: v.wide, title: v.title })
    },
    iconButton: {
      /*
       * The glyph list, and what it honestly is.
       *
       * `kit.iconButton` sets the button's innerHTML to whatever it is handed, so
       * a glyph is any markup at all -- a character, an emoji, an inline SVG.
       * There is no list of "Slack's icons" to offer here and it would be wrong
       * to invent one: Slack's own icons are classes in Slack's stylesheet, and
       * the kit exists for a window a mod opens, where that stylesheet does not
       * reach. So this is a set of characters that need no font beyond the
       * system's, plus one entry that is a real SVG, because that is the answer
       * to the question the select provokes.
       */
      render: (v) => {
        const chosen = v.glyph === "svg" ? GLYPH_SVG : v.glyph;
        const shown = kit.iconButton(chosen, { title: v.title, danger: v.danger, onClick: () => {
        } });
        return [
          shown,
          kit.el("span", { class: "sm-hint" }, [
            v.glyph === "svg" ? "any markup, not just a character" : `kit.iconButton(${JSON.stringify(v.glyph)})`
          ]),
          kit.el("div", { class: "pg__glyphs" }, GLYPHS.map((glyph) => kit.iconButton(
            glyph === "svg" ? GLYPH_SVG : glyph,
            { title: glyph, onClick: () => {
            } }
          )))
        ];
      }
    },
    input: {
      render: (v) => kit.input({ value: v.value, placeholder: v.placeholder })
    },
    field: {
      render: (v) => kit.field(v.label, kit.input({ value: "Midnight" }), v.hint)
    },
    select: {
      render: (v) => kit.select(
        v.options.split(",").map((o) => ({ value: o.trim(), label: o.trim() })),
        { value: v.value.trim() }
      )
    },
    segmented: {
      render: (v) => kit.segmented(
        v.labels.split(",").map((label, i) => ({
          value: label.trim().toLowerCase(),
          label: label.trim(),
          count: i === 0 && v.count ? v.count : void 0
        })),
        { value: v.labels.split(",")[0].trim().toLowerCase() }
      ).node
    },
    card: {
      render: (v) => kit.card(v.title, [kit.el("p", { class: "sm-hint" }, [v.subtitle])], {
        actions: v.action ? [kit.button(v.action, { variant: "ghost" })] : []
      })
    },
    emptyState: {
      render: (v) => kit.emptyState(v.title, v.body, v.action ? kit.button(v.action, { variant: "primary" }) : void 0)
    },
    swatch: {
      render: (v) => kit.swatch(v.colour, { size: v.size })
    },
    popover: {
      render: (v) => {
        const anchor = kit.button(v.label);
        anchor.addEventListener("click", () => {
          const content = kit.el("div", { style: "padding:12px;min-width:210px" }, [
            kit.el("p", { class: "sm-hint", style: "margin:0 0 10px" }, ["Anchored, and dismissed by a click outside."])
          ]);
          kit.popover(content, anchor);
        });
        return anchor;
      }
    },
    confirm: {
      render: (v) => {
        const trigger = kit.button(v.action, { variant: v.danger ? "danger" : "primary" });
        const said = kit.el("span", { class: "sm-hint", style: "margin-left:10px" }, [""]);
        trigger.addEventListener("click", async () => {
          const yes = await kit.confirm({
            title: v.title,
            body: v.body,
            action: v.action,
            cancel: "Keep it",
            danger: v.danger
          });
          said.textContent = yes ? `it resolved true` : "it resolved false";
        });
        return [trigger, said];
      }
    },
    copyText: {
      render: (v) => {
        const button = kit.button(`Copy ${v.text}`);
        const said = kit.el("span", { class: "sm-hint", style: "margin-left:10px" }, [""]);
        button.addEventListener("click", async () => {
          said.textContent = await kit.copyText(v.text) ? "resolved true" : "resolved false";
        });
        return [button, said];
      }
    },
    code: {
      // Full width and pre-filled: an editor is judged on how text sits in it, and
      // an empty box half the stage wide shows neither the wrapping nor the
      // colouring that is the whole point of the component.
      render: (v) => kit.code({ value: v.value, rows: Math.max(4, Number(v.rows) || 12) }).node
    }
  };
  var HELPERS = {
    toggle: {
      render: (v) => {
        for (const name of [...document.documentElement.classList]) {
          if (name.startsWith("demo-") || name.startsWith("betterslack-api-page")) {
            document.documentElement.classList.remove(name);
          }
        }
        const flag = helpers.toggle({
          key: `demo-${v.className}`,
          className: v.className,
          defaultOn: v.defaultOn,
          whenOn: "& .pg__watch { outline: 2px solid #36c5f0; }"
        });
        const watch = el("div", "pg__watch");
        const state = kit.el("span", { class: "sm-hint", style: "margin-left:10px" }, []);
        const paint = () => {
          state.textContent = flag.on ? `on \u2014 <html class="${v.className}">` : "off \u2014 the class is gone, and so is the CSS";
        };
        watch.append(kit.button("Toggle", { variant: "primary" }), state);
        watch.querySelector("button").addEventListener("click", async () => {
          await flag.toggle();
          paint();
        });
        paint();
        return watch;
      }
    },
    describeHotkey: {
      render: (v) => kit.el("strong", { style: "font-size:20px" }, [helpers.describeHotkey(v.combo)])
    },
    debounce: {
      render: (v, { stage }) => {
        const out = kit.el("p", { class: "sm-hint" }, ["type below"]);
        let typed = 0;
        let ran = 0;
        const run = helpers.debounce(() => {
          ran += 1;
          out.textContent = `${typed} keystrokes, ${ran} call${ran === 1 ? "" : "s"} through`;
        }, v.ms);
        const box = kit.input({ placeholder: "type quickly, then stop" });
        box.addEventListener("input", () => {
          typed += 1;
          run();
        });
        return [box, out];
      }
    }
  };
  var ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10 6.5v4M10 13.2v.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  var UI = {
    "ui-toast": {
      render: (v) => {
        const button = kit.button("Show the toast", { variant: "primary" });
        button.addEventListener("click", () => toast(v.message, {
          variant: v.variant,
          action: v.action ? { label: v.action, onClick: () => {
          } } : void 0
        }));
        return button;
      }
    },
    "ui-modal": {
      render: (v) => {
        const button = kit.button("Open the dialog", { variant: "primary" });
        button.addEventListener("click", () => {
          modal({
            title: v.title,
            content: h("p", { class: "betterslack-hint" }, [v.body]),
            width: v.width,
            actions: [{ label: v.action, primary: true, onClick: () => true }]
          });
        });
        return button;
      }
    },
    "ui-confirm": {
      render: (v) => {
        const button = kit.button("Ask", { variant: v.danger ? "danger" : "primary" });
        const said = kit.el("span", { class: "sm-hint", style: "margin-left:10px" }, [""]);
        button.addEventListener("click", async () => {
          said.textContent = await confirm({ title: v.title, body: v.body, danger: v.danger }) ? "resolved true" : "resolved false";
        });
        return [button, said];
      }
    },
    "ui-menu": {
      render: (v) => {
        const anchor = kit.button("Open the menu");
        anchor.addEventListener("click", () => openMenu(anchor, v.items.split(",").map((label, i) => ({
          label: label.trim(),
          danger: i === v.items.split(",").length - 1,
          onSelect: () => {
          }
        }))));
        return anchor;
      }
    }
  };
  function slackChrome({ pane = false } = {}) {
    const frame = el("div", "chrome");
    frame.innerHTML = SLACK_FIXTURE;
    for (const img of frame.querySelectorAll("img")) {
      img.classList.add("chrome__avatar");
      img.dataset.seed = (img.src.match(/-(U[A-Z0-9]+)-/) ?? [, "U0"])[1];
      img.alt = "";
      img.src = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E#` + new URL(img.src).pathname;
    }
    return dressChrome(frame, pane);
  }
  function dressChrome(frame, pane_ = false) {
    const client = frame.querySelector(".p-client_container");
    const pick = (selector) => frame.querySelector(selector);
    const rail = pick(".p-tab_rail");
    const sidebar = pick(".p-channel_sidebar");
    const primary = pick(".p-view_contents--primary");
    const header = pick(".p-view_header__actions");
    const strip = pick(".p-control_strip");
    const pane = pick('[data-qa="member_profile_pane"]');
    const railColumn = el("div", "chrome__rail");
    railColumn.append(rail, el("div", "chrome__spacer"), strip);
    const list = pick(".p-channel_sidebar__list");
    for (const [name, state] of [["general", ""], ["releases", "is-selected"], ["design", "is-unread"], ["random", ""]]) {
      const row = el("div", `p-channel_sidebar__channel ${state}`);
      row.innerHTML = `<span class="chrome__hash">#</span><span class="chrome__name">${name}</span>`;
      list.append(row);
    }
    const bar = el("div", "p-view_header");
    const title = el("div", "chrome__title");
    title.innerHTML = '<span class="chrome__hash">#</span>releases<span class="chrome__topic">Ships on Thursdays</span>';
    bar.append(title, header);
    const message = pick('[data-qa="message_container"]');
    const text = message.querySelector('[data-qa="message-text"]');
    text.replaceWith(Object.assign(document.createElement("div"), {
      className: "chrome__lines",
      innerHTML: '<div class="chrome__who">Robin Vasquez <span class="chrome__when">11:04</span></div><div data-qa="message-text">Cutting 1.4 this afternoon \u2014 anything still open?</div>'
    }));
    message.append(el("div", "chrome__filler"));
    const composer2 = pick('[data-qa="message_input"]');
    const editor = composer2.querySelector(".ql-editor");
    if (editor) editor.innerHTML = '<p class="chrome__placeholder">Message #releases</p>';
    const container = pane.querySelector(".p-r_member_profile__container");
    container.append(Object.assign(document.createElement("div"), {
      className: "chrome__profile",
      innerHTML: '<div class="chrome__who">Robin Vasquez</div><div class="chrome__role">Release engineering</div>'
    }));
    if (!pane_) pane.classList.add("chrome__offstage");
    const panel = el("div", "p-client_workspace__tabpanel chrome__panel");
    panel.append(sidebar, el("div", "chrome__main"), pane);
    client.replaceChildren(railColumn, panel);
    frame.querySelector(".chrome__main").append(bar, primary);
    primary.querySelector(".p-message_pane").append(composer2);
    return frame;
  }
  function focusChrome(frame, selector) {
    const target = frame.querySelector(selector);
    if (!target) return;
    const dim = (node) => {
      for (const child of node.children) {
        if (child === target || child.contains(target)) dim(child);
        else child.classList.add("chrome__dim");
      }
    };
    dim(frame.querySelector(".p-client_container") ?? frame);
    target.classList.add("chrome__focus");
  }
  var TOOLBAR_CONTAINER = {
    controlStrip: ".p-control_strip",
    composer: '[data-qa="message_input"]',
    channelHeader: ".p-view_header__actions"
  };
  var CHROME = {
    "slack-addtoolbarbutton": {
      render: (v, { stage, keep }) => {
        const frame = slackChrome();
        stage.replaceChildren(frame);
        keep(addToolbarButton("demo", v.toolbar, { id: "demo", label: v.label, icon: ICON, onClick: () => {
        } }));
        focusChrome(frame, TOOLBAR_CONTAINER[v.toolbar]);
        return void 0;
      }
    },
    "slack-addmessageaction": {
      render: (v, { stage, keep }) => {
        const frame = slackChrome();
        stage.replaceChildren(frame);
        keep(addMessageAction("demo", { id: "demo", label: v.label, icon: ICON, onClick: () => {
        } }));
        focusChrome(frame, '[data-qa="message_container"]');
        return void 0;
      }
    },
    "slack-addview": {
      render: (v, { stage, keep }) => {
        const frame = slackChrome({ pane: true });
        stage.replaceChildren(frame);
        const view = addView("demo", {
          id: "demo",
          label: v.label,
          icon: ICON,
          render: () => kit.el("div", { class: "pg__stub" }, [
            kit.el("h3", { textContent: v.label }),
            kit.el("p", { textContent: v.body ?? "" })
          ])
        });
        keep(view.dispose);
        view.open();
        focusChrome(frame, ".p-client_workspace__tabpanel");
        return void 0;
      }
    },
    "slack-addprofilebutton": {
      render: (v, { stage, keep }) => {
        const frame = slackChrome({ pane: true });
        stage.replaceChildren(frame);
        keep(addProfileButton("demo", { id: "demo", label: v.label, icon: ICON, onClick: () => {
        } }));
        focusChrome(frame, '[data-qa="member_profile_pane"]');
        return void 0;
      }
    },
    "slack-onteamchange": {
      render: (v) => {
        const line = (team) => `https://app.slack.com/client/${team}/C0BQ8AG3771`;
        return kit.el("div", {}, [
          kit.el("pre", { class: "pg__out" }, [
            `before  ${line(v.from)}
after   ${line(v.to)}

handler(${JSON.stringify(v.to)}, ${JSON.stringify(v.from)})` + (v.to === v.from ? "   \u2014 not called: same workspace" : "")
          ]),
          stubbed("Same document, same mods, same api objects. Only the address moved.")
        ]);
      }
    },
    "slack-events": {
      render: (v) => {
        const frames = {
          onMessage: { type: "message", channel: "C0BQ8AG3771", ts: "1787645635.864779", user: "U04ED8UPV", text: "shipping it", team: "T025V5WN2" },
          onMessageChanged: {
            type: "message",
            subtype: "message_changed",
            channel: "C0BQ8AG3771",
            previous_message: { ts: "1787645635.864779", user: "U04ED8UPV", text: "shipping it" },
            message: { ts: "1787645635.864779", user: "U04ED8UPV", text: "shipping it *tomorrow*" }
          },
          onMessageDeleted: {
            type: "message",
            subtype: "message_deleted",
            channel: "C0BQ8AG3771",
            deleted_ts: "1787645635.864779",
            previous_message: { ts: "1787645635.864779", user: "U04ED8UPV", text: "shipping it" }
          },
          onReaction: { type: "reaction_removed", user: "U02NTAZJXKP", reaction: "tada", item: { type: "message", channel: "C0BQ8AG3771", ts: "1787645635.864779" }, event_ts: "1787645912.000200" },
          onMembership: { type: "member_joined_channel", channel: "C0BQ8AG3771", user: "U04ED8UPV", team: "T025V5WN2" },
          onConversation: { type: "channel_rename", channel: { id: "C0BQ8AG3771", name: "tech-archive" } },
          onUserChanged: { type: "user_change", user: { id: "U04ED8UPV", name: "ludo", profile: { display_name: "Ludo", status_text: "en r\xE9union", status_emoji: ":calendar:" } } },
          onPresence: { type: "presence_change", users: ["U04ED8UPV", "U02NTAZJXKP"], presence: "away" }
        };
        const frame = frames[v.listener] ?? frames.onMessage;
        const events = createSlackEvents({ request: async () => null });
        let read = null;
        events[v.listener]?.((value) => {
          read = value;
        });
        events.deliver(frame);
        const pane = (label, value) => kit.el("div", {}, [
          kit.el("p", { class: "sm-hint", textContent: label }),
          kit.el("pre", { class: "pg__out" }, [JSON.stringify(value, (key, v2) => key === "raw" ? void 0 : v2, 2)])
        ]);
        return kit.el("div", {}, [
          pane("what Slack sends", frame),
          pane("what the listener is handed (raw omitted)", read ?? "\u2014 nothing, which is what an unfurl gets"),
          stubbed("There is no socket to listen to on a web page; the frames are Slack\u2019s own shape.")
        ]);
      }
    },
    "slack-rendermrkdwn": {
      render: (v) => {
        const line = kit.el("div", { style: "line-height:1.5; word-break:break-word" });
        line.append(renderMrkdwn(v.text, {
          shortLinks: v.shortLinks,
          oneLine: v.oneLine,
          // A workspace this page has not got: the two ids in the sample, and
          // the callbacks answering null for anything else, which is what a mod
          // that has not resolved somebody yet does too.
          userName: (id) => ({ U04ED8UPV: "Ludo" })[id] ?? null,
          channelName: (id) => ({ C01BQ8AG3: "tech" })[id] ?? null,
          emojiUrl: (name) => `https://a.slack-edge.com/production-standard-emoji-assets/16.0/apple-small/${{ tada: "1f389", rocket: "1f680" }[name] ?? "2753"}@2x.png`,
          onChannel: () => {
          }
        }));
        return line;
      }
    },
    "slack-avatarurl": {
      render: (v) => {
        const at = /-\d+$/.test(v.url) ? v.url.replace(/-\d+$/, `-${v.size}`) : null;
        return kit.el("code", { class: "sm-hint", style: "word-break:break-all" }, [at ?? "null \u2014 not one of Slack\u2019s avatar URLs"]);
      }
    }
  };
  var SLACK_HELPERS = {
    "helpers-disclosure": {
      render: (v, { stage, keep }) => {
        const frame = slackChrome();
        stage.replaceChildren(frame);
        const line = kit.el("div", { class: "p-rich_text_section" });
        line.append(document.createTextNode("the wording that is there now "));
        const label = kit.el("span", { class: "c-message__edited_label", textContent: v.label });
        line.append(label);
        frame.querySelector('[data-qa="message-text"]').append(line);
        document.documentElement.classList.toggle("betterslack-motion-panels", v.motion !== false);
        document.documentElement.classList.toggle("betterslack-motion", v.motion !== false);
        const handle = helpers.disclosure({
          trigger: ".c-message__edited_label",
          label: "See what this said before",
          keyFor: () => "demo",
          anchor: () => frame.querySelector('[data-qa="message-text"]'),
          content: () => kit.el("div", { class: "pg__stub", textContent: "what it said before" })
        });
        handle.refresh();
        keep(handle);
        focusChrome(frame, '[data-qa="message_container"]');
        return void 0;
      }
    },
    "helpers-iconbutton": {
      render: (v) => helpers.iconButton({ icon: ICON, label: v.label, surface: v.surface, onClick: () => {
      } })
    },
    "helpers-field": {
      render: (v) => helpers.field(v.label, v.value)
    },
    "helpers-section": {
      render: (v) => helpers.section(v.title, v.rows.split(",").map((row) => {
        const [label, value] = row.split(":");
        return helpers.field((label ?? "").trim(), (value ?? "").trim());
      }))
    },
    "helpers-cache": {
      /*
       * The real helper, against the page's in-memory settings. What it shows is
       * the decision `swr` makes: the stored value is handed back at once, and
       * the callback fires only when the fresh answer is not the stored one.
       */
      render: (v) => {
        const store2 = helpers.cache("preview-demo", { keys: 4 });
        store2.set("list", v.stored);
        const out = kit.el("pre", { class: "pg__out" }, [""]);
        const held = store2.swr("list", async () => v.fresh, (fresh) => {
          out.textContent += `
onFresh fired: ${JSON.stringify(fresh)}`;
        });
        out.textContent = `store.swr(...) returned ${JSON.stringify(held)}  \u2014 synchronously`;
        if (v.stored === v.fresh) {
          out.textContent += "\n\n(the answer matches what was stored, so nothing repaints)";
        }
        return out;
      }
    },
    "helpers-badge": {
      render: (v, { stage }) => {
        const host = el("div", "pg__badge-host");
        host.append(helpers.iconButton({ icon: ICON, label: "Activity", surface: "header", onClick: () => {
        } }));
        stage.replaceChildren(host);
        helpers.badge(".pg__badge-host button", "demo-badge", () => v.value || null);
        return void 0;
      }
    },
    "helpers-tooltip": {
      render: (v) => {
        const button = helpers.iconButton({ icon: ICON, label: v.title, surface: "header", onClick: () => {
        } });
        helpers.tooltip(button, v.title, v.subtitle);
        return [button, kit.el("span", { class: "sm-hint", style: "margin-left:10px" }, ["hover it"])];
      }
    }
  };
  function say(stage, lines) {
    return kit.el("pre", { class: "pg__out" }, [lines.join("\n")]);
  }
  var MORE = {
    "slack-selectors": {
      render: () => {
        const slack = createSlackApi("demo");
        return kit.el("table", { class: "pg__table" }, Object.entries(slack.selectors).map(
          ([name, value]) => kit.el("tr", {}, [
            kit.el("td", {}, [name]),
            kit.el("td", {}, [kit.el("code", {}, [value])])
          ])
        ));
      }
    },
    "slack-describemessage": {
      render: (v, { stage }) => {
        const frame = slackChrome();
        stage.replaceChildren(frame);
        focusChrome(frame, '[data-qa="message_container"]');
        const message = describeMessage(frame.querySelector('[data-qa="message_container"]'));
        stage.append(say(stage, [
          `channelId: ${message.channelId}`,
          `ts:        ${message.ts}`,
          `text:      ${message.text}`,
          `permalink: ${message.permalink}`
        ]));
        return void 0;
      }
    },
    "slack-composer": {
      render: (v, { stage }) => {
        const frame = slackChrome();
        stage.replaceChildren(frame);
        focusChrome(frame, '[data-qa="message_input"]');
        const slack = createSlackApi("demo");
        const out = kit.el("span", { class: "sm-hint" }, ["the fixture composer is a real contenteditable"]);
        const say2 = (what, ok) => {
          out.textContent = `${what} -> ${ok}`;
        };
        const text = kit.button("insertText()", { variant: "primary" });
        text.addEventListener("click", () => say2("insertText", slack.composer.insertText(v.text)));
        const link = kit.button("insertLink()");
        link.addEventListener("click", () => say2("insertLink", slack.composer.insertLink(v.link, "the thread")));
        const empty = kit.button("isEmpty()");
        empty.addEventListener("click", () => say2("isEmpty", slack.composer.isEmpty()));
        stage.append(text, link, empty, out);
        return void 0;
      }
    },
    "helpers-each": {
      render: (v, { stage }) => {
        const frame = slackChrome();
        stage.replaceChildren(frame);
        focusChrome(frame, '[data-qa="message_container"]');
        const seen = kit.el("span", { class: "sm-hint" }, [""]);
        helpers.each('[data-qa="message_container"]', (message) => {
          message.style.outline = "2px solid var(--dt_color-content-hgl-1, #7cc4ff)";
          seen.textContent = "the handler ran on every match, and will run on new ones";
        });
        stage.append(seen);
        return void 0;
      }
    },
    "helpers-mount": {
      render: (v, { stage }) => {
        const frame = slackChrome();
        stage.replaceChildren(frame);
        focusChrome(frame, ".p-control_strip");
        helpers.mount(".p-control_strip", "demo-mounted", () => helpers.iconButton({
          icon: ICON,
          label: "mounted",
          surface: "rail",
          onClick: () => {
          }
        }));
        return void 0;
      }
    },
    "helpers-hotkey": {
      render: (v, { stage }) => {
        const out = kit.el("p", { class: "sm-hint" }, [`press ${helpers.describeHotkey(v.combo)} with this page focused`]);
        let count = 0;
        helpers.hotkey(v.combo, () => {
          count += 1;
          out.textContent = `${helpers.describeHotkey(v.combo)} fired ${count}\xD7`;
        });
        return out;
      }
    },
    "helpers-poll": {
      render: (v) => {
        const out = kit.el("p", { class: "sm-hint" }, ["\u2026"]);
        let ticks = 0;
        helpers.poll(() => {
          ticks += 1;
          out.textContent = `${ticks} tick${ticks === 1 ? "" : "s"} \u2014 and it stops while this tab is hidden`;
        }, Math.max(250, v.ms));
        return out;
      }
    },
    "helpers-copy": {
      render: (v) => {
        const button = kit.button("copy()", { variant: "primary" });
        const out = kit.el("span", { class: "sm-hint", style: "margin-left:10px" }, [""]);
        toasted = (message) => {
          out.textContent = `api.ui.toast(${JSON.stringify(message)})`;
        };
        button.addEventListener("click", () => helpers.copy(v.text, "Link copied"));
        return [button, out];
      }
    },
    "kit-hoverable": {
      render: () => {
        const out = kit.el("span", { class: "sm-hint", style: "margin-left:10px" }, ["not hovered"]);
        const row = kit.button("hover me");
        kit.hoverable(row, {
          enter: () => {
            out.textContent = "enter";
          },
          leave: () => {
            out.textContent = "leave";
          }
        });
        return [row, out];
      }
    },
    "dom-h": {
      render: (v) => h(v.tag, { class: v.className }, [v.text])
    },
    "dom-waitfor": {
      render: (v, { stage }) => {
        const out = kit.el("p", { class: "sm-hint" }, ["looking for .late-arrival\u2026"]);
        const late = document.createElement("div");
        late.className = "late-arrival";
        waitFor(".late-arrival", 4e3).then((found) => {
          out.textContent = found ? "found it \u2014 resolved with the element" : "timed out \u2014 resolved null, it does not throw";
        });
        setTimeout(() => stage.append(late), 900);
        return out;
      }
    },
    "dom-keepmounted": {
      render: (v, { stage, keep }) => {
        const frame = slackChrome();
        stage.replaceChildren(frame);
        focusChrome(frame, ".p-control_strip");
        const out = kit.el("p", { class: "sm-hint" }, [""]);
        keep(keepMounted(
          ".p-control_strip",
          "demo-keep",
          () => helpers.iconButton({ icon: ICON, label: "kept", surface: "rail", onClick: () => {
          } })
        ));
        const remove = kit.button("remove it", { variant: "danger" });
        remove.addEventListener("click", () => {
          frame.querySelector("#demo-keep")?.remove();
          out.textContent = "taken out \u2014 and put straight back";
        });
        stage.append(remove, out);
        return void 0;
      }
    },
    "dom-oneach": {
      render: (v, { stage, keep }) => {
        const list = kit.el("div", { class: "pg__rows" }, []);
        const out = kit.el("p", { class: "sm-hint" }, ["0 rows seen"]);
        let seen = 0;
        keep(onEach(".pg__rows > .row", (row) => {
          seen += 1;
          row.style.color = "var(--dt_color-content-hgl-1, #7cc4ff)";
          out.textContent = `${seen} rows seen \u2014 including the ones added later`;
        }));
        const add = kit.button("add a row", { variant: "primary" });
        add.addEventListener("click", () => list.append(kit.el("div", { class: "row" }, ["a new row"])));
        list.append(kit.el("div", { class: "row" }, ["a row that was already here"]));
        return [list, add, out];
      }
    },
    "dom-onshortcut": {
      render: (v, { keep }) => {
        const out = kit.el("p", { class: "sm-hint" }, ["press F1 with this page focused"]);
        keep(onShortcut((event) => event.key === "F1", () => {
          out.textContent = "F1 \u2014 the match ran";
        }));
        return out;
      }
    },
    "settings-set": {
      render: (v, { stage }) => {
        const out = kit.el("pre", { class: "pg__out" }, [JSON.stringify(Object.fromEntries(store), null, 2)]);
        const button = kit.button("set()", { variant: "primary" });
        button.addEventListener("click", async () => {
          store.set(v.key, v.value);
          out.textContent = JSON.stringify(Object.fromEntries(store), null, 2);
        });
        return [button, out];
      }
    },
    "settings-get": {
      render: (v) => kit.el("pre", { class: "pg__out" }, [
        String(store.has(v.key) ? store.get(v.key) : v.fallback)
      ])
    },
    "plugin-css": {
      render: (v, { stage }) => {
        const sheet = kit.el("style");
        sheet.textContent = v.css ?? "";
        const target = kit.el("div", { class: "pg__cssdemo" }, [
          kit.el("div", { class: "p-channel_sidebar" }, ["#\xA0general"])
        ]);
        stage.replaceChildren(sheet, target, source(`api.css(\`${v.css ?? ""}\`);`, "javascript"));
        return void 0;
      }
    },
    "log-info": {
      render: (v) => say(null, [
        `[betterslack:my-plugin] ${v.message}`,
        "",
        "and the same line in the loader\u2019s terminal, which is where",
        "a mod that failed at boot says so."
      ])
    },
    "i18n-locale": {
      render: () => say(null, [`locale:   ${createI18n().locale}`, `language: ${createI18n().language}`])
    },
    "ui-palette": {
      render: () => {
        const button = kit.button("Open the palette", { variant: "primary" });
        button.addEventListener("click", () => openPalette(
          (query) => [
            { id: "a", title: "Go to #releases", subtitle: "channel", source: "Slack", run: () => {
            } },
            { id: "b", title: "Open BetterSlack", subtitle: "\u2318\u21E7M", source: "BetterSlack", run: () => {
            } },
            { id: "c", title: "Change the shortcuts", source: "Command Palette", run: () => {
            } }
          ].filter((row) => row.title.toLowerCase().includes(query.toLowerCase())),
          { placeholder: "Jump to\u2026", empty: "Nothing matches" }
        ));
        return button;
      }
    }
  };
  var REST = {
    "kit-checker": {
      render: () => [
        kit.el("div", { style: `padding:18px;border-radius:10px;background:${kit.CHECKER}` }, [
          kit.el("div", { style: "width:120px;height:56px;border-radius:8px;background:rgba(97,31,105,.45)" })
        ]),
        kit.el("span", { class: "sm-hint" }, ["the same colour without it would read as a flat grey-purple"])
      ]
    },
    "slack-useridfrommessage": {
      render: (v, { stage }) => {
        const frame = slackChrome();
        stage.replaceChildren(frame);
        focusChrome(frame, '[data-qa="message_container"]');
        const url = frame.querySelector(".c-message_kit__avatar img")?.src ?? "";
        stage.append(kit.el("pre", { class: "pg__out" }, [
          `from ${url}`,
          `      -> ${userIdFromAvatarUrl(url)}`
        ]));
        return void 0;
      }
    },
    "slack-currentchannelid": {
      render: () => {
        const slack = createSlackApi("demo");
        return kit.el("pre", { class: "pg__out" }, [
          `location.pathname   ${location.pathname}`,
          `currentChannelId()  ${slack.currentChannelId()}`,
          "",
          "null here, because this page is not a conversation. In Slack it is the",
          "channel on screen, read out of the URL rather than from the DOM."
        ]);
      }
    },
    "ui-tooltip": {
      render: (v) => {
        const button = kit.button("hover me");
        attachTooltip(button, { title: v.title, subtitle: v.subtitle, placement: v.placement });
        return [button, kit.el("span", { class: "sm-hint" }, [`placement: ${v.placement}`])];
      }
    },
    "ui-kit": {
      render: () => [
        kit.button("Save", { variant: "primary" }),
        kit.button("Cancel"),
        kit.iconButton("\u270E", { title: "Rename" }),
        kit.input({ value: "Midnight" }),
        kit.swatch("#611f69")
      ]
    },
    "i18n-language": {
      render: () => kit.el("pre", { class: "pg__out" }, [
        `locale    ${createI18n().locale}`,
        `language  ${createI18n().language}`
      ])
    },
    "settings-all": {
      render: () => kit.el("pre", { class: "pg__out" }, [
        JSON.stringify(Object.fromEntries(store), null, 2) || "{}"
      ])
    },
    "settings-onchange": {
      render: (v) => {
        const out = kit.el("pre", { class: "pg__out" }, ["waiting for a change\u2026"]);
        const button = kit.button("set() something", { variant: "primary" });
        let n = 0;
        button.addEventListener("click", () => {
          n += 1;
          store.set("ticks", n);
          out.textContent = `the handler ran with ${JSON.stringify(Object.fromEntries(store))}`;
        });
        return [button, out];
      }
    },
    "themes-list": {
      render: () => kit.el("div", { class: "pg__rows" }, (window.CATALOGUE?.themes ?? []).map(
        (theme) => kit.el("div", { class: "row" }, [`${theme.id} \u2014 ${theme.name}`])
      ))
    },
    "app-mods": {
      render: () => {
        const mods = [...window.CATALOGUE?.themes ?? [], ...window.CATALOGUE?.plugins ?? []];
        return kit.el("pre", { class: "pg__out" }, [
          `${mods.length} mods in the catalogue`,
          "",
          ...mods.slice(0, 6).map((mod) => `  ${mod.id.padEnd(22)} v${mod.version}`),
          "  \u2026"
        ]);
      }
    },
    "log-warn": {
      render: () => kit.el("pre", { class: "pg__out" }, [
        "[betterslack:member-sidebar] presence lookup stopped",
        "",
        "The loader forwards warnings that mention betterslack even without",
        "BETTERSLACK_VERBOSE, so this line reaches the terminal too."
      ])
    },
    "log-error": {
      render: () => kit.el("pre", { class: "pg__out" }, [
        "[betterslack:user-inspector] WebApiError: users.info failed: user_not_found",
        "",
        "An uncaught one is always forwarded: a mod that threw at boot says so in",
        "the terminal instead of hiding in a DevTools window nobody opened."
      ])
    },
    "commands-add": {
      render: (v) => kit.el("div", { class: "betterslack-palette__list" }, [
        kit.el("div", { class: "betterslack-palette__row" }, [
          kit.el("span", { class: "betterslack-palette__icon betterslack-palette__icon--glyph" }, [v.icon]),
          kit.el("span", { class: "betterslack-palette__text" }, [
            kit.el("span", { class: "betterslack-palette__title" }, [v.title]),
            kit.el("span", { class: "betterslack-palette__sub" }, [v.subtitle])
          ]),
          kit.el("span", { class: "betterslack-palette__source" }, ["Channel Notes"])
        ])
      ])
    }
  };
  var FIXTURES = typeof window !== "undefined" && window.__API_FIXTURES || {
    theme: { id: "midnight", css: "" },
    plugin: { id: "channel-notes", files: [], manifest: {}, entry: "" }
  };
  var KEPT = /* @__PURE__ */ new Map([["my-ding.mp3", { bytes: 48320, modified: Date.UTC(2026, 9, 1) }]]);
  var keptName = (name) => String(name).split(/[\\/]/).pop().replace(/[^A-Za-z0-9._-]+/g, "-") || "file";
  var previewMime = (name) => ({ mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4" })[(/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? "").toLowerCase()] ?? "application/octet-stream";
  function stubbed(text) {
    return kit.el("p", { class: "pg__stub" }, [text]);
  }
  function source(text, language = "javascript") {
    const code = kit.el("code", { class: "betterslack-hl" });
    code.innerHTML = highlight(text, language);
    return kit.el("pre", { class: "api-output pg__source" }, [code]);
  }
  var PEOPLE = [
    { id: "U0EXAMPLE1", name: "Robin Vasquez", title: "Release engineering", presence: "active" },
    { id: "U0EXAMPLE2", name: "Sam Okonkwo", title: "Design systems", presence: "away" },
    { id: "U0EXAMPLE3", name: "Nadia Prescott", title: "Support", presence: "active" }
  ];
  function modRow(mod) {
    const row = kit.el("div", { class: "betterslack-row" }, [
      kit.el("div", { class: "betterslack-row__text" }, [
        kit.el("div", { class: "betterslack-row__name" }, [mod.name]),
        kit.el("div", { class: "betterslack-row__desc" }, [mod.description])
      ])
    ]);
    const toggle = kit.el("input", { type: "checkbox", class: "pg__check" });
    toggle.checked = Boolean(mod.enabled);
    if (mod.onToggle) toggle.addEventListener("change", () => mod.onToggle(toggle.checked));
    row.append(mod.installed === false ? kit.button("Install", { variant: "primary" }) : toggle);
    return row;
  }
  var STATUS_EMOJI = {
    palm_tree: "mark.svg",
    glitch_crab: "mark.svg",
    tada: "mark.svg"
  };
  function statusFixture(v) {
    const EXPIRES_AT = Date.UTC(2026, 7, 30, 15, 0) / 1e3;
    const profile = {
      status_text: v.text ?? "",
      status_emoji: v.emoji ? `:${v.emoji}:` : "",
      status_expiration: v.expires ? EXPIRES_AT : 0
    };
    const custom = /* @__PURE__ */ new Map();
    if (v.known && STATUS_EMOJI[v.emoji]) custom.set(v.emoji, STATUS_EMOJI[v.emoji]);
    return [profile, custom];
  }
  var IMITATED = {
    /* -- Slack's own surface ------------------------------------------------ */
    "slack-web": {
      render: (v) => {
        const person = PEOPLE.find((p) => p.id === v.user) ?? PEOPLE[0];
        const answer = {
          ok: true,
          users: [{
            id: person.id,
            name: person.name.toLowerCase().replace(" ", "."),
            profile: { real_name: person.name, title: person.title, image_192: `https://ca.slack-edge.com/T0EXAMPLE1-${person.id}-\u2026-192` }
          }]
        };
        return [
          kit.el("div", { class: "pg__card" }, [
            kit.el("span", { class: "chrome__avatar", "data-seed": person.id }),
            kit.el("div", {}, [
              kit.el("div", { class: "chrome__who" }, [person.name]),
              kit.el("div", { class: "chrome__role" }, [person.title])
            ])
          ]),
          source(`await api.slack.web.users(['${person.id}'])

${JSON.stringify(answer, null, 2)}`, "json"),
          stubbed("The call and its shape are real; the workspace behind them is not.")
        ];
      }
    },
    "slack-desktop": {
      render: (v) => {
        const rows = SLACK_PREFS.map((pref2) => {
          const wanted = pref2.key === v.key ? pref2.type === "boolean" ? v.value : String(v.value) : null;
          return kit.el("tr", { class: pref2.key === v.key ? "is-current" : "" }, [
            kit.el("td", {}, [kit.el("code", {}, [pref2.key])]),
            kit.el("td", {}, [pref2.type]),
            kit.el("td", {}, [wanted === null ? "\u2014" : String(wanted)]),
            kit.el("td", {}, [kit.el("span", { class: "sm-hint" }, [
              pref2.restart ? "read when the window is created \u2014 needs a restart" : "applies at once"
            ])])
          ]);
        });
        const pref = SLACK_PREFS.find((p) => p.key === v.key) ?? SLACK_PREFS[0];
        return [
          source(`api.slack.desktop.keys()          // the ${SLACK_PREFS.length} below, and nothing else
api.slack.desktop.get(${JSON.stringify(pref.key)})
await api.slack.desktop.set(${JSON.stringify(pref.key)}, ${JSON.stringify(pref.type === "boolean" ? v.value : String(v.value))});
api.slack.desktop.needsRestart(${JSON.stringify(pref.key)})  // ${pref.restart}`),
          kit.el("div", { class: "pg__legend" }, ["key \xB7 type \xB7 what this preview would set \xB7 when it takes effect"]),
          kit.el("table", { class: "pg__table pg__prefs" }, rows),
          stubbed(pref.note)
        ];
      }
    },
    "slack-currentteamid": {
      render: () => {
        const slack = createSlackApi("demo");
        return [
          source(`location.pathname        ${location.pathname}
api.slack.currentTeamId()    ${slack.currentTeamId()}
api.slack.currentChannelId() ${slack.currentChannelId()}

// Null on this page: it is not a Slack client, so there is neither a
// /client/<team>/<channel> address nor a drawn avatar to read one from.`),
          stubbed("In Slack these answer about the workspace on screen, which at a cold start is not the one in the URL.")
        ];
      }
    },
    "slack-openstatuseditor": {
      render: (v, { stage }) => {
        const frame = slackChrome();
        const strip = frame.querySelector(".p-control_strip");
        const menu = kit.el("div", { class: "c-menu pg__fakemenu" }, [
          kit.el("ul", { class: "c-menu__items" }, [
            kit.el("li", { class: "c-menu_item__li" }, [
              kit.el("button", { class: "c-menu_item__button", "data-qa": "main-menu-custom-status-item" }, [
                kit.el("span", { class: "c-menu_item__label" }, ["Set a status"])
              ])
            ]),
            kit.el("li", { class: "c-menu_item__li" }, [
              kit.el("button", { class: "c-menu_item__button" }, [
                kit.el("span", { class: "c-menu_item__label" }, ["Pause notifications"])
              ])
            ])
          ])
        ]);
        strip.append(menu);
        stage.replaceChildren(frame, kit.el("pre", { class: "pg__out" }, [
          "await api.slack.openStatusEditor()",
          "",
          "The account menu is opened first, then the entry below is pressed.",
          "data-qa rather than the words beside it: the label is translated,",
          "the attribute is not."
        ]));
        focusChrome(frame, ".p-control_strip");
        return void 0;
      }
    },
    "slack-restart": {
      render: () => {
        const button = kit.button("Restart Slack", { variant: "primary" });
        const out = kit.el("pre", { class: "pg__out" }, [""]);
        button.addEventListener("click", async () => {
          const ok = await confirm({
            title: "Restart Slack?",
            body: "The translucent window is chosen when Slack starts, so this preference needs a restart to take effect.",
            action: "Restart"
          });
          out.textContent = ok ? "api.slack.restart({ windowVibrancy: true })\n\nThe loader stops Slack, writes the preferences, launches it again\nand rebuilds its CDP connection in place. Same terminal, same run." : "cancelled \u2014 nothing written";
        });
        return [button, out, stubbed("The dialog is the shipped one; nothing is restarted from a web page.")];
      }
    },
    "slack-vipusers": {
      render: (v) => {
        const ids = v.pref.split(",").map((id) => id.trim()).filter(Boolean);
        return [
          source(`users.prefs.get(name: 'vip_users')
  -> ${JSON.stringify(v.pref)}

api.slack.vipUsers()
  -> ${JSON.stringify(ids)}`),
          kit.el("div", { class: "pg__people" }, ids.map((id) => {
            const person = PEOPLE.find((p) => p.id === id);
            return kit.el("div", { class: "pg__card" }, [
              kit.el("span", { class: "chrome__avatar", "data-seed": id }),
              kit.el("div", {}, [
                kit.el("div", { class: "chrome__who" }, [person?.name ?? id]),
                kit.el("div", { class: "chrome__role" }, [person ? "VIP" : "not in this workspace"])
              ])
            ]);
          }))
        ];
      }
    },
    "slack-setvip": {
      render: (v, { stage }) => {
        const vips = new Set(v.vips.split(",").map((id) => id.trim()).filter(Boolean));
        const out = kit.el("pre", { class: "pg__out" }, [""]);
        const draw = () => {
          out.textContent = `users.prefs.set(name: 'vip_users', value: '${[...vips].join(",")}')`;
        };
        const list = kit.el("div", { class: "pg__people" }, PEOPLE.map((person) => {
          const star = kit.button(vips.has(person.id) ? "\u2605 VIP" : "\u2606 Add", { variant: vips.has(person.id) ? "primary" : "default" });
          star.addEventListener("click", () => {
            if (vips.has(person.id)) vips.delete(person.id);
            else vips.add(person.id);
            star.textContent = vips.has(person.id) ? "\u2605 VIP" : "\u2606 Add";
            star.className = `c-button c-button--medium c-button--${vips.has(person.id) ? "primary" : "outline"}`;
            draw();
          });
          return kit.el("div", { class: "pg__card" }, [
            kit.el("span", { class: "chrome__avatar", "data-seed": person.id }),
            kit.el("div", {}, [kit.el("div", { class: "chrome__who" }, [person.name])]),
            star
          ]);
        }));
        draw();
        return [list, out, stubbed("Read, edit, write \u2014 the whole list every time, which is why two windows can clobber each other.")];
      }
    },
    "slack-starthuddle": {
      render: (v, { stage }) => {
        const frame = slackChrome();
        const header = frame.querySelector(".p-view_header__actions");
        const start = helpers.iconButton({ icon: ICON, label: "Start a huddle", surface: "header", onClick: () => {
        } });
        start.setAttribute("data-qa", "huddle_channel_header_button__start_button");
        header.prepend(start);
        stage.replaceChildren(frame, kit.el("pre", { class: "pg__out" }, [
          "api.slack.startHuddle('U0EXAMPLE2')",
          "",
          "It clicks this button. The profile pane\u2019s huddle control is only a menu",
          "trigger; the channel header\u2019s is the one that starts anything, and a plain",
          "element.click() is enough. Slack opens a separate window for the call."
        ]));
        focusChrome(frame, '[data-qa="huddle_channel_header_button__start_button"]');
        return void 0;
      }
    },
    "slack-hideconversation": {
      render: (v, { stage }) => {
        const frame = slackChrome();
        const rows = [...frame.querySelectorAll(".p-channel_sidebar__channel")];
        const target = rows.find((row) => row.textContent?.includes(v.channel)) ?? rows[3];
        const button = kit.button(`Hide #${v.channel}`, { variant: "danger" });
        button.addEventListener("click", () => {
          target.classList.toggle("chrome__hidden");
          button.textContent = target.classList.contains("chrome__hidden") ? `Show #${v.channel}` : `Hide #${v.channel}`;
        });
        stage.replaceChildren(frame, button);
        focusChrome(frame, ".p-channel_sidebar");
        return void 0;
      }
    },
    "slack-openconversation": {
      render: (v, { stage }) => {
        const frame = slackChrome();
        const link = kit.el("pre", { class: "pg__out" }, [`slack://channel?team=T0EXAMPLE1&id=${v.channel}`]);
        const rows = [...frame.querySelectorAll(".p-channel_sidebar__channel")];
        const go = kit.button("Open it", { variant: "primary" });
        go.addEventListener("click", () => {
          for (const row of rows) row.classList.remove("is-selected");
          (rows.find((row) => row.textContent?.includes(v.name)) ?? rows[0]).classList.add("is-selected");
          frame.querySelector(".chrome__title").firstChild.nextSibling.textContent = v.name;
        });
        stage.replaceChildren(frame, go, link, stubbed(
          "Assigning that URL hands it to the desktop app\u2019s protocol handler, which routes it in place \u2014 same document, no reload."
        ));
        focusChrome(frame, ".p-channel_sidebar");
        return void 0;
      }
    },
    "slack-openmessage": {
      render: (v, { stage }) => {
        const frame = slackChrome();
        const message = frame.querySelector('[data-qa="message_container"]');
        const go = kit.button("Open the message", { variant: "primary" });
        go.addEventListener("click", () => {
          message.classList.remove("chrome__flash");
          void message.offsetWidth;
          message.classList.add("chrome__flash");
        });
        stage.replaceChildren(frame, go, kit.el("pre", { class: "pg__out" }, [
          `slack://channel?team=T0EXAMPLE1&id=${v.channel}&message=${v.ts}`
        ]), stubbed(
          "In the client, the desktop app routes that URL in place and highlights the message it lands on."
        ));
        focusChrome(frame, ".p-message_pane");
        return void 0;
      }
    },
    "slack-opendirectmessage": {
      render: (v, { stage }) => {
        const frame = slackChrome();
        const list = frame.querySelector(".p-channel_sidebar__list");
        const row = el("div", "p-channel_sidebar__channel");
        row.innerHTML = '<span class="chrome__avatar" data-seed="U0EXAMPLE2" style="width:18px;height:18px;border-radius:5px;margin-right:6px"></span><span class="chrome__name">Sam Okonkwo</span>';
        list.append(row);
        const go = kit.button("Open the DM", { variant: "primary" });
        go.addEventListener("click", () => {
          for (const other of list.children) other.classList.remove("is-selected");
          row.classList.add("is-selected");
        });
        stage.replaceChildren(frame, go, kit.el("pre", { class: "pg__out" }, [
          `api.slack.openDirectMessage('${v.user}')`,
          "",
          "conversations.open gives the DM channel id, then the deep link opens it."
        ]));
        focusChrome(frame, ".p-channel_sidebar");
        return void 0;
      }
    },
    "slack-openuserprofile": {
      render: (v, { stage }) => {
        const frame = slackChrome({ pane: true });
        stage.replaceChildren(frame, kit.el("pre", { class: "pg__out" }, [
          `slack://user?team=T0EXAMPLE1&id=${v.user}`,
          "",
          "Not everyone has one: an app, or a conversation with yourself, gives a",
          "pane that never appears. Try ids in turn rather than trusting the first."
        ]));
        focusChrome(frame, '[data-qa="member_profile_pane"]');
        return void 0;
      }
    },
    "slack-filesfrom": {
      render: (v) => {
        const person = PEOPLE.find((p) => p.id === v.user) ?? PEOPLE[0];
        const all = [
          { name: "release-notes-1.4.pdf", size: "284 KB", type: "pdf", ts: "2 days ago" },
          { name: "sidebar-before-after.png", size: "1.1 MB", type: "png", ts: "5 days ago" },
          { name: "rollout-plan.md", size: "4 KB", type: "md", ts: "last week" },
          { name: "timings.csv", size: "18 KB", type: "csv", ts: "last week" }
        ];
        const files = all.slice(0, Math.max(1, Math.min(Number(v.limit) || all.length, all.length)));
        return [
          kit.el("div", { class: "pg__card" }, [
            kit.el("span", { class: "chrome__avatar", "data-seed": person.id }),
            kit.el("div", {}, [
              kit.el("div", { class: "chrome__who" }, [person.name]),
              kit.el("div", { class: "chrome__role" }, [`${files.length} of ${all.length} files, newest first`])
            ])
          ]),
          kit.el("div", { class: "pg__files" }, files.map((file) => kit.el("div", { class: "pg__file" }, [
            kit.el("span", { class: "pg__file__kind" }, [file.type.toUpperCase()]),
            kit.el("div", {}, [
              kit.el("div", { class: "chrome__who" }, [file.name]),
              kit.el("div", { class: "chrome__role" }, [`${file.size} \xB7 ${file.ts}`])
            ])
          ]))),
          source(`await api.slack.filesFrom('${person.id}'${v.limit ? `, ${v.limit}` : ""})

` + JSON.stringify(files.map((f) => ({
            name: f.name,
            url_private: `https://files.slack.com/\u2026/${f.name}`
          })), null, 2), "json"),
          stubbed("Without a limit you get Slack\u2019s own default page, which is rarely what a panel wants to draw.")
        ];
      }
    },
    /* -- somebody's status --------------------------------------------------- */
    /*
     * Both entries draw from the same three sources the runtime does, and the
     * `known` knob is what makes the third one visible: turn it off and the
     * workspace no longer has that emoji, so `describeStatus` reports
     * `imageUrl: null` and `statusNode` draws the sentence alone rather than a
     * shortcode.
     */
    "slack-describestatus": {
      render: (v) => {
        const [profile, custom] = statusFixture(v);
        const status = createSlackApi("demo").describeStatus(profile, custom);
        return [
          source(`const custom = await api.slack.web.emoji();
api.slack.describeStatus(user, custom)

` + JSON.stringify(status, null, 2), "json"),
          stubbed(status?.imageUrl ? "Resolved from the workspace\u2019s own emoji." : "Nothing knows that name, so there is no image \u2014 the sentence still draws.")
        ];
      }
    },
    "slack-emojiurl": {
      render: (v) => {
        const custom = /* @__PURE__ */ new Map();
        if (v.known && STATUS_EMOJI[v.name]) custom.set(v.name, STATUS_EMOJI[v.name]);
        const url = createSlackApi("demo").emojiUrl(v.name, custom);
        const line = kit.el("div", { class: "pg__card" }, [
          url ? kit.el("img", { src: url, alt: `:${v.name}:`, style: "width:20px;height:20px" }) : kit.el("span", { class: "sm-hint" }, ["(nothing draws it)"]),
          kit.el("code", {}, [`:${v.name}:`])
        ]);
        return [
          line,
          source(`api.slack.emojiUrl('${v.name}', custom)

${JSON.stringify(url)}`, "javascript"),
          stubbed(url ? "Resolved from the workspace\u2019s own emoji." : "Neither the workspace nor the page knows that name, so there is no image \u2014 and the raw shortcode is never printed in its place.")
        ];
      }
    },
    "slack-statusnode": {
      render: (v, { stage }) => {
        const [profile, custom] = statusFixture(v);
        const slack = createSlackApi("demo");
        const status = slack.describeStatus(profile, custom);
        if (!status) return kit.el("span", { class: "sm-hint" }, ["no status set \u2014 nothing to draw"]);
        const row = kit.el("div", { class: "pg__card" }, [
          kit.el("span", { class: "chrome__avatar", "data-seed": "U0EXAMPLE1" }),
          kit.el("div", {}, [
            kit.el("div", { class: "chrome__who" }, ["Robin Vasquez"]),
            slack.statusNode(status, profile, { showText: v.showText !== false })
          ])
        ]);
        return [
          row,
          stubbed("The node, its stylesheet and its rules are the shipped ones. Hover it.")
        ];
      }
    },
    /* -- the loader's side -------------------------------------------------- */
    "files-save": {
      render: (v, { stage }) => {
        const out = kit.el("div", { class: "pg__downloads" }, []);
        const button = kit.button("Save it", { variant: "primary" });
        button.addEventListener("click", () => {
          out.replaceChildren(kit.el("div", { class: "pg__file" }, [
            kit.el("span", { class: "pg__file__kind" }, ["JPG"]),
            kit.el("div", {}, [
              kit.el("div", { class: "chrome__who" }, [v.filename]),
              kit.el("div", { class: "chrome__role" }, [`~/Downloads/${v.filename} \u2014 48 320 bytes`])
            ])
          ]));
          toast(`Saved ${v.filename}`, { variant: "success" });
        });
        return [
          source(`const { path, bytes } = await api.files.save(
  '${v.url}',
  '${v.filename}',
);`),
          button,
          out,
          stubbed("The loader fetches it, because Slack\u2019s CDN serves without CORS headers and the renderer cannot.")
        ];
      }
    },
    "net-request": {
      render: (v) => {
        const record = {
          id: "hours",
          type: "plugin",
          settings: [{ key: "apiUrl", type: "text", label: "Server address" }],
          network: { settings: ["apiUrl"] }
        };
        const server = async () => new Response(
          JSON.stringify({ week: "2026-w-40", paid: "29:42" }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
        const out = kit.el("pre", { class: "pg__out" }, [""]);
        const send = kit.button("Send it", { variant: "primary" });
        send.addEventListener("click", async () => {
          const answer = await netRequest(record, true, { apiUrl: v.base }, {
            url: v.url,
            method: "POST",
            form: { username: "robin", token: "\u2026" }
          }, server);
          out.textContent = JSON.stringify(answer, null, 2);
        });
        return [
          source(`// "network": { "settings": ["apiUrl"] }, apiUrl = '${v.base}'
const answer = await api.net.request('${v.url}', {
  method: 'POST',
  form: { username, token },
});`),
          send,
          out,
          stubbed("The rule that allows or refuses the address is the loader\u2019s own. The server answering is imitated.")
        ];
      }
    },
    "files-screenshot": {
      render: (v, { stage }) => {
        const frame = slackChrome();
        const flash = el("div", "pg__flash");
        const shot = kit.button("Take the shot", { variant: "primary" });
        const out = kit.el("pre", { class: "pg__out" }, [""]);
        shot.addEventListener("click", () => {
          flash.classList.remove("is-firing");
          void flash.offsetWidth;
          flash.classList.add("is-firing");
          out.textContent = `api.files.screenshot({ size: '${v.size}', filename: '${v.filename}' })

~/Downloads/${v.filename} \u2014 ${v.size}, webp`;
        });
        const wrap = el("div", "pg__shotframe", [frame, flash]);
        stage.replaceChildren(wrap, shot, out);
        return void 0;
      }
    },
    /*
     * api.data, against a folder that lives in this page. The calls are the
     * real shapes; the disk is a Map, which is what the stub note says.
     */
    "data-write": {
      render: (v) => {
        const out = kit.el("pre", { class: "pg__out" }, [""]);
        const button = kit.button("Keep it", { variant: "primary" });
        button.addEventListener("click", () => {
          const name = keptName(v.name);
          KEPT.set(name, { bytes: Number(v.bytes) || 0, modified: Date.now() });
          out.textContent = JSON.stringify({ name, bytes: Number(v.bytes) || 0, modified: Date.now() }, null, 2) + `

~/.betterslack/data/custom-sounds/${name}`;
        });
        return [
          source(`await api.data.write('${v.name}', file);`),
          button,
          out,
          stubbed("The folder is a Map in this page; in Slack it is the loader writing to disk.")
        ];
      }
    },
    "data-read": {
      render: (v) => {
        const kept = KEPT.get(keptName(v.name));
        return [
          source(`const blob = await api.data.read('${v.name}');`),
          kit.el("pre", { class: "pg__out" }, [kept ? `Blob { size: ${kept.bytes}, type: '${previewMime(v.name)}' }` : "null  // nothing kept by that name"]),
          stubbed("Keep a file on the write page first, and it is here.")
        ];
      }
    },
    "data-list": {
      render: () => [
        source("await api.data.list();"),
        kit.el("pre", { class: "pg__out" }, [JSON.stringify(
          [...KEPT].map(([name, entry]) => ({ name, bytes: entry.bytes, modified: entry.modified })),
          null,
          2
        )]),
        stubbed("Only this mod\u2019s folder, never another\u2019s.")
      ]
    },
    "data-remove": {
      render: (v) => {
        const out = kit.el("pre", { class: "pg__out" }, [""]);
        const button = kit.button("Delete it", { variant: "danger" });
        button.addEventListener("click", () => {
          out.textContent = String(KEPT.delete(keptName(v.name)));
        });
        return [
          source(`await api.data.remove('${v.name}');`),
          button,
          out,
          stubbed("True the first time, false after: there is nothing left to delete.")
        ];
      }
    },
    "assets-list": {
      render: () => [
        kit.el("ul", { class: "pg__tree" }, FIXTURES.plugin.files.map(
          (name) => kit.el("li", {}, [kit.el("code", {}, [name])])
        )),
        kit.el("p", { class: "sm-hint" }, [`mods/plugins/${FIXTURES.plugin.id}/, read by the loader \u2014 this repository\u2019s own folder.`])
      ]
    },
    "assets-text": {
      render: (v) => [
        kit.el("p", { class: "sm-hint" }, [`api.assets.text(${JSON.stringify(v.file)})`]),
        source(
          v.file.endsWith(".json") ? JSON.stringify(FIXTURES.plugin.manifest, null, 2) : FIXTURES.plugin.entry,
          v.file.endsWith(".json") ? "json" : "javascript"
        )
      ]
    },
    "themes-source": {
      render: () => [
        kit.el("p", { class: "sm-hint" }, [`await api.themes.source('${FIXTURES.theme.id}') \u2014 the first lines of it`]),
        source(FIXTURES.theme.css, "css")
      ]
    },
    "themes-suspend": {
      render: (v, { stage }) => {
        const frame = slackChrome();
        const button = kit.button("Suspend the themes", { variant: "primary" });
        let off = false;
        button.addEventListener("click", () => {
          off = !off;
          frame.dataset.theme = off ? "none" : "";
          frame.classList.toggle("chrome--bare", off);
          button.textContent = off ? "Restore them" : "Suspend the themes";
        });
        stage.replaceChildren(frame, button, kit.el("p", { class: "sm-hint" }, [
          "The whole theme layer detaches, and the user\u2019s settings are untouched. The theme builder holds it back like this so the preview shows what it is painting rather than what was already on."
        ]));
        return void 0;
      }
    },
    "plugin-savetheme": {
      render: (v, { stage }) => {
        const editor = kit.code({ value: v.css });
        const save = kit.button("Save the theme", { variant: "primary" });
        const out = kit.el("pre", { class: "pg__out" }, [""]);
        save.addEventListener("click", () => {
          out.textContent = `~/.betterslack/mods/themes/${v.id}/theme.css
${editor.value.length} bytes \u2014 it shows up in the panel as an installed theme`;
          toast(`Saved \u201C${v.id}\u201D`, { variant: "success" });
        });
        stage.replaceChildren(editor.node, save, out);
        return void 0;
      }
    },
    /* -- BetterSlack itself -------------------------------------------------- */
    "app-commands": {
      render: () => {
        const rows = [
          { id: "motion:toggle", title: "Turn Motion off", source: "Motion", shortcut: "" },
          { id: "theme-builder:open", title: "Open the theme builder", source: "Theme Builder", shortcut: "" },
          { id: "demo-mode:toggle", title: "Turn demo mode on", source: "Demo Mode", shortcut: "" }
        ];
        return kit.el("table", { class: "pg__table" }, rows.map((row) => kit.el("tr", {}, [
          kit.el("td", {}, [kit.el("code", {}, [row.id])]),
          kit.el("td", {}, [row.title]),
          kit.el("td", {}, [kit.el("span", { class: "sm-hint" }, [row.source])]),
          kit.el("td", {}, [kit.el("span", { class: "sm-hint" }, [row.shortcut])])
        ])));
      }
    },
    "app-openpanel": {
      render: () => {
        const button = kit.button("Open the panel", { variant: "primary" });
        button.addEventListener("click", () => modal({
          title: "BetterSlack",
          body: "The panel is the Mods dialog, on \u2318\u21E7M. api.app.openPanel() is what a command or a button calls to bring it up.",
          actions: [{ label: "Close", primary: true }]
        }));
        return button;
      }
    },
    "app-openmod": {
      render: (v) => {
        const button = kit.button(`Open ${v.id}`, { variant: "primary" });
        button.addEventListener("click", () => modal({
          title: v.id,
          body: "A mod\u2019s page: its icon, version and author, its description in your language, a screenshot, its README and its settings. Not the row\u2019s settings drawer.",
          actions: [{ label: "Close", primary: true }]
        }));
        return button;
      }
    },
    "app-setenabled": {
      render: (v, { stage }) => {
        const out = kit.el("pre", { class: "pg__out" }, [""]);
        const row = modRow({
          name: "Motion",
          description: "Slack with the frames in between.",
          enabled: v.enabled,
          onToggle: (on) => {
            out.textContent = `api.app.setEnabled('motion', ${on})`;
          }
        });
        return [row, out, kit.el("p", { class: "sm-hint" }, [
          "A plugin is code that keeps running after the theme that wanted it is off, so nothing switches one on without asking."
        ])];
      }
    },
    "app-setinstalled": {
      render: (v, { stage }) => {
        const out = kit.el("pre", { class: "pg__out" }, [""]);
        const shelf = kit.el("div", { class: "pg__shelf" }, [
          modRow({ name: "Aurora", description: "Frosted glass over a drifting gradient.", installed: false }),
          modRow({ name: "Terminal", description: "Monospace, square corners, phosphor.", installed: false })
        ]);
        for (const button of shelf.querySelectorAll("button")) {
          button.addEventListener("click", () => {
            const name = button.closest(".betterslack-row").querySelector(".betterslack-row__name").textContent;
            out.textContent = `api.app.setInstalled('${name.toLowerCase()}', true)

The folder is fetched through the loader, which re-validates the manifest:
files off the network are untrusted whichever button asked for them.`;
            button.textContent = "Installed";
            button.disabled = true;
          });
        }
        return [shelf, out];
      }
    },
    /* -- the api object itself ----------------------------------------------- */
    "plugin-id": {
      render: () => [
        source(`api.id            // '${FIXTURES.plugin.id}'
api.settings.get() // scoped to it
api.css(\u2026)         // one stylesheet, keyed on it`),
        kit.el("p", { class: "sm-hint" }, ["The folder name, which is also the key everything else is filed under."])
      ]
    },
    "plugin-version": {
      render: () => [
        source(`api.version            // '2.0.1'  \u2014 BetterSlack's
api.manifest.version   // '${FIXTURES.plugin.manifest.version ?? "1.0.0"}'  \u2014 this mod's

// The two move independently: a mod carries its own version and updates
// on its own, so a one-line fix to a theme does not mean pulling the
// loader and the runtime with it.`),
        stubbed("The BetterSlack version is whatever the client is running; the mod version is this repository\u2019s.")
      ]
    },
    "plugin-manifest": {
      render: () => source(JSON.stringify(FIXTURES.plugin.manifest, null, 2), "json")
    },
    "plugin-ondispose": {
      render: (v, { stage, keep }) => {
        const out = kit.el("pre", { class: "pg__out" }, ["running \u2014 leave this entry and come back"]);
        const timer = setInterval(() => {
          out.textContent = `tick ${Number((out.textContent.match(/\d+/) ?? [0])[0]) + 1} \u2014 still running`;
        }, 1e3);
        keep(() => clearInterval(timer));
        return [out, kit.el("p", { class: "sm-hint" }, [
          "This preview registers its cleanup exactly as a mod does, and the page runs it when you navigate away \u2014 which is what onDispose is for."
        ])];
      }
    },
    "ui-kitcss": {
      render: () => [
        kit.el("div", { class: "pg__kitrow" }, [
          kit.button("Primary", { variant: "primary" }),
          kit.button("Default"),
          kit.input({ value: "A field" }),
          kit.swatch("#7cc4ff", { size: "md" })
        ]),
        kit.el("p", { class: "sm-hint" }, [
          `api.ui.kitCss \u2014 ${Math.round(KIT_CSS.length / 1024)} kB of stylesheet, and what the row above is wearing. A window a mod opens is a blank document: none of Slack\u2019s stylesheet reaches it, so the kit brings its own.`
        ]),
        source(`const win = window.open('', 'my-window');
win.document.head.append(
  Object.assign(win.document.createElement('style'), { textContent: api.ui.kitCss }),
);
const kit = api.ui.kit(win.document);`)
      ]
    }
  };
  var TOOLS = {
    "i18n-strings": {
      render: (v) => {
        const out = kit.el("p", { class: "api-result" }, [""]);
        const TABLES = {
          en: { hello: "Hi {name}, {count} unread", bye: "See you" },
          fr: { hello: "Salut {name}, {count} non lus" }
        };
        const t = createI18n(v.locale).strings(TABLES);
        out.textContent = t(v.key, { name: v.name, count: 3 });
        return out;
      }
    },
    "tools-markdown": {
      /*
       * The rendered README and nothing else. A textarea of its own beside the
       * output would be a second place to type after the controls below already
       * are one, and the two would never agree about which held the source.
       */
      render: (v) => {
        const out = kit.el("div", { class: "api-output sm-md" });
        out.innerHTML = renderMarkdown(v.source ?? "");
        return out;
      }
    },
    "tools-highlight": {
      render: (v) => {
        const forced = v.language && v.language !== "auto" ? v.language : "";
        const chosen = forced || detect(v.source ?? "");
        const code = kit.el("code", { class: "betterslack-hl" });
        code.innerHTML = chosen ? highlight(v.source ?? "", chosen) : (v.source ?? "").replace(/[<&]/g, (c) => c === "<" ? "&lt;" : "&amp;");
        return [
          kit.el("p", { class: "sm-hint" }, [
            forced ? `forced to ${chosen}` : chosen ? `detected: ${chosen}` : "not confident \u2014 left alone, which is the point"
          ]),
          kit.el("pre", { class: "api-output" }, [code])
        ];
      }
    },
    "tools-roles": {
      render: (v) => {
        const palette = derivePalette(parseColour(v.background), parseColour(v.accent));
        const ratio = contrast(palette.text, palette.bg);
        const verdict = readability(ratio);
        return [
          kit.el("div", { class: "api-roles" }, ROLES.map((role) => kit.el("div", { class: "role" }, [
            kit.swatch(formatCss(palette[role.key]), { size: "md" }),
            kit.el("div", { class: "role__text" }, [
              kit.el("strong", {}, [role.key + (role.seed ? " (seed)" : "")]),
              kit.el("span", { class: "sm-hint" }, [formatCss(palette[role.key])])
            ])
          ]))),
          kit.el("p", { class: `sm-hint${verdict.ok ? "" : " is-bad"}` }, [
            `contrast(text, bg) = ${ratio.toFixed(2)} \u2014 ${verdict.grade}`
          ])
        ];
      }
    }
  };
  installStyles();
  function wireThemePicker() {
    const picker = document.getElementById("stage-theme");
    if (!picker) return;
    const saved = localStorage.getItem("betterslack-api-theme");
    if (saved && [...picker.options].some((o) => o.value === saved)) picker.value = saved;
    const apply = () => {
      for (const stage of document.querySelectorAll(".slack-stage")) stage.dataset.theme = picker.value;
      document.body.dataset.theme = picker.value;
      localStorage.setItem("betterslack-api-theme", picker.value);
    };
    picker.addEventListener("change", apply);
    apply();
  }
  function router() {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    const stack = document.querySelector(".stack");
    const links = [...document.querySelectorAll(".side__list a")];
    if (!stack || !links.length) return;
    const show = (slug) => {
      const wanted = document.getElementById(`p-${slug}`) ?? stack.querySelector(".panel");
      for (const panel of stack.querySelectorAll(".panel")) {
        if (panel === wanted) continue;
        MOUNTED.get(panel.id)?.teardown();
        panel.hidden = true;
      }
      const shown = MOUNTED.get(wanted.id);
      if (shown && !shown.drawn) shown.draw();
      wanted.hidden = false;
      for (const link of links) {
        const current = link.getAttribute("href") === `#${wanted.id.slice(2)}`;
        link.toggleAttribute("aria-current", current);
        if (current) {
          link.scrollIntoView({ block: "nearest" });
          DRAWER.label(link);
        }
      }
      stack.scrollTop = 0;
      requestAnimationFrame(() => {
        stack.scrollTop = 0;
        document.documentElement.scrollTop = 0;
      });
    };
    const fromHash = () => {
      show(location.hash.slice(1) || stack.dataset.first);
      DRAWER.close();
    };
    window.addEventListener("hashchange", fromHash);
    fromHash();
  }
  function drawer() {
    const open = document.getElementById("side-open");
    const scrim = document.getElementById("side-scrim");
    if (!open || !scrim) return { label: () => {
    }, close: () => {
    } };
    const set = (on) => {
      document.body.classList.toggle("is-drawer-open", on);
      open.setAttribute("aria-expanded", String(on));
      scrim.hidden = !on;
      if (on) document.getElementById("side-filter")?.focus();
    };
    open.addEventListener("click", () => set(!document.body.classList.contains("is-drawer-open")));
    scrim.addEventListener("click", () => set(false));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && document.body.classList.contains("is-drawer-open")) set(false);
    });
    return {
      close: () => set(false),
      /** What the button says while the drawer is shut: where you are. */
      label: (link) => {
        const node = document.getElementById("side-open-label");
        if (!node || !link) return;
        const group = link.closest(".side__group")?.querySelector(".side__title")?.textContent ?? "";
        node.textContent = group ? `${group} \xB7 ${link.textContent}` : link.textContent;
      }
    };
  }
  var DRAWER = drawer();
  function order() {
    const picker = document.getElementById("side-order");
    if (!picker) return;
    const dates = typeof window !== "undefined" && window.__API_UPDATED || {};
    const apply = () => {
      const byDate = picker.value === "updated";
      for (const group of document.querySelectorAll(".side__group")) {
        const list = group.querySelector("ul");
        if (!list) continue;
        const items = [...list.children];
        items.sort((a, b) => {
          const linkA = a.querySelector("a");
          const linkB = b.querySelector("a");
          if (!linkA || !linkB) return 0;
          if (!byDate) {
            return Number(a.dataset.at ?? 0) - Number(b.dataset.at ?? 0);
          }
          const slugA = linkA.getAttribute("href")?.slice(1) ?? "";
          const slugB = linkB.getAttribute("href")?.slice(1) ?? "";
          const dateA = dates[slugA] || "9999-99-99";
          const dateB = dates[slugB] || "9999-99-99";
          if (dateA === dateB) return Number(a.dataset.at ?? 0) - Number(b.dataset.at ?? 0);
          return dateA < dateB ? 1 : -1;
        });
        list.append(...items);
      }
      localStorage.setItem("betterslack-api-order", picker.value);
    };
    for (const group of document.querySelectorAll(".side__group")) {
      [...group.querySelector("ul")?.children ?? []].forEach((li, at) => {
        li.dataset.at = String(at);
      });
    }
    const saved = localStorage.getItem("betterslack-api-order");
    if (saved && [...picker.options].some((o) => o.value === saved)) picker.value = saved;
    picker.addEventListener("change", apply);
    apply();
  }
  function filter() {
    const box = document.getElementById("side-filter");
    if (!box) return;
    box.addEventListener("input", () => {
      const needle = box.value.trim().toLowerCase();
      for (const group of document.querySelectorAll(".side__group")) {
        let shown = 0;
        for (const item of group.querySelectorAll("li")) {
          const hit = !needle || (item.textContent ?? "").toLowerCase().includes(needle);
          item.hidden = !hit;
          if (hit) shown += 1;
        }
        group.hidden = shown === 0;
      }
    });
  }
  toasted = (message) => {
    const note = $("helpers-toast");
    if (note) note.textContent = `api.ui.toast(${JSON.stringify(message)})`;
  };
  var PREVIEWS = {};
  for (const [name, spec2] of Object.entries(KIT)) PREVIEWS[`kit-${name.toLowerCase()}`] = spec2.render;
  for (const [name, spec2] of Object.entries(HELPERS)) PREVIEWS[`helpers-${name.toLowerCase()}`] = spec2.render;
  for (const group of [UI, CHROME, SLACK_HELPERS, MORE, TOOLS, REST, IMITATED]) {
    for (const [slug, spec2] of Object.entries(group)) PREVIEWS[slug] = spec2.render;
  }
  for (const slot of document.querySelectorAll("[data-demo]")) {
    const render = PREVIEWS[slot.dataset.demo];
    if (render) playground(slot.dataset.demo, render);
    else slot.remove();
  }
  for (const { teardown } of MOUNTED.values()) teardown();
  function stampDates() {
    const dates = typeof window !== "undefined" && window.__API_UPDATED || {};
    const fr = document.documentElement.lang === "fr";
    for (const panel of document.querySelectorAll(".panel")) {
      const when = dates[panel.id.replace(/^p-/, "")];
      if (!when) continue;
      const foot = document.createElement("p");
      foot.className = "panel__updated";
      foot.dataset.en = `Last updated ${when}`;
      foot.dataset.fr = `Mis \xE0 jour le ${when}`;
      foot.textContent = fr ? foot.dataset.fr : foot.dataset.en;
      (panel.querySelector(".panel__body") ?? panel).append(foot);
    }
  }
  stampDates();
  wireThemePicker();
  order();
  router();
  filter();
  for (const block of document.querySelectorAll(".api-code")) {
    const code = block.querySelector("code");
    const language = block.dataset.lang ?? "javascript";
    if (code && language in LANGUAGES) {
      code.innerHTML = highlight(code.textContent ?? "", language);
    }
    block.append(copyButton(() => code?.textContent ?? ""));
  }
})();
