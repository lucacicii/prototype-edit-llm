/**
 * Injected script for the Built-in BrowserView.
 * Provides:
 * 1. 🎯 Universal Multi-Framework Inspect Tool (Vue 3 / Vue 2 / React Fiber / Native DOM).
 * 2. ✏️ Markup / Drawing annotation tool (overlay canvas to draw boxes and text notes).
 * 3. 🐞 Runtime error & Vite overlay monitor.
 */

export const BROWSER_PROBE_SCRIPT = `
(function() {
  if (window.__PROTOTYPE_PROBE_INITIALIZED__) return;
  window.__PROTOTYPE_PROBE_INITIALIZED__ = true;

  console.log('[PrototypeProbe] Universal Inspector Injected');

  let currentMode = 'off'; // 'off' | 'inspect' | 'markup'
  let highlightBox = null;
  let currentHoverEl = null;

  // --- Framework & Source Location Resolution ---
  function resolveComponentMetadata(el) {
    let framework = 'native-dom';
    let componentName = '';
    let sourceFile = '';
    let sourceLine = null;
    let propsSnippet = '';

    // 1. Check for compiler-generated inspection attributes (vite-plugin-vue-inspector, code-inspector, etc.)
    const locAttr = el.getAttribute('data-v-inspector') || 
                    el.getAttribute('data-loc') || 
                    el.getAttribute('data-source') ||
                    el.getAttribute('data-inspector-loc');
    if (locAttr) {
      // e.g. "src/views/order/List.vue:42:5"
      const parts = locAttr.split(':');
      sourceFile = parts[0] || '';
      if (parts[1]) sourceLine = parseInt(parts[1], 10);
    }

    // 2. Vue 3 Inspection (via __vnode / __vueParentComponent)
    if (el.__vnode) {
      framework = 'vue3';
      let vnode = el.__vnode;
      // find nearest meaningful component
      while (vnode) {
        if (vnode.type && typeof vnode.type === 'object') {
          const comp = vnode.type;
          const name = comp.__name || comp.name || comp.displayName;
          if (name && name !== 'Anonymous') {
            componentName = name;
            if (comp.__file && !sourceFile) {
              sourceFile = comp.__file;
            }
            break;
          }
        }
        vnode = vnode.parent || null;
      }

      // Check __vueParentComponent if not found
      if (!componentName && el.__vueParentComponent) {
        const parentType = el.__vueParentComponent.type;
        if (parentType) {
          componentName = parentType.__name || parentType.name || '';
          if (parentType.__file && !sourceFile) sourceFile = parentType.__file;
        }
      }
    }

    // 3. React Inspection (via __reactFiber$...)
    if (!componentName) {
      const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
      if (fiberKey) {
        framework = 'react';
        let fiber = el[fiberKey];
        while (fiber) {
          if (fiber.type) {
            const name = typeof fiber.type === 'function' ? (fiber.type.displayName || fiber.type.name) :
                         typeof fiber.type === 'object' ? (fiber.type.displayName || fiber.type.name) : null;
            if (name && name !== 'Fragment' && !name.startsWith('_')) {
              componentName = name;
              if (fiber._debugSource && !sourceFile) {
                sourceFile = fiber._debugSource.fileName || '';
                sourceLine = fiber._debugSource.lineNumber || null;
              }
              break;
            }
          }
          fiber = fiber.return;
        }
      }
    }

    // 4. Vue 2 Inspection (via __vue__)
    if (!componentName && (el.__vue__ || (el.parentElement && el.parentElement.__vue__))) {
      framework = 'vue2';
      const vueInst = el.__vue__ || el.parentElement.__vue__;
      if (vueInst && vueInst.$options) {
        componentName = vueInst.$options._componentTag || vueInst.$options.name || '';
        if (vueInst.$options.__file && !sourceFile) {
          sourceFile = vueInst.$options.__file;
        }
      }
    }

    // Fallback: derive component name from tag or classes
    const tagName = el.tagName.toLowerCase();
    if (!componentName) {
      if (tagName.includes('-')) {
        componentName = tagName;
      } else {
        const cls = typeof el.className === 'string' ? el.className : '';
        const match = cls.match(/\\b(el-[a-z0-9-]+|wb-[a-z0-9-]+|ant-[a-z0-9-]+)\\b/);
        if (match) {
          componentName = match[1];
        }
      }
    }

    return {
      framework,
      componentName: componentName || tagName,
      sourceFile,
      sourceLine,
      propsSnippet
    };
  }

  // 1. Inspect DOM Elements (🎯 圈选)
  function initHighlightBox() {
    if (highlightBox) return;
    highlightBox = document.createElement('div');
    highlightBox.id = '__prototype_highlight_box__';
    highlightBox.style.position = 'fixed';
    highlightBox.style.pointerEvents = 'none';
    highlightBox.style.border = '2px solid #0284c7';
    highlightBox.style.backgroundColor = 'rgba(2, 132, 199, 0.18)';
    highlightBox.style.zIndex = '2147483646';
    highlightBox.style.transition = 'all 0.05s ease';
    highlightBox.style.display = 'none';
    highlightBox.style.borderRadius = '3px';

    const badge = document.createElement('div');
    badge.id = '__prototype_badge__';
    badge.style.position = 'absolute';
    badge.style.top = '-24px';
    badge.style.left = '0';
    badge.style.backgroundColor = '#0284c7';
    badge.style.color = '#ffffff';
    badge.style.fontSize = '11px';
    badge.style.padding = '2px 6px';
    badge.style.borderRadius = '3px';
    badge.style.whiteSpace = 'nowrap';
    badge.style.fontFamily = 'monospace';
    badge.style.display = 'flex';
    badge.style.alignItems = 'center';
    badge.style.gap = '4px';
    badge.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)';
    highlightBox.appendChild(badge);

    document.body.appendChild(highlightBox);
  }

  function handleMouseMove(e) {
    if (currentMode !== 'inspect') return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === highlightBox || highlightBox?.contains(el) || el.id?.startsWith('__prototype_')) return;

    currentHoverEl = el;
    const rect = el.getBoundingClientRect();
    initHighlightBox();

    highlightBox.style.display = 'block';
    highlightBox.style.top = rect.top + 'px';
    highlightBox.style.left = rect.left + 'px';
    highlightBox.style.width = rect.width + 'px';
    highlightBox.style.height = rect.height + 'px';

    const badge = highlightBox.querySelector('#__prototype_badge__');
    if (badge) {
      const meta = resolveComponentMetadata(el);
      const tag = el.tagName.toLowerCase();
      const txt = (el.innerText || el.textContent || '').trim().slice(0, 14);
      
      let badgeHtml = '<span style=\"font-weight:bold;\">&lt;' + (meta.componentName || tag) + '&gt;</span>';
      if (meta.sourceFile) {
        const fileName = meta.sourceFile.split('/').pop();
        badgeHtml += ' <span style=\"opacity:0.8;font-size:10px;\">(' + fileName + (meta.sourceLine ? ':' + meta.sourceLine : '') + ')</span>';
      } else if (txt) {
        badgeHtml += ' <span style=\"opacity:0.9;\">\"' + txt + '\"</span>';
      }
      badge.innerHTML = badgeHtml;
    }
  }

  function handleClick(e) {
    if (currentMode !== 'inspect') return;
    e.preventDefault();
    e.stopPropagation();

    if (currentHoverEl) {
      const el = currentHoverEl;
      const tagName = el.tagName.toLowerCase();
      const className = typeof el.className === 'string' ? el.className : '';
      const id = el.id || '';
      const text = (el.innerText || el.textContent || '').trim().slice(0, 100);
      const rect = el.getBoundingClientRect();
      const meta = resolveComponentMetadata(el);

      let selector = tagName;
      if (id) {
        selector += '#' + id;
      } else if (className) {
        const first = className.split(' ').filter(Boolean)[0];
        if (first) selector += '.' + first;
      }

      const payload = {
        tagName,
        className,
        id,
        text,
        innerText: text,
        textSnippet: text,
        selector,
        rect: {
          top: Math.round(rect.top),
          left: Math.round(rect.left),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        },
        framework: meta.framework,
        componentName: meta.componentName,
        sourceFile: meta.sourceFile,
        sourceLine: meta.sourceLine,
        outerHTMLSnippet: (el.outerHTML || '').slice(0, 300)
      };

      console.log('__PROTOTYPE_INSPECT_RESULT__' + JSON.stringify(payload));
    }

    setInspectMode('off');
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      if (currentMode !== 'off') {
        setInspectMode('off');
        console.log('__PROTOTYPE_INSPECT_CANCELLED__');
      }
    }
  }

  // 2. Markup Overlay (✏️ 圈改标注)
  let markupOverlay = null;
  let isDrawing = null;
  let startX = 0, startY = 0;
  let currentRectEl = null;

  function initMarkupOverlay() {
    if (markupOverlay) return;
    markupOverlay = document.createElement('div');
    markupOverlay.id = '__prototype_markup_overlay__';
    markupOverlay.style.position = 'fixed';
    markupOverlay.style.top = '0';
    markupOverlay.style.left = '0';
    markupOverlay.style.width = '100vw';
    markupOverlay.style.height = '100vh';
    markupOverlay.style.zIndex = '2147483645';
    markupOverlay.style.cursor = 'crosshair';
    markupOverlay.style.display = 'none';
    markupOverlay.style.backgroundColor = 'rgba(15, 23, 42, 0.15)';

    const tip = document.createElement('div');
    tip.style.position = 'absolute';
    tip.style.top = '12px';
    tip.style.left = '50%';
    tip.style.transform = 'translateX(-50%)';
    tip.style.backgroundColor = '#d97706';
    tip.style.color = '#fff';
    tip.style.padding = '4px 12px';
    tip.style.borderRadius = '6px';
    tip.style.fontSize = '12px';
    tip.style.fontWeight = 'bold';
    tip.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
    tip.textContent = '✏️ 圈改模式：拖拽鼠标绘制方框标注，按 ESC 退出';
    markupOverlay.appendChild(tip);

    markupOverlay.addEventListener('mousedown', (e) => {
      if (e.target !== markupOverlay) return;
      isDrawing = true;
      startX = e.clientX;
      startY = e.clientY;

      currentRectEl = document.createElement('div');
      currentRectEl.style.position = 'absolute';
      currentRectEl.style.border = '2px dashed #f59e0b';
      currentRectEl.style.backgroundColor = 'rgba(245, 158, 11, 0.2)';
      currentRectEl.style.left = startX + 'px';
      currentRectEl.style.top = startY + 'px';
      currentRectEl.style.pointerEvents = 'auto';
      markupOverlay.appendChild(currentRectEl);
    });

    markupOverlay.addEventListener('mousemove', (e) => {
      if (!isDrawing || !currentRectEl) return;
      const curX = e.clientX;
      const curY = e.clientY;
      const x = Math.min(startX, curX);
      const y = Math.min(startY, curY);
      const w = Math.abs(curX - startX);
      const h = Math.abs(curY - startY);
      currentRectEl.style.left = x + 'px';
      currentRectEl.style.top = y + 'px';
      currentRectEl.style.width = w + 'px';
      currentRectEl.style.height = h + 'px';
    });

    markupOverlay.addEventListener('mouseup', (e) => {
      if (!isDrawing || !currentRectEl) return;
      isDrawing = false;
      const rect = currentRectEl.getBoundingClientRect();
      if (rect.width > 20 && rect.height > 20) {
        const note = prompt('请输入针对此区域的圈改批注需求：', '调整此区域布局');
        if (note) {
          const badge = document.createElement('div');
          badge.style.position = 'absolute';
          badge.style.bottom = '-24px';
          badge.style.left = '0';
          badge.style.backgroundColor = '#b45309';
          badge.style.color = '#fff';
          badge.style.padding = '2px 8px';
          badge.style.fontSize = '11px';
          badge.style.borderRadius = '3px';
          badge.textContent = note;
          currentRectEl.appendChild(badge);

          const payload = {
            note,
            rect: {
              left: Math.round(rect.left),
              top: Math.round(rect.top),
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            }
          };
          console.log('__PROTOTYPE_MARKUP_RESULT__' + JSON.stringify(payload));
        } else {
          currentRectEl.remove();
        }
      } else {
        currentRectEl.remove();
      }
      currentRectEl = null;
    });

    document.body.appendChild(markupOverlay);
  }

  function setInspectMode(mode) {
    currentMode = mode;
    initHighlightBox();
    initMarkupOverlay();

    if (mode === 'inspect') {
      highlightBox.style.display = 'none';
      markupOverlay.style.display = 'none';
      document.addEventListener('mousemove', handleMouseMove, true);
      document.addEventListener('click', handleClick, true);
      document.addEventListener('keydown', handleKeyDown, true);
    } else if (mode === 'markup') {
      if (highlightBox) highlightBox.style.display = 'none';
      markupOverlay.style.display = 'block';
      document.removeEventListener('mousemove', handleMouseMove, true);
      document.removeEventListener('click', handleClick, true);
      document.addEventListener('keydown', handleKeyDown, true);
    } else {
      if (highlightBox) highlightBox.style.display = 'none';
      if (markupOverlay) markupOverlay.style.display = 'none';
      document.removeEventListener('mousemove', handleMouseMove, true);
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    }
  }

  // 3. Vite Error Overlay & DOM Error Sniffer
  function checkViteOverlay() {
    const viteOverlay = document.querySelector('vite-error-overlay');
    if (viteOverlay && viteOverlay.shadowRoot) {
      const messageBody = viteOverlay.shadowRoot.querySelector('.message-body');
      const file = viteOverlay.shadowRoot.querySelector('.file');
      return {
        hasError: true,
        message: messageBody ? messageBody.textContent : 'Vite Compilation Error',
        file: file ? file.textContent : ''
      };
    }
    return { hasError: false };
  }

  window.__PROTOTYPE_PROBE__ = {
    setMode: setInspectMode,
    checkViteOverlay: checkViteOverlay,
    resolveComponentMetadata: resolveComponentMetadata,
    clearMarkups: function() {
      if (markupOverlay) {
        const boxes = markupOverlay.querySelectorAll('div');
        boxes.forEach(b => {
          if (b.style.border) b.remove();
        });
      }
    }
  };
})();
`;
