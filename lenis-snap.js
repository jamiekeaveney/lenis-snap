// lenis-snap.js

// ————————————————————————————————————————————————
// UTILITY FUNCTIONS
// ————————————————————————————————————————————————

function debounce(callback, delay) {
  let timer;
  return function(...args) {
    let context = this;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = void 0;
      callback.apply(context, args);
    }, delay);
  };
}

function removeParentSticky(element) {
  const position = getComputedStyle(element).position;
  const isSticky = position === "sticky";
  if (isSticky) {
    element.style.setProperty("position", "static");
    element.dataset.sticky = "true";
  }
  if (element.offsetParent) {
    removeParentSticky(element.offsetParent);
  }
}

function addParentSticky(element) {
  var _a;
  if (((_a = element?.dataset)?.sticky) === "true") {
    element.style.removeProperty("position");
    delete element.dataset.sticky;
  }
  if (element.offsetParent) {
    addParentSticky(element.offsetParent);
  }
}

function offsetTop(element, accumulator = 0) {
  const top = accumulator + element.offsetTop;
  if (element.offsetParent) {
    return offsetTop(element.offsetParent, top);
  }
  return top;
}

function offsetLeft(element, accumulator = 0) {
  const left = accumulator + element.offsetLeft;
  if (element.offsetParent) {
    return offsetLeft(element.offsetParent, left);
  }
  return left;
}

function scrollTop(element, accumulator = 0) {
  const top = accumulator + element.scrollTop;
  if (element.offsetParent) {
    return scrollTop(element.offsetParent, top);
  }
  return top + window.scrollY;
}

function scrollLeft(element, accumulator = 0) {
  const left = accumulator + element.scrollLeft;
  if (element.offsetParent) {
    return scrollLeft(element.offsetParent, left);
  }
  return left + window.scrollX;
}

// ————————————————————————————————————————————————
// SNAP ELEMENT WRAPPER
// ————————————————————————————————————————————————

class SnapElement {
  constructor(element, {
    align = ["start"],
    ignoreSticky = true,
    ignoreTransform = false,
    threshold = null      // optional custom threshold in px
  } = {}) {
    this.rect = {};
    this.element = element;
    this.options = { align, ignoreSticky, ignoreTransform, threshold };
    this.align = [align].flat();

    this.wrapperResizeObserver = new ResizeObserver(this.onWrapperResize);
    this.wrapperResizeObserver.observe(document.body);
    this.onWrapperResize();

    this.resizeObserver = new ResizeObserver(this.onResize);
    this.resizeObserver.observe(this.element);

    this.setRect({
      width: this.element.offsetWidth,
      height: this.element.offsetHeight
    });
  }

  onWrapperResize = () => {
    let top, left;
    if (this.options.ignoreSticky) removeParentSticky(this.element);

    if (this.options.ignoreTransform) {
      top  = offsetTop(this.element);
      left = offsetLeft(this.element);
    } else {
      const rect = this.element.getBoundingClientRect();
      top  = rect.top  + scrollTop(this.element);
      left = rect.left + scrollLeft(this.element);
    }

    if (this.options.ignoreSticky) addParentSticky(this.element);
    this.setRect({ top, left });
  }

  onResize = ([entry]) => {
    if (!entry?.borderBoxSize?.[0]) return;
    const width  = entry.borderBoxSize[0].inlineSize;
    const height = entry.borderBoxSize[0].blockSize;
    this.setRect({ width, height });
  }

  setRect({ top, left, width, height, element } = {}) {
    top    = top    != null ? top    : this.rect.top;
    left   = left   != null ? left   : this.rect.left;
    width  = width  != null ? width  : this.rect.width;
    height = height != null ? height : this.rect.height;
    element= element!= null ? element: this.rect.element;

    if (
      top    === this.rect.top &&
      left   === this.rect.left &&
      width  === this.rect.width &&
      height === this.rect.height &&
      element=== this.rect.element
    ) return;

    this.rect.top    = top;
    this.rect.y      = top;
    this.rect.left   = left;
    this.rect.x      = left;
    this.rect.width  = width;
    this.rect.height = height;
    this.rect.bottom = top + height;
    this.rect.right  = left + width;
    this.rect.element= element;
  }

  destroy() {
    this.wrapperResizeObserver.disconnect();
    this.resizeObserver.disconnect();
  }
}

// ————————————————————————————————————————————————
// SNAP CLASS
// ————————————————————————————————————————————————

let index = 0;
function uid() { return index++; }

class Snap {
  constructor(lenis, {
    type = "mandatory",
    lerp,
    easing,
    duration,
    velocityThreshold = 1,
    debounce: debounceDelay = 0,
    onSnapStart,
    onSnapComplete,
    predictionMultiplier = 24,
    predictiveThreshold  = 0.15,
    lockoutMs             = 250
  } = {}) {
    this.lenis    = lenis;
    this.elements = new Map();
    this.snaps    = new Map();
    this.viewport = { width: window.innerWidth, height: window.innerHeight };
    this.isStopped      = false;

    this._wheelLocked   = false;
    this._lastWheelTime = 0;
    this._currentScroll = 0;

    this.onWindowResize = () => {
      this.viewport.width  = window.innerWidth;
      this.viewport.height = window.innerHeight;
    };
    window.addEventListener("resize", this.onWindowResize, false);

    this.lenis.on("scroll", ({ scroll }) => {
      this._currentScroll = scroll;
    });

    // — predictive wheel listener
    this.onWheel = e => {
      if (this._wheelLocked) return;
      if (Math.abs(e.deltaY) < 1) return;

      const now = performance.now();
      if (now - this._lastWheelTime < 32) return;
      this._lastWheelTime = now;

      // UPDATED: use this.options.lerp for factor
      const factor    = this.options.predictionMultiplier * (1 - this.options.lerp);
      const predicted = this._currentScroll + e.deltaY * factor;
      const zonePx    = this.viewport.height * this.options.predictiveThreshold;

      const candidates = [];
      this.snaps.forEach(({ value }) => candidates.push(value));
      this.elements.forEach(elObj => {
        const r = elObj.rect;
        candidates.push(Math.ceil(r.top + r.height/2 - this.viewport.height/2));
      });

      const dest = candidates.reduce((best, v) =>
        Math.abs(v - predicted) < Math.abs(best - predicted) ? v : best
      , candidates[0]);

      if (Math.abs(predicted - dest) <= zonePx) {
        e.preventDefault();
        this._wheelLocked = true;

        this.lenis.scrollTo(dest, {
          lerp: this.options.lerp,
          easing: t => 1 - (1 - t)**2.5,
          duration: this.options.duration ?? 0.6,
          userData: { initiator: "predict" },
          onStart:    () => onSnapStart?.({ value: dest, userData: {} }),
          onComplete: () => {
            onSnapComplete?.({ value: dest, userData: {} });
            setTimeout(() => this._wheelLocked = false, this.options.lockoutMs);
          }
        });
      }
    };
    window.addEventListener("wheel", this.onWheel, { passive:false });

    this.onScroll = ({ lastVelocity, velocity, userData }) => {
      if (this.isStopped) return;
      const isDecel    = Math.abs(lastVelocity) > Math.abs(velocity);
      const isTurnBack = Math.sign(lastVelocity) !== Math.sign(velocity) && velocity !== 0;
      if (
        Math.abs(velocity) < this.options.velocityThreshold &&
        isDecel &&
        !isTurnBack &&
        userData?.initiator !== "snap" &&
        userData?.initiator !== "predict"
      ) {
        this.onSnapDebounced();
      }
    };
    this.lenis.on("scroll", this.onScroll);

    this.onSnap = () => {
      let { scroll, isHorizontal } = this.lenis;
      scroll = Math.ceil(scroll);
      let snaps = [];

      this.snaps.forEach(({ value, userData }) => {
        snaps.push({ value, userData });
      });

      this.elements.forEach(elementObj => {
        const { rect, align } = elementObj;
        align.forEach(align2 => {
          let value;
          if (align2 === "start") {
            value = rect.top;
          } else if (align2 === "center") {
            value = isHorizontal
              ? rect.left + rect.width/2 - this.viewport.width/2
              : rect.top  + rect.height/2 - this.viewport.height/2;
          } else {
            value = isHorizontal
              ? rect.left + rect.width - this.viewport.width
              : rect.top  + rect.height - this.viewport.height;
          }
          if (typeof value === "number") {
            snaps.push({ 
              value: Math.ceil(value),
              elementObj
            });
          }
        });
      });

      snaps = snaps.sort((a,b) => Math.abs(a.value - scroll) - Math.abs(b.value - scroll));
      let prevSnap = snaps.filter(s => s.value <= scroll).slice(-1)[0] || snaps[0];
      let nextSnap = snaps.filter(s => s.value >= scroll)[0] || snaps[snaps.length-1];
      const chosen = (scroll - prevSnap.value) < (nextSnap.value - scroll) ? prevSnap : nextSnap;
      const distance = Math.abs(scroll - chosen.value);

      let threshold;
      if (chosen.elementObj) {
        const custom = chosen.elementObj.options.threshold;
        threshold = typeof custom === "number" ? custom : chosen.elementObj.rect.height;
      } else {
        threshold = isHorizontal ? this.viewport.width : this.viewport.height;
      }

      if (
        this.options.type === "mandatory" ||
        (this.options.type === "proximity" && distance <= threshold)
      ) {
        this.lenis.scrollTo(chosen.value, {
          lerp: this.options.lerp,
          easing: this.options.easing,
          duration: this.options.duration,
          userData: { initiator: "snap" },
          onStart:    () => onSnapStart?.(chosen),
          onComplete: () => onSnapComplete?.(chosen)
        });
      }
    };
    this.onSnapDebounced = debounce(this.onSnap, debounceDelay);

    this.options = {
      type, lerp, easing, duration,
      velocityThreshold,
      debounce: debounceDelay,
      onSnapStart,
      onSnapComplete,
      predictionMultiplier,
      predictiveThreshold,
      lockoutMs
    };
  }

  destroy() {
    this.isStopped = true;
    this.lenis.off("scroll", this.onScroll);
    window.removeEventListener("resize", this.onWindowResize, false);
    window.removeEventListener("wheel", this.onWheel);
    this.elements.forEach(el => el.destroy());
  }

  start() { this.isStopped = false; }
  stop()  { this.isStopped = true;  }

  add(value, userData = {}) {
    const id = uid();
    this.snaps.set(id, { value, userData });
    return () => this.remove(id);
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
    this.elements.delete(id);
  }
}

export { Snap };
