/* Inspector injected into every rendered page (runs inside the sandboxed
   iframe, not this module).

   AUTHORING NOTE — this is a REAL function, not a string. It is serialized
   to source text with Function.prototype.toString() at the bottom of the
   file and injected into the iframe as inline <script> text. Writing it as
   real code (rather than the old template-literal string) means editors,
   eslint and prettier all apply, and regex escapes like /\s+/ survive — the
   previous string version silently turned every \s into a literal s, which
   broke selector generation for any class containing the letter "s".

   Because the function is stringified and re-run in a fresh global with NO
   access to this module, it must be fully self-contained: no imports, no
   closure over anything outside itself. There is no build step, so
   toString() returns the source verbatim — do not add a minifier without
   revisiting how this is injected. */
function inspectorMain() {
  var pins = [];
  var hoverEl = null;
  var st = document.createElement("style");
  st.textContent =
    ".__rl-hover{outline:2px dashed #C43B2A !important;outline-offset:2px;cursor:crosshair !important}" +
    ".__rl-flash{outline:3px solid #C43B2A !important;outline-offset:2px}" +
    '.__rl-pin{position:absolute;z-index:2147483647;width:20px;height:20px;border-radius:50%;background:#C43B2A;color:#fff;font:600 11px/20px "IBM Plex Mono",monospace;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.3);pointer-events:none}' +
    ".__rl-pin.done{background:#2E7D4F}" +
    ".__rl-pin.closed{background:#77726A}";
  (document.head || document.documentElement).appendChild(st);

  function normText(t) {
    return (t || "").replace(/\s+/g, " ").trim().slice(0, 300);
  }

  /* Prefer tag+classes over bare position: a selector scoped only by
     nth-of-type drifts onto the wrong element whenever an unrelated
     sibling of the same tag is inserted or removed elsewhere on the
     page (e.g. a newly added button shifting every button after it).
     Classes make the match immune to that; ':nth-child(n of S)' is only
     needed as a last resort when several siblings share the same
     tag+classes, and even then it's scoped to just that matching set.
     classList (not className.split) is used so SVG elements — whose
     className is not a string — are handled too. */
  function cssPath(el) {
    if (!el || el.nodeType !== 1) return "";
    var path = [];
    while (el && el.nodeType === 1 && el.tagName.toLowerCase() !== "html") {
      var tag = el.tagName.toLowerCase();
      if (el.id) {
        path.unshift(tag + "#" + CSS.escape(el.id));
        break;
      }
      var classes = el.classList ? Array.prototype.slice.call(el.classList) : [];
      var base =
        tag +
        classes
          .map(function (c) {
            return "." + CSS.escape(c);
          })
          .join("");
      var parent = el.parentElement;
      var sibs = parent
        ? Array.prototype.filter.call(parent.children, function (s) {
            return s.matches(base);
          })
        : [el];
      path.unshift(
        sibs.length <= 1
          ? base
          : base + ":nth-child(" + (sibs.indexOf(el) + 1) + " of " + base + ")",
      );
      el = parent;
    }
    return path.join(" > ");
  }

  /* An element is identified by several signals, not the CSS path alone:
     the path is precise but brittle to markup changes, while tag + trimmed
     text survive class renames, added wrapper elements, and the like. A
     recorded element is resolved by:
       1) the stored selector, if it still resolves AND the tag/text agree
          (fast path, and what happens when the page is unchanged);
       2) otherwise, the unique same-tag element whose text matches;
       3) if several share that text, the one whose ancestor chain best
          matches the stored selector (structural proximity as tiebreak).
     This also transparently repairs requests filed while a past bug wrote
     corrupt selectors: step 1 fails, step 2/3 find the element by text. */
  function signalsMatch(el, p) {
    if (p.tag && el.tagName.toLowerCase() !== p.tag) return false;
    if (
      p.elementText &&
      normText(el.innerText || el.textContent) !== normText(p.elementText)
    )
      return false;
    return true;
  }
  function selectorScore(el, selector) {
    var segs = selector.split(" > ");
    var score = 0,
      node = el,
      i = segs.length - 1;
    while (node && node.nodeType === 1 && i >= 0) {
      try {
        if (node.matches(segs[i])) score++;
      } catch (e) {
        /* a segment recorded under a since-removed selector feature */
      }
      node = node.parentElement;
      i--;
    }
    return score;
  }
  function resolveElement(p) {
    var el = null;
    try {
      el = document.querySelector(p.selector);
    } catch (e) {
      /* corrupt/unsupported selector — fall through to the text search */
    }
    if (el && signalsMatch(el, p)) return el;

    var wantText = p.elementText ? normText(p.elementText) : "";
    if (p.tag && wantText) {
      var nodes = document.getElementsByTagName(p.tag);
      var matches = [];
      for (var i = 0; i < nodes.length; i++) {
        if (normText(nodes[i].innerText || nodes[i].textContent) === wantText)
          matches.push(nodes[i]);
      }
      if (matches.length === 1) return matches[0];
      if (matches.length > 1) {
        var best = matches[0],
          bestScore = -1;
        for (var j = 0; j < matches.length; j++) {
          var s = selectorScore(matches[j], p.selector || "");
          if (s > bestScore) {
            bestScore = s;
            best = matches[j];
          }
        }
        return best;
      }
    }
    return null;
  }

  document.addEventListener(
    "mouseover",
    function (e) {
      if (hoverEl) hoverEl.classList.remove("__rl-hover");
      hoverEl = e.target;
      if (hoverEl && hoverEl.classList) hoverEl.classList.add("__rl-hover");
    },
    true,
  );

  /* Left click: let the page work (tabs, buttons, carousels) but never
     navigate away — links are neutered, in-page anchors scroll manually
     (the injected <base> would otherwise turn them into real navigations). */
  document.addEventListener(
    "click",
    function (e) {
      var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      var h = a.getAttribute("href") || "";
      if (h.charAt(0) === "#" && h.length > 1) {
        try {
          var t = document.getElementById(h.slice(1));
          if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
        } catch (err) {}
      }
    },
    true,
  );
  document.addEventListener(
    "submit",
    function (e) {
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );

  /* Right click: select the element for a change request */
  document.addEventListener(
    "contextmenu",
    function (e) {
      e.preventDefault();
      e.stopPropagation();
      var el = e.target;
      if (!el || el.nodeType !== 1) return;
      parent.postMessage(
        {
          type: "rl-pick",
          selector: cssPath(el),
          tag: el.tagName.toLowerCase(),
          text: (el.innerText || el.textContent || "").trim().slice(0, 300),
        },
        "*",
      );
    },
    true,
  );

  function placePins() {
    var existing = document.querySelectorAll(".__rl-pin");
    for (var i = 0; i < existing.length; i++) existing[i].remove();
    pins.forEach(function (p) {
      try {
        var el = resolveElement(p);
        if (!el) return;
        var r = el.getBoundingClientRect();
        var b = document.createElement("span");
        b.className =
          "__rl-pin" +
          (p.status === "done"
            ? " done"
            : p.status === "closed"
              ? " closed"
              : "");
        b.textContent = p.num;
        b.style.top = Math.max(0, r.top + window.scrollY - 9) + "px";
        b.style.left = Math.max(0, r.left + window.scrollX - 9) + "px";
        document.body.appendChild(b);
      } catch (err) {}
    });
  }
  var raf = null;
  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(function () {
      raf = null;
      placePins();
    });
  }
  window.addEventListener("scroll", schedule, true);
  window.addEventListener("resize", schedule);

  window.addEventListener("message", function (e) {
    var d = e.data || {};
    if (d.type === "rl-pins") {
      pins = d.pins || [];
      placePins();
    }
    if (d.type === "rl-goto") {
      try {
        var el = resolveElement(d);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add("__rl-flash");
          setTimeout(function () {
            el.classList.remove("__rl-flash");
          }, 1600);
        }
      } catch (err) {}
    }
  });
  setTimeout(placePins, 400);
  parent.postMessage({ type: "rl-ready" }, "*");
}

export const INSPECTOR = "(" + inspectorMain.toString() + ")()";
