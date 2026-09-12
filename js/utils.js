// ========================================================
// PhysioFlow - Common Security & Formatting Utilities
// ========================================================

/**
 * Escapes unsafe characters in a string before inserting into innerHTML
 * to prevent Cross-Site Scripting (XSS) injection.
 * @param {*} str - input string or value
 * @returns {string} escaped safe string
 */
export function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Returns a date as a local YYYY-MM-DD string using the device's
 * local timezone (e.g. Africa/Cairo, UTC+2), NOT UTC.
 * @param {Date} [date=new Date()] - defaults to right now
 * @returns {string} local date in YYYY-MM-DD format
 */
export function getLocalDateStr(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * High-performance 60FPS 3D Stack Deck with horizontal swipe gestures:
 * - Left-peeking stack: under cards peek out from the left (RTL aesthetic).
 * - Drag/Swipe right: active card slides away to the right and reveals next card.
 * - Drag/Swipe left: previous card slides back in from the right to the front.
 * - Real-time touch drag tracking with requestAnimationFrame.
 * - Zero layout thrashing (avoids reflowing height during transitions).
 * - GPU layer culling (off-stack cards have visibility: hidden).
 * - touch-action: pan-y (vertical page scroll is completely smooth and unhindered).
 * 
 * @param {string|Object} config - String prefix (e.g. 'daily-doc-stack') or config object
 * @returns {Object|null} controller
 */
export function initStackDeck(config) {
  const prefix = typeof config === 'string' ? config : (config.prefix || 'doc-stack');
  const containerId = typeof config === 'object' && config.containerId ? config.containerId : `${prefix}-container`;
  const container = document.getElementById(containerId);
  if (!container) return null;

  const cards = Array.from(container.querySelectorAll('.doc-stack-card'));
  if (!cards.length) return null;

  const initialIndex = typeof config === 'object' && typeof config.initialIndex === 'number'
    ? Math.max(0, Math.min(config.initialIndex, cards.length - 1))
    : 0;
  let currentIndex = initialIndex;
  let isListMode = false;
  let isDragging = false;
  let isSwipeActive = false;
  let directionLocked = false;
  let startX = 0;
  let startY = 0;
  let deltaX = 0;
  let deltaY = 0;
  let startTime = 0;
  let rafId = null;

  // Resolve associated UI elements
  const dotsContainer = document.getElementById(typeof config === 'object' && config.dotsId ? config.dotsId : `${prefix}-dots`);
  const counterEl = document.getElementById(typeof config === 'object' && config.counterId ? config.counterId : `${prefix}-counter`);
  const nextBtn = document.getElementById(typeof config === 'object' && config.nextBtnId ? config.nextBtnId : `btn-${prefix}-next`);
  const prevBtn = document.getElementById(typeof config === 'object' && config.prevBtnId ? config.prevBtnId : `btn-${prefix}-prev`);
  const toggleBtn = document.getElementById(typeof config === 'object' && config.toggleBtnId ? config.toggleBtnId : `btn-toggle-${prefix}`) ||
                    document.getElementById(`btn-toggle-${prefix}-layout`);
  const toggleIcon = document.getElementById(typeof config === 'object' && config.toggleIconId ? config.toggleIconId : `icon-${prefix}-toggle`) ||
                     document.getElementById('icon-stack-toggle');

  // Measure initial maximum height once to avoid layout thrashing
  const updateContainerMinHeight = () => {
    if (isListMode) {
      container.style.minHeight = 'auto';
      return;
    }
    let maxHeight = 160;
    cards.forEach((c) => {
      if (c.offsetHeight > maxHeight) maxHeight = c.offsetHeight;
    });
    container.style.minHeight = `${maxHeight + 10}px`;
  };
  requestAnimationFrame(updateContainerMinHeight);

  const springTransition = 'transform 0.28s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.24s ease';

  // Apply resting transforms to all cards
  const updatePositions = (newIndex = 0, animate = true) => {
    if (isListMode) return;
    currentIndex = Math.max(0, Math.min(newIndex, cards.length - 1));

    for (let idx = 0; idx < cards.length; idx++) {
      const card = cards[idx];
      const diff = idx - currentIndex;

      card.style.transition = animate ? springTransition : 'none';

      if (diff === 0) {
        // Active front card
        card.style.transform = 'translate3d(0, 0, 0) scale(1)';
        card.style.zIndex = '12';
        card.style.opacity = '1';
        card.style.visibility = 'visible';
        card.style.pointerEvents = 'auto';
        card.classList.add('is-active-card');
        card.classList.remove('is-peeking-card', 'is-passed-card', 'is-hidden-card');
      } else if (diff === 1) {
        // First peeking card on the left
        card.style.transform = 'translate3d(-18px, 0, 0) scale(0.96)';
        card.style.zIndex = '10';
        card.style.opacity = '0.88';
        card.style.visibility = 'visible';
        card.style.pointerEvents = 'auto';
        card.classList.add('is-peeking-card');
        card.classList.remove('is-active-card', 'is-passed-card', 'is-hidden-card');
      } else if (diff === 2) {
        // Second peeking card further to the left
        card.style.transform = 'translate3d(-34px, 0, 0) scale(0.92)';
        card.style.zIndex = '8';
        card.style.opacity = '0.72';
        card.style.visibility = 'visible';
        card.style.pointerEvents = 'auto';
        card.classList.add('is-peeking-card');
        card.classList.remove('is-active-card', 'is-passed-card', 'is-hidden-card');
      } else if (diff > 2) {
        // Hidden cards ahead in the stack (culled from GPU render tree)
        card.style.transform = 'translate3d(-48px, 0, 0) scale(0.88)';
        card.style.zIndex = '4';
        card.style.opacity = '0';
        card.style.visibility = 'hidden';
        card.style.pointerEvents = 'none';
        card.classList.add('is-hidden-card');
        card.classList.remove('is-active-card', 'is-peeking-card', 'is-passed-card');
      } else {
        // Passed cards exited to the right
        card.style.transform = 'translate3d(120%, 0, 0) scale(0.95)';
        card.style.zIndex = '4';
        card.style.opacity = '0';
        card.style.visibility = 'hidden';
        card.style.pointerEvents = 'none';
        card.classList.add('is-passed-card', 'is-hidden-card');
        card.classList.remove('is-active-card', 'is-peeking-card');
      }
    }

    // Update dots
    if (dotsContainer) {
      const dots = dotsContainer.querySelectorAll('.doc-dot');
      dots.forEach((d, i) => {
        if (i === currentIndex) d.classList.add('active');
        else d.classList.remove('active');
      });
    }

    // Update counter
    if (counterEl) {
      counterEl.textContent = `${currentIndex + 1} من ${cards.length}`;
    }
  };

  // Initial layout
  updatePositions(initialIndex, false);

  // Click peeking card to bring to front
  cards.forEach((card, idx) => {
    card.addEventListener('click', (e) => {
      if (isListMode) return;
      if (idx !== currentIndex) {
        e.stopPropagation();
        updatePositions(idx, true);
      }
    });
  });

  // Next / Prev button navigation
  nextBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    if (currentIndex < cards.length - 1) {
      updatePositions(currentIndex + 1, true);
    }
  });

  prevBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    if (currentIndex > 0) {
      updatePositions(currentIndex - 1, true);
    }
  });

  // Dots click navigation
  dotsContainer?.addEventListener('click', (e) => {
    const dot = e.target.closest('.doc-dot');
    if (!dot) return;
    const idx = parseInt(dot.getAttribute('data-dot-index'), 10);
    if (!isNaN(idx)) updatePositions(idx, true);
  });

  // -------------------------------------------------------------
  // Real-Time 60FPS Touch & Mouse Gesture Engine
  // -------------------------------------------------------------
  let activeCard = null;
  let prevCard = null;
  let nextCard = null;

  const handleStart = (clientX, clientY) => {
    if (isListMode) return;
    startX = clientX;
    startY = clientY;
    deltaX = 0;
    deltaY = 0;
    startTime = Date.now();
    isDragging = true;
    directionLocked = false;
    isSwipeActive = false;

    activeCard = cards[currentIndex] || null;
    prevCard = currentIndex > 0 ? cards[currentIndex - 1] : null;
    nextCard = currentIndex < cards.length - 1 ? cards[currentIndex + 1] : null;
  };

  const handleMove = (clientX, clientY) => {
    if (!isDragging || isListMode) return;
    deltaX = clientX - startX;
    deltaY = clientY - startY;

    if (!directionLocked) {
      // If predominantly vertical movement, user is scrolling page -> leave alone
      if (Math.abs(deltaY) > 8 && Math.abs(deltaY) >= Math.abs(deltaX)) {
        directionLocked = true;
        isSwipeActive = false;
        return;
      }
      // If predominantly horizontal, user is swiping cards -> engage
      if (Math.abs(deltaX) > 8 && Math.abs(deltaX) > Math.abs(deltaY)) {
        directionLocked = true;
        isSwipeActive = true;

        if (activeCard) activeCard.style.transition = 'none';
        if (prevCard) {
          prevCard.style.transition = 'none';
          prevCard.style.visibility = 'visible';
        }
        if (nextCard) nextCard.style.transition = 'none';
      }
    }

    if (!isSwipeActive || !activeCard) return;

    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      const containerWidth = container.offsetWidth || 320;

      if (deltaX > 0) {
        // Dragging to the RIGHT -> moving towards NEXT card
        if (currentIndex >= cards.length - 1) {
          const dampX = deltaX * 0.25;
          activeCard.style.transform = `translate3d(${dampX}px, 0, 0) scale(1) rotate(${dampX * 0.02}deg)`;
        } else {
          const rot = Math.min(8, Math.max(-8, deltaX * 0.03));
          activeCard.style.transform = `translate3d(${deltaX}px, 0, 0) scale(1) rotate(${rot}deg)`;
          activeCard.style.opacity = `${Math.max(0.35, 1 - (deltaX / (containerWidth * 1.2)))}`;

          if (nextCard) {
            const progress = Math.min(1, Math.max(0, deltaX / (containerWidth * 0.65)));
            const nextX = -18 * (1 - progress);
            const nextScale = 0.96 + 0.04 * progress;
            const nextOpacity = 0.88 + 0.12 * progress;
            nextCard.style.transform = `translate3d(${nextX}px, 0, 0) scale(${nextScale})`;
            nextCard.style.opacity = `${nextOpacity}`;
          }
        }
      } else {
        // Dragging to the LEFT -> bringing back PREVIOUS card from right
        if (currentIndex === 0) {
          const dampX = deltaX * 0.25;
          activeCard.style.transform = `translate3d(${dampX}px, 0, 0) scale(1) rotate(${dampX * 0.02}deg)`;
        } else if (prevCard) {
          prevCard.style.zIndex = '15';
          prevCard.style.opacity = '1';
          const entryX = Math.max(0, containerWidth + deltaX);
          const rot = Math.min(8, entryX * 0.02);
          prevCard.style.transform = `translate3d(${entryX}px, 0, 0) scale(1) rotate(${rot}deg)`;

          const progress = Math.min(1, Math.abs(deltaX) / (containerWidth * 0.65));
          activeCard.style.transform = `translate3d(${deltaX * 0.15}px, 0, 0) scale(${1 - 0.04 * progress})`;
        }
      }
    });
  };

  const handleEnd = () => {
    if (!isDragging || isListMode) return;
    isDragging = false;

    if (rafId) cancelAnimationFrame(rafId);

    if (!isSwipeActive) return;
    isSwipeActive = false;

    const deltaTime = Math.max(1, Date.now() - startTime);
    const velocityX = deltaX / deltaTime;

    const threshold = 50;
    const flickThreshold = 0.35;

    const isFlickRight = deltaX > 20 && velocityX > flickThreshold;
    const isFlickLeft = deltaX < -20 && velocityX < -flickThreshold;
    const isSwipeRight = deltaX > threshold || isFlickRight;
    const isSwipeLeft = deltaX < -threshold || isFlickLeft;

    if (isSwipeRight && currentIndex < cards.length - 1) {
      if (activeCard) {
        activeCard.style.transition = springTransition;
        activeCard.style.transform = 'translate3d(120%, 0, 0) scale(0.96) rotate(6deg)';
        activeCard.style.opacity = '0';
        activeCard.style.pointerEvents = 'none';
      }
      updatePositions(currentIndex + 1, true);
    } else if (isSwipeLeft && currentIndex > 0) {
      if (prevCard) {
        prevCard.style.transition = springTransition;
        prevCard.style.transform = 'translate3d(0, 0, 0) scale(1) rotate(0deg)';
        prevCard.style.opacity = '1';
      }
      updatePositions(currentIndex - 1, true);
    } else {
      updatePositions(currentIndex, true);
    }
  };

  // Touch event listeners (passive for maximum scroll performance)
  container.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) handleStart(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });

  container.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1) handleMove(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });

  container.addEventListener('touchend', handleEnd, { passive: true });
  container.addEventListener('touchcancel', handleEnd, { passive: true });

  // Mouse drag support for desktop testing
  let isMouseDown = false;
  container.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || isListMode) return;
    isMouseDown = true;
    handleStart(e.clientX, e.clientY);
  });

  const onMouseMove = (e) => {
    if (!isMouseDown) return;
    handleMove(e.clientX, e.clientY);
  };

  const onMouseUp = () => {
    if (!isMouseDown) return;
    isMouseDown = false;
    handleEnd();
  };

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);

  // Toggle Stack vs List Mode
  toggleBtn?.addEventListener('click', () => {
    isListMode = !isListMode;
    if (isListMode) {
      container.classList.add('is-list-layout');
      if (toggleIcon) toggleIcon.className = 'fa-solid fa-layer-group';
      cards.forEach((card) => {
        card.style.transform = '';
        card.style.opacity = '1';
        card.style.visibility = 'visible';
        card.style.zIndex = '';
        card.style.pointerEvents = 'auto';
        card.style.transition = '';
      });
      container.style.minHeight = 'auto';
    } else {
      container.classList.remove('is-list-layout');
      if (toggleIcon) toggleIcon.className = 'fa-solid fa-list';
      updateContainerMinHeight();
      updatePositions(currentIndex, true);
    }
  });

  return {
    updatePositions,
    next: () => updatePositions(currentIndex + 1, true),
    prev: () => updatePositions(currentIndex - 1, true),
    refreshHeight: updateContainerMinHeight
  };
}

/**
 * Triggers subtle native haptic vibration feedback on supported mobile devices.
 * @param {'light'|'medium'|'success'|'warning'} type
 */
export function triggerHaptic(type = 'light') {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      if (type === 'light') navigator.vibrate(12);
      else if (type === 'medium') navigator.vibrate(22);
      else if (type === 'success') navigator.vibrate([15, 30, 20]);
      else if (type === 'warning') navigator.vibrate([30, 40, 30]);
    } catch (_) {}
  }
}

/**
 * Dynamically computes a consistent, high-contrast, elegant theme color for any doctor
 * based on their name or UID, automatically supporting any future doctors without code changes.
 * @param {string} identifier - Doctor UID or Name
 * @returns {{color: string, bg: string, border: string}}
 */
export function getDoctorColor(identifier) {
  const isDark = typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark';
  const LIGHT_PALETTE = [
    { color: '#0284c7', bg: 'rgba(2, 132, 199, 0.12)', border: 'rgba(2, 132, 199, 0.3)' },
    { color: '#0d9488', bg: 'rgba(13, 148, 136, 0.12)', border: 'rgba(13, 148, 136, 0.3)' },
    { color: '#4f46e5', bg: 'rgba(79, 70, 229, 0.12)', border: 'rgba(79, 70, 229, 0.3)' },
    { color: '#7c3aed', bg: 'rgba(124, 58, 237, 0.12)', border: 'rgba(124, 58, 237, 0.3)' },
    { color: '#d97706', bg: 'rgba(217, 119, 6, 0.12)', border: 'rgba(217, 119, 6, 0.3)' },
    { color: '#e11d48', bg: 'rgba(225, 29, 72, 0.12)', border: 'rgba(225, 29, 72, 0.3)' },
    { color: '#0891b2', bg: 'rgba(8, 145, 178, 0.12)', border: 'rgba(8, 145, 178, 0.3)' },
    { color: '#16a34a', bg: 'rgba(22, 163, 74, 0.12)', border: 'rgba(22, 163, 74, 0.3)' }
  ];
  const DARK_PALETTE = [
    { color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.16)', border: 'rgba(56, 189, 248, 0.35)' },
    { color: '#2dd4bf', bg: 'rgba(45, 212, 191, 0.16)', border: 'rgba(45, 212, 191, 0.35)' },
    { color: '#818cf8', bg: 'rgba(129, 140, 248, 0.16)', border: 'rgba(129, 140, 248, 0.35)' },
    { color: '#c084fc', bg: 'rgba(192, 132, 252, 0.16)', border: 'rgba(192, 132, 252, 0.35)' },
    { color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.16)', border: 'rgba(251, 191, 36, 0.35)' },
    { color: '#fb7185', bg: 'rgba(251, 113, 133, 0.16)', border: 'rgba(251, 113, 133, 0.35)' },
    { color: '#22d3ee', bg: 'rgba(34, 211, 238, 0.16)', border: 'rgba(34, 211, 238, 0.35)' },
    { color: '#4ade80', bg: 'rgba(74, 222, 128, 0.16)', border: 'rgba(74, 222, 128, 0.35)' }
  ];
  const PALETTE = isDark ? DARK_PALETTE : LIGHT_PALETTE;

  if (!identifier) return PALETTE[0];
  let hash = 0;
  const str = String(identifier).trim();
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % PALETTE.length;
  return PALETTE[index];
}
