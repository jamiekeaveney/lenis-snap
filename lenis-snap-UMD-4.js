/* =========================================================================
   lenis-snap-UMD.js
   UMD bundle exposing Snap as a global (window.Snap), AMD or CommonJS.
   ========================================================================= */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    // AMD
    define([], factory);
  } else if (typeof exports === 'object' && typeof module !== 'undefined') {
    // CommonJS / Node
    module.exports = factory();
  } else {
    // Browser globals
    root.Snap = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // --------- Helper functions (exactly as in your working code) ----------

  function debounce(callback, delay) {
    let timer;
    return function (...args) {
      const context = this;
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        callback.apply(context, args);
      }, delay);
    };
  }

  function removeParentSticky(element) {
    const position = getComputedStyle(element).position;
    if (position === 'sticky') {
      element.style.setProperty('position', 'static');
      element.dataset.sticky = 'true';
    }
    if (element.offsetParent) {
      removeParentSticky(element.offsetParent);
    }
  }

  function addParentSticky(element) {
    if (element.dataset?.sticky === 'true') {
      element.style.removeProperty('position');
      delete element.dataset.sticky;
    }
    if (element.offsetParent) {
      addParentSticky(element.offsetParent);
    }
  }

  function offsetTop(element, accumulator = 0) {
    const top = accumulator + element.offsetTop;
    return element.offsetParent
      ? offsetTop(element.offsetParent, top)
      : top;
  }

  function offsetLeft(element, accumulator = 0) {
    const left = accumulator + element.offsetLeft;
    return element.offsetParent
      ? offsetLeft(element.offsetParent, left)
      : left;
  }

  function scrollTop(element, accumulator = 0) {
    const top = accumulator + element.scrollTop;
    return element.offsetParent
      ? scrollTop(element.offsetParent, top)
      : top + window.scrollY;
  }

  function scrollLeft(element, accumulator = 0) {
    const left = accumulator + element.scrollLeft;
    return element.offsetParent
      ? scrollLeft(element.offsetParent, left)
      : left + window.scrollX;
  }

  class SnapElement {
    constructor(element, {
      align = ['start'],
      ignoreSticky = true,
      ignoreTransform = false,
      threshold = null
    } = {}) {
      this.rect = {};
      this.element = element;
      this.options = { align, ignoreSticky, ignoreTransform, threshold };
      this.align = [align].flat();

      this.onWrapperResize = () => {
        let top, left;
        if (this.options.ignoreSticky) removeParentSticky(this.element);
        if (this.options.ignoreTransform) {
          top = offsetTop(this.element);
          left = offsetLeft(this.element);
        } else {
          const r = this.element.getBoundingClientRect();
          top = r.top + scrollTop(this.element);
          left = r.left + scrollLeft(this.element);
        }
        if (this.options.ignoreSticky) addParentSticky(this.element);
        this.setRect({ top, left });
      };

      this.onResize = ([entry]) => {
        if (!entry?.borderBoxSize?.[0]) return;
        this.setRect({
          width: entry.borderBoxSize[0].inlineSize,
          height: entry.borderBoxSize[0].blockSize
        });
      };

      this.wrapperResizeObserver = new ResizeObserver(this.onWrapperResize);
      this.wrapperResizeObserver.observe(document.body);

      this.resizeObserver = new ResizeObserver(this.onResize);
      this.resizeObserver.observe(this.element);

      // initialize
      this.onWrapperResize();
      this.setRect({
        width: this.element.offsetWidth,
        height: this.element.offsetHeight
      });
    }

    destroy() {
      this.wrapperResizeObserver.disconnect();
      this.resizeObserver.disconnect();
    }

    setRect({ top, left, width, height, element } = {}) {
      top = top ?? this.rect.top;
      left = left ?? this.rect.left;
      width = width ?? this.rect.width;
      height = height ?? this.rect.height;
      element = element ?? this.rect.element;

      if (
        top === this.rect.top &&
        left === this.rect.left &&
        width === this.rect.width &&
        height === this.rect.height &&
        element === this.rect.element
      ) return;

      this.rect = {
        top,
        y: top,
        left,
        x: left,
        width,
        height,
        bottom: top + height,
        right: left + width,
        element
      };
    }
  }

  let uidCounter = 0;
  function uid() {
    return uidCounter++;
  }

  // ---------------------- Snap class itself -----------------------------

  class Snap {
    constructor(lenis, {
      type = 'mandatory',
      lerp,
      easing,
      duration,
      velocityThreshold = 1,
      debounce: debounceDelay = 0,
      onSnapStart,
      onSnapComplete
    } = {}) {
      this.lenis = lenis;
      this.elements = new Map();
      this.snaps = new Map();
      this.viewport = {
        width: window.innerWidth,
        height: window.innerHeight
      };
      this.isStopped = false;

      this.options = {
        type,
        lerp,
        easing,
        duration,
        velocityThreshold,
        debounce: debounceDelay,
        onSnapStart,
        onSnapComplete
      };

      this.onWindowResize = () => {
        this.viewport.width = window.innerWidth;
        this.viewport.height = window.innerHeight;
      };

      this.onScroll = ({ lastVelocity, velocity, userData }) => {
        if (this.isStopped) return;
        const decel = Math.abs(lastVelocity) > Math.abs(velocity);
        const turningBack = Math.sign(lastVelocity) !== Math.sign(velocity) && velocity !== 0;
        if (
          Math.abs(velocity) < this.options.velocityThreshold &&
          decel &&
          !turningBack &&
          userData?.initiator !== 'snap'
        ) {
          this.debouncedSnap();
        }
      };

      this.onSnap = () => {
        let scrollPos = Math.ceil(this.lenis.scroll);
        const { isHorizontal } = this.lenis;

        // gather primitive snaps
        const candidates = [...this.snaps.values()];

        // gather element snaps
        this.elements.forEach(({ rect, align, options }, id) => {
          align.forEach(a => {
            let value;
            if (a === 'start') value = rect.top;
            else if (a === 'center') {
              value = isHorizontal
                ? rect.left + rect.width/2 - this.viewport.width/2
                : rect.top + rect.height/2 - this.viewport.height/2;
            } else if (a === 'end') {
              value = isHorizontal
                ? rect.left + rect.width - this.viewport.width
                : rect.top + rect.height - this.viewport.height;
            }
            if (typeof value === 'number') {
              candidates.push({ value: Math.ceil(value), elementObj: this.elements.get(id) });
            }
          });
        });

        // sort by proximity
        candidates.sort((a, b) => Math.abs(a.value - scrollPos) - Math.abs(b.value - scrollPos));

        // find within threshold
        let chosen = null;
        for (const c of candidates) {
          const threshold = c.elementObj
            ? (typeof c.elementObj.options.threshold === 'number'
                ? c.elementObj.options.threshold
                : c.elementObj.rect.height)
            : (isHorizontal ? this.viewport.width : this.viewport.height);
          if (Math.abs(scrollPos - c.value) <= threshold/2) {
            chosen = c;
            break;
          }
        }

        // decide and snap
        if (this.options.type === 'mandatory' || chosen) {
          const target = chosen || candidates[0];
          this.lenis.scrollTo(target.value, {
            lerp: this.options.lerp,
            easing: this.options.easing,
            duration: this.options.duration,
            userData: { initiator: 'snap' },
            onStart: () => this.options.onSnapStart?.(target),
            onComplete: () => this.options.onSnapComplete?.(target)
          });
        }
      };

      this.debouncedSnap = debounce(this.onSnap, this.options.debounce);

      // hook in
      window.addEventListener('resize', this.onWindowResize, false);
      this.lenis.on('scroll', this.onScroll);
      this.onWindowResize();
    }

    destroy() {
      this.lenis.off('scroll', this.onScroll);
      window.removeEventListener('resize', this.onWindowResize, false);
      this.elements.forEach(el => el.destroy());
    }

    start() {
      this.isStopped = false;
    }

    stop() {
      this.isStopped = true;
    }

    add(value, userData = {}) {
      const id = uid();
      this.snaps.set(id, { value, userData });
      return () => this.snaps.delete(id);
    }

    remove(id) {
      this.snaps.delete(id);
    }

    addElement(element, options = {}) {
      const id = uid();
      this.elements.set(id, new SnapElement(element, options));
      return () => this.removeElement(id);
    }

    removeElement(id) {
      const inst = this.elements.get(id);
      inst?.destroy();
      this.elements.delete(id);
    }
  }

  // Expose the Snap constructor
  return Snap;
}));
