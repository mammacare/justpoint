/* Inspector script injected into every rendered page (runs inside the
   sandboxed iframe, not this module — plain ES5, no imports). */
export const INSPECTOR = `
(function(){
  var pins = [];
  var hoverEl = null;
  var st = document.createElement('style');
  st.textContent = '.__rl-hover{outline:2px dashed #C43B2A !important;outline-offset:2px;cursor:crosshair !important}' +
    '.__rl-flash{outline:3px solid #C43B2A !important;outline-offset:2px}' +
    '.__rl-pin{position:absolute;z-index:2147483647;width:20px;height:20px;border-radius:50%;background:#C43B2A;color:#fff;font:600 11px/20px "IBM Plex Mono",monospace;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.3);pointer-events:none}' +
    '.__rl-pin.done{background:#2E7D4F}' +
    '.__rl-pin.closed{background:#77726A}';
  (document.head || document.documentElement).appendChild(st);

  /* Prefer tag+classes over bare position: a selector scoped only by
     nth-of-type drifts onto the wrong element whenever an unrelated
     sibling of the same tag is inserted or removed elsewhere on the
     page (e.g. a newly added button shifting every button after it).
     Classes make the match immune to that; ':nth-child(n of S)' is only
     needed as a last resort when several siblings share the same
     tag+classes, and even then it's scoped to just that matching set. */
  function cssPath(el){
    if(!el || el.nodeType !== 1) return '';
    var path = [];
    while(el && el.nodeType === 1 && el.tagName.toLowerCase() !== 'html'){
var tag = el.tagName.toLowerCase();
if(el.id){ path.unshift(tag + '#' + CSS.escape(el.id)); break; }
var classes = (el.className && typeof el.className === 'string')
    ? el.className.trim().split(/\s+/).filter(Boolean)
    : [];
var base = tag + classes.map(function(c){ return '.' + CSS.escape(c); }).join('');
var parent = el.parentElement;
var sibs = parent ? Array.prototype.filter.call(parent.children, function(s){ return s.matches(base); }) : [el];
path.unshift(sibs.length <= 1 ? base : base + ':nth-child(' + (sibs.indexOf(el) + 1) + ' of ' + base + ')');
el = parent;
    }
    return path.join(' > ');
  }

  document.addEventListener('mouseover', function(e){
    if(hoverEl) hoverEl.classList.remove('__rl-hover');
    hoverEl = e.target;
    if(hoverEl && hoverEl.classList) hoverEl.classList.add('__rl-hover');
  }, true);

  /* Left click: let the page work (tabs, buttons, carousels) but never
     navigate away — links are neutered, in-page anchors scroll manually
     (the injected <base> would otherwise turn them into real navigations). */
  document.addEventListener('click', function(e){
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if(!a) return;
    e.preventDefault(); e.stopPropagation();
    var h = a.getAttribute('href') || '';
    if(h.charAt(0) === '#' && h.length > 1){
try{
  var t = document.getElementById(h.slice(1));
  if(t) t.scrollIntoView({ behavior:'smooth', block:'start' });
}catch(err){}
    }
  }, true);
  document.addEventListener('submit', function(e){
    e.preventDefault(); e.stopPropagation();
  }, true);

  /* Right click: select the element for a change request */
  document.addEventListener('contextmenu', function(e){
    e.preventDefault(); e.stopPropagation();
    var el = e.target;
    if(!el || el.nodeType !== 1) return;
    parent.postMessage({ type:'rl-pick',
selector: cssPath(el),
tag: el.tagName.toLowerCase(),
text: (el.innerText || el.textContent || '').trim().slice(0, 300)
    }, '*');
  }, true);

  /* Second line of defense against selector drift: even a class-scoped
     selector can end up pointing at the wrong element if the page's
     structure changed enough (or an old nth-of-type selector recorded
     before this fix still drifts). If the recorded tag/text no longer
     match what's live, skip the pin rather than show it in the wrong
     place. */
  function normText(t){ return (t || '').replace(/\s+/g, ' ').trim().slice(0, 300); }
  function stillMatches(el, p){
    if(p.tag && el.tagName.toLowerCase() !== p.tag) return false;
    if(p.elementText && normText(el.innerText || el.textContent) !== normText(p.elementText)) return false;
    return true;
  }

  function placePins(){
    document.querySelectorAll('.__rl-pin').forEach(function(p){ p.remove(); });
    pins.forEach(function(p){
try{
  var el = document.querySelector(p.selector);
  if(!el || !stillMatches(el, p)) return;
  var r = el.getBoundingClientRect();
  var b = document.createElement('span');
  b.className = '__rl-pin' + (p.status === 'done' ? ' done' : p.status === 'closed' ? ' closed' : '');
  b.textContent = p.num;
  b.style.top = Math.max(0, r.top + window.scrollY - 9) + 'px';
  b.style.left = Math.max(0, r.left + window.scrollX - 9) + 'px';
  document.body.appendChild(b);
}catch(err){}
    });
  }
  var raf = null;
  function schedule(){ if(raf) return; raf = requestAnimationFrame(function(){ raf = null; placePins(); }); }
  window.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', schedule);

  window.addEventListener('message', function(e){
    var d = e.data || {};
    if(d.type === 'rl-pins'){ pins = d.pins || []; placePins(); }
    if(d.type === 'rl-goto'){
try{
  var el = document.querySelector(d.selector);
  if(el){
    el.scrollIntoView({ behavior:'smooth', block:'center' });
    el.classList.add('__rl-flash');
    setTimeout(function(){ el.classList.remove('__rl-flash'); }, 1600);
  }
}catch(err){}
    }
  });
  setTimeout(placePins, 400);
  parent.postMessage({ type:'rl-ready' }, '*');
})();`;
