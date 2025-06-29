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
  if (((_a = element == null ? void 0 : element.dataset) == null ? void 0 : _a.sticky) === "true") {
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
class SnapElement {
  constructor(element, {
    align = ["start"],
    ignoreSticky = true,
    ignoreTransform = false,
    threshold = null      // ← optional custom threshold in px
  } = {}) {
    this.rect = {};
    this.onWrapperResize = () => {
      let top, left;
      if (this.options.ignoreSticky)
        removeParentSticky(this.element);
      if (this.options.ignoreTransform) {
        top = offsetTop(this.element);
        left = offsetLeft(this.element);
      } else {
        const rect = this.element.getBoundingClientRect();
        top = rect.top + scrollTop(this.element);
        left = rect.left + scrollLeft(this.element);
      }
      if (this.options.ignoreSticky)
        addParentSticky(this.element);
      this.setRect({ top, left });
    };
    this.onResize = ([entry]) => {
      if (!(entry == null ? void 0 : entry.borderBoxSize[0]))
        return;
      const width = entry.borderBoxSize[0].inlineSize;
      const height = entry.borderBoxSize[0].blockSize;
      this.setRect({ width, height });
    };
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
  destroy() {
    this.wrapperResizeObserver.disconnect();
    this.resizeObserver.disconnect();
  }
  setRect({
    top,
    left,
    width,
    height,
    element
  } = {}) {
    top = top != null ? top : this.rect.top;
    left = left != null ? left : this.rect.left;
    width = width != null ? width : this.rect.width;
    height = height != null ? height : this.rect.height;
    element = element != null ? element : this.rect.element;
    if (top === this.rect.top && left === this.rect.left && width === this.rect.width && height === this.rect.height && element === this.rect.element)
      return;
    this.rect.top = top;
    this.rect.y = top;
    this.rect.width = width;
    this.rect.height = height;
    this.rect.left = left;
    this.rect.x = left;
    this.rect.bottom = top + height;
    this.rect.right = left + width;
  }
}
let index = 0;
function uid() {
  return index++;
}
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

    // ← NEW predictive options
    predictionMultiplier = 14,      // pixels to look ahead per deltaY unit
    predictiveThreshold = 0.1,      // fraction of viewport height
    lockoutMs = 300                 // ms cooldown after a predictive snap
  } = {}) {
    this.lenis = lenis;
    this.elements = new Map();
    this.snaps = new Map();
    this.viewport = {
      width: window.innerWidth,
      height: window.innerHeight
    };
    this.isStopped      = false;
    this._wheelLocked   = false;    // ← NEW
    this._lastWheelTime = 0;        // ← NEW

    this.onWindowResize = () => {
      this.viewport.width = window.innerWidth;
      this.viewport.height = window.innerHeight;
    };

    this.onScroll = ({
      lastVelocity,
      velocity,
      userData
    }) => {
      if (this.isStopped)
        return;
      const isDecelerating = Math.abs(lastVelocity) > Math.abs(velocity);
      const isTurningBack = Math.sign(lastVelocity) !== Math.sign(velocity) && velocity !== 0;
      if (
        Math.abs(velocity) < this.options.velocityThreshold &&
        isDecelerating &&
        !isTurningBack &&
        userData?.initiator !== "snap"
      ) {
        this.onSnapDebounced();
      }
    };

    // ← NEW wheel listener for predictive snapping
    this.onWheel = e => {
      if (this._wheelLocked) return;
      if (Math.abs(e.deltaY) < 1) return;

      const now = performance.now();
      if (now - this._lastWheelTime < this.options.lockoutMs) return;

      const current = this.lenis.scroll;
      const predicted = current + e.deltaY * this.options.predictionMultiplier;

      // gather all snap candidates
      let candidates = [];
      this.snaps.forEach(({ value, userData }) => {
        candidates.push({ value, userData });
      });
      this.elements.forEach(elObj => {
        const { rect, align } = elObj;
        align.forEach(a => {
          let v;
          if (a === "start") {
            v = rect.top;
          } else if (a === "center") {
            v = rect.top + rect.height / 2 - this.viewport.height / 2;
          } else { // "end"
            v = rect.top + rect.height - this.viewport.height;
          }
          candidates.push({ value: Math.ceil(v), elementObj: elObj });
        });
      });

      const nearest = candidates.reduce((best, cand) =>
        Math.abs(cand.value - predicted) < Math.abs(best.value - predicted) ? cand : best
      , candidates[0]);

      const zone = this.viewport.height * this.options.predictiveThreshold;
      if (Math.abs(predicted - nearest.value) <= zone) {
        e.preventDefault();
        this._wheelLocked = true;
        this._lastWheelTime = now;
        this.lenis.scrollTo(nearest.value, {
          lerp: this.options.lerp,
          easing: this.options.easing,
          duration: this.options.duration,
          userData: { initiator: "snap" },
          onStart:    () => onSnapStart?.(nearest),
          onComplete: () => {
            onSnapComplete?.(nearest);
            setTimeout(() => this._wheelLocked = false, this.options.lockoutMs);
          }
        });
      }
    };

    this.onSnap = () => {
      let { scroll, isHorizontal } = this.lenis;
      scroll = Math.ceil(this.lenis.scroll);
      let snaps = [];

      // 1) gather primitive snaps
      this.snaps.forEach(({ value, userData }) => {
        snaps.push({ value, userData });
      });

      // 2) gather element-based snaps
      this.elements.forEach(elementObj => {
        const { rect, align, options } = elementObj;
        align.forEach(align2 => {
          let value;
          if (align2 === "start") {
            value = rect.top;
          } else if (align2 === "center") {
            value = isHorizontal
              ? rect.left + rect.width / 2 - this.viewport.width / 2
              : rect.top + rect.height / 2 - this.viewport.height / 2;
          } else if (align2 === "end") {
            value = isHorizontal
              ? rect.left + rect.width - this.viewport.width
              : rect.top + rect.height - this.viewport.height;
          }
          if (typeof value === "number") {
            snaps.push({
              value: Math.ceil(value),
              elementObj   // carry the reference
            });
          }
        });
      });

      // sort by closeness
      snaps = snaps.sort((a, b) => Math.abs(a.value - scroll) - Math.abs(b.value - scroll));

      // pick nearest
      const prevSnap = snaps.filter(s => s.value <= scroll).slice(-1)[0] || snaps[0];
      const nextSnap = snaps.filter(s => s.value >= scroll)[0] || snaps[snaps.length - 1];
      const snap = (scroll - prevSnap.value) < (nextSnap.value - scroll) ? prevSnap : nextSnap;
      const distance = Math.abs(scroll - snap.value);

      // 3) threshold logic (unchanged)
      let threshold;
      if (snap.elementObj) {
        const custom = snap.elementObj.options.threshold;
        threshold = typeof custom === "number" ? custom : snap.elementObj.rect.height;
      } else {
        threshold = isHorizontal ? this.viewport.width : this.viewport.height;
      }

      // 4) do the snap if within threshold
      if (
        this.options.type === "mandatory" ||
        (this.options.type === "proximity" && distance <= threshold)
      ) {
        this.lenis.scrollTo(snap.value, {
          lerp: this.options.lerp,
          easing: this.options.easing,
          duration: this.options.duration,
          userData: { initiator: "snap" },
          onStart:    () => onSnapStart?.(snap),
          onComplete: () => onSnapComplete?.(snap)
        });
      }
    };

    this.options = {
      type,
      lerp,
      easing,
      duration,
      velocityThreshold,
      debounce: debounceDelay,
      onSnapStart,
      onSnapComplete,

      // ← copy in predictive options
      predictionMultiplier,
      predictiveThreshold,
      lockoutMs
    };
    this.onWindowResize();
    window.addEventListener("resize", this.onWindowResize, false);
    this.onSnapDebounced = debounce(this.onSnap, this.options.debounce);
    this.lenis.on("scroll", this.onScroll);
    window.addEventListener("wheel", this.onWheel, { passive: false });   // ← NEW
  }

  destroy() {
    this.lenis.off("scroll", this.onScroll);
    window.removeEventListener("resize", this.onWindowResize, false);
    window.removeEventListener("wheel", this.onWheel);                     // ← NEW
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
