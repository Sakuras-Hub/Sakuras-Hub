(function() {
  if (document.getElementById('dpad-styles')) return;
  var style = document.createElement('style');
  style.id = 'dpad-styles';
  style.textContent = 
    '.dpad-focus{outline:3px solid #FF00FF;outline-offset:3px;box-shadow:0 0 0 6px rgba(255,0,255,0.25);border-radius:inherit}';
  document.head.appendChild(style);

  var SELECTORS = [
    '.tab-btn',
    '.suit-tab-btn',
    '.info-card',
    '.sf-acc-header',
    '.fl-trigger',
    '.fl-dd-item',
    '.fl-nsfw-toggle',
    '.preset-card',
    '.script-game-card',
    '.copy-btn',
    '.dialog-btn',
    '.controls button',
    '.hero-links a',
    '.footer',
    '.social-links a'
  ];

  var FALLBACK_SELECTOR = 'a[href], button, [tabindex]:not([tabindex="-1"])';

  var focusSet = [];
  var currentIndex = -1;
  var focusMode = false;
  var observer = null;
  var rebuildScheduled = false;
  var gamepadLoopId = null;
  var gamepadPressed = {};
  var prevGamepads = [];

  function isVisible(el) {
    if (!el || el.offsetWidth === 0 && el.offsetHeight === 0) return false;
    var style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && 
           rect.bottom > 0 && rect.right > 0 && 
           rect.top < window.innerHeight && rect.left < window.innerWidth;
  }

  function isHiddenByAncestor(el) {
    while (el && el !== document.body) {
      var style = window.getComputedStyle(el);
      if (style.display === 'none') return true;
      el = el.parentElement;
    }
    return false;
  }

  function getFocusableElements() {
    var elements = [];
    var seen = new Set();

    SELECTORS.forEach(function(sel) {
      document.querySelectorAll(sel).forEach(function(el) {
        if (seen.has(el)) return;
        if (!isVisible(el)) return;
        if (isHiddenByAncestor(el)) return;
        
        if (sel === '.info-card') {
          var clickableLink = el.querySelector('.card-title a[href], .card-title[onclick]');
          var onclickAncestor = el.closest('[onclick]');
          if (clickableLink || onclickAncestor) {
            elements.push(el);
            seen.add(el);
          } else {
            var links = el.querySelectorAll('.card-body a[href]');
            links.forEach(function(link) {
              if (isVisible(link) && !isHiddenByAncestor(link) && !seen.has(link)) {
                elements.push(link);
                seen.add(link);
              }
            });
          }
        } else {
          elements.push(el);
          seen.add(el);
        }
      });
    });

    document.querySelectorAll(FALLBACK_SELECTOR).forEach(function(el) {
      if (seen.has(el)) return;
      if (!isVisible(el)) return;
      if (isHiddenByAncestor(el)) return;
      
      var inExcluded = false;
      for (var i = 0; i < SELECTORS.length; i++) {
        if (el.closest(SELECTORS[i])) {
          inExcluded = true;
          break;
        }
      }
      if (!inExcluded) {
        elements.push(el);
        seen.add(el);
      }
    });

    return elements;
  }

  function getRectCenter(el) {
    var rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function distance(a, b) {
    var dx = Math.abs(a.x - b.x);
    var dy = Math.abs(a.y - b.y);
    return dx + dy * 0.5;
  }

  function findNearest(currentEl, direction) {
    var currentCenter = getRectCenter(currentEl);
    var best = null;
    var bestDist = Infinity;

    focusSet.forEach(function(el, idx) {
      if (el === currentEl) return;
      var center = getRectCenter(el);
      var dx = center.x - currentCenter.x;
      var dy = center.y - currentCenter.y;

      var candidate = false;
      if (direction === 'up' && dy < -5) candidate = true;
      else if (direction === 'down' && dy > 5) candidate = true;
      else if (direction === 'left' && dx < -5) candidate = true;
      else if (direction === 'right' && dx > 5) candidate = true;

      if (!candidate) return;

      var axisOverlap = false;
      if (direction === 'up' || direction === 'down') {
        var currentRect = currentEl.getBoundingClientRect();
        var elRect = el.getBoundingClientRect();
        axisOverlap = !(elRect.right < currentRect.left || elRect.left > currentRect.right);
      } else {
        var currentRect = currentEl.getBoundingClientRect();
        var elRect = el.getBoundingClientRect();
        axisOverlap = !(elRect.bottom < currentRect.top || elRect.top > currentRect.bottom);
      }

      var d = distance(currentCenter, center);
      if (axisOverlap) d *= 0.7;

      if (d < bestDist) {
        bestDist = d;
        best = idx;
      }
    });

    return best;
  }

  function setFocus(idx) {
    if (idx < 0 || idx >= focusSet.length) return;
    if (currentIndex >= 0 && currentIndex < focusSet.length) {
      focusSet[currentIndex].classList.remove('dpad-focus');
    }
    currentIndex = idx;
    var el = focusSet[idx];
    el.classList.add('dpad-focus');
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }

  function clearFocus() {
    if (currentIndex >= 0 && currentIndex < focusSet.length) {
      focusSet[currentIndex].classList.remove('dpad-focus');
    }
    currentIndex = -1;
    focusMode = false;
  }

  function enterFocusMode() {
    if (focusMode) return;
    focusMode = true;
    focusSet = getFocusableElements();
    if (focusSet.length === 0) {
      focusMode = false;
      return;
    }
    var firstTabBtn = focusSet.findIndex(function(el) { return el.classList.contains('tab-btn'); });
    setFocus(firstTabBtn >= 0 ? firstTabBtn : 0);
  }

  function activateFocused() {
    if (currentIndex < 0 || currentIndex >= focusSet.length) return;
    var el = focusSet[currentIndex];
    var tag = el.tagName.toLowerCase();
    
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable) {
      el.focus();
      return;
    }

    if (el.classList.contains('info-card')) {
      var cardLink = el.querySelector('.card-title a[href], .card-title[onclick], .card-body a[href]');
      if (cardLink) { cardLink.click(); return; }
    }
    if (el.classList.contains('script-game-card')) {
      var gameLink = el.querySelector('.sg-name a[href]');
      if (gameLink) { gameLink.click(); return; }
    }
    
    el.click();
  }

  function handleBack() {
    var openDD = document.querySelector('.fl-custom-dd.open');
    if (openDD) {
      var trigger = openDD.querySelector('.fl-trigger');
      if (trigger) trigger.click();
      else openDD.classList.remove('open');
      return;
    }

    var dialog = document.getElementById('dialogOverlay');
    if (dialog && dialog.classList.contains('open')) {
      var cancelBtn = dialog.querySelector('.dialog-btn:not(.primary)');
      if (cancelBtn) cancelBtn.click();
      else dialog.classList.remove('open');
      return;
    }

    clearFocus();
  }

  function rebuildFocusSet() {
    var prevEl = currentIndex >= 0 && currentIndex < focusSet.length ? focusSet[currentIndex] : null;
    focusSet = getFocusableElements();
    
    if (focusSet.length === 0) {
      clearFocus();
      return;
    }

    if (prevEl && focusSet.includes(prevEl)) {
      setFocus(focusSet.indexOf(prevEl));
    } else if (focusMode && currentIndex >= 0) {
      setFocus(Math.min(currentIndex, focusSet.length - 1));
    }
  }

  function scheduleRebuild() {
    if (rebuildScheduled) return;
    rebuildScheduled = true;
    setTimeout(function() {
      rebuildScheduled = false;
      rebuildFocusSet();
    }, 120);
  }

  function onKeyDown(e) {
    var t = e.target;
    if (t && t.closest && t.closest('input, textarea, select, [contenteditable]')) return;
    
    if (!focusMode) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight' || 
          e.key === 'Enter' || e.key === 'Escape' || e.key === 'Backspace') {
        enterFocusMode();
      } else {
        return;
      }
    }

    var handled = false;
    switch (e.key) {
      case 'ArrowUp':
        var idx = findNearest(focusSet[currentIndex], 'up');
        if (idx >= 0) setFocus(idx);
        handled = true;
        break;
      case 'ArrowDown':
        var idx = findNearest(focusSet[currentIndex], 'down');
        if (idx >= 0) setFocus(idx);
        handled = true;
        break;
      case 'ArrowLeft':
        var idx = findNearest(focusSet[currentIndex], 'left');
        if (idx >= 0) setFocus(idx);
        handled = true;
        break;
      case 'ArrowRight':
        var idx = findNearest(focusSet[currentIndex], 'right');
        if (idx >= 0) setFocus(idx);
        handled = true;
        break;
      case 'Enter':
        activateFocused();
        handled = true;
        break;
      case 'Escape':
      case 'Backspace':
        handleBack();
        handled = true;
        break;
    }

    if (handled) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }

  function getGamepadIndex(gp) {
    if (!gp) return -1;
    for (var i = 0; i < prevGamepads.length; i++) {
      if (prevGamepads[i] && prevGamepads[i].index === gp.index) return i;
    }
    return -1;
  }

  function pollGamepads() {
    var gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    var hasGamepad = false;

    for (var i = 0; i < gamepads.length; i++) {
      var gp = gamepads[i];
      if (!gp) continue;
      hasGamepad = true;

      var gpIdx = getGamepadIndex(gp);
      var pressed = gamepadPressed[gp.index] || {};
      gamepadPressed[gp.index] = pressed;

      var buttons = gp.buttons;
      var checkButton = function(btnIdx, action) {
        if (!buttons[btnIdx]) return;
        var isPressed = buttons[btnIdx].pressed;
        var wasPressed = pressed[btnIdx] || false;
        if (isPressed && !wasPressed) {
          pressed[btnIdx] = true;
          action();
        } else if (!isPressed) {
          pressed[btnIdx] = false;
        }
      };

      checkButton(12, function() { if (focusMode) { var idx = findNearest(focusSet[currentIndex], 'up'); if (idx >= 0) setFocus(idx); } else enterFocusMode(); });
      checkButton(13, function() { if (focusMode) { var idx = findNearest(focusSet[currentIndex], 'down'); if (idx >= 0) setFocus(idx); } else enterFocusMode(); });
      checkButton(14, function() { if (focusMode) { var idx = findNearest(focusSet[currentIndex], 'left'); if (idx >= 0) setFocus(idx); } else enterFocusMode(); });
      checkButton(15, function() { if (focusMode) { var idx = findNearest(focusSet[currentIndex], 'right'); if (idx >= 0) setFocus(idx); } else enterFocusMode(); });
      checkButton(0, function() { if (focusMode) activateFocused(); else enterFocusMode(); });
      checkButton(1, function() { if (focusMode) handleBack(); });
      checkButton(9, function() { if (focusMode) handleBack(); });
    }

    prevGamepads = Array.from(gamepads).filter(Boolean);

    if (hasGamepad) {
      gamepadLoopId = requestAnimationFrame(pollGamepads);
    } else {
      gamepadLoopId = null;
    }
  }

  function onGamepadConnected(e) {
    if (!gamepadLoopId) {
      pollGamepads();
    }
  }

  function onGamepadDisconnected(e) {
    var gp = e.gamepad;
    delete gamepadPressed[gp.index];
  }

  function init() {
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('gamepadconnected', onGamepadConnected);
    window.addEventListener('gamepaddisconnected', onGamepadDisconnected);

    observer = new MutationObserver(scheduleRebuild);
    observer.observe(document.body, { childList: true, subtree: true });

    if (navigator.getGamepads) {
      var gps = navigator.getGamepads();
      for (var i = 0; i < gps.length; i++) {
        if (gps[i]) {
          onGamepadConnected({ gamepad: gps[i] });
          break;
        }
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.__dpad = {
    rebuild: rebuildFocusSet,
    getFocusSet: function() { return focusSet; },
    getCurrentIndex: function() { return currentIndex; },
    isFocusMode: function() { return focusMode; }
  };
})();