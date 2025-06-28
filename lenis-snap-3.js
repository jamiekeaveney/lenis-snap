// lenis-snap-2.mjs

// ——————————————————————————————————————————————————
// debounce helper
function debounce(callback, delay) {
  let timer;
  return function (...args) {
    const ctx = this;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = void 0;
      callback.apply(ctx, args);
    }, delay);
  };
}

// ——————————————————————————————————————————————————
// sticky handling & offset helpers (unchanged)
function removeParentSticky(element) {
  const position = getComputedStyle(element).position;
  if (position === "sticky") {
    element.style.setProperty("position", "static");
    element.dataset.sticky = "true";
  }
  if (element.offsetParent) removeParentSticky(element.offsetParent);
}
function addParentSticky(element) {
  if (element?.dataset?.sticky === "true") {
    element.style.removeProperty("position");
    delete element.dataset.sticky;
  }
  if (element.offsetParent) addParentSticky(element.offsetParent);
}
function offsetTop(el, acc = 0) {
  const top = acc + el.offsetTop;
  return el.offsetParent ? offsetTop(el.offsetParent, top) : top;
}
function offsetLeft(el, acc = 0) {
  const left = acc + el.offsetLeft;
  return el.offsetParent ? offsetLeft(el.offsetParent, left) : left;
}
function scrollTop(el, acc = 0) {
  const top = acc + el.scrollTop;
  return el.offsetParent
    ? scrollTop(el.offsetParent, top)
    : top + window.scrollY;
}
function scrollLeft(el, acc = 0) {
  const left = acc + el.scrollLeft;
  return el.offsetParent
    ? scrollLeft(el.offsetParent, left)
    : left + window.scrollX;
}

// ——————————————————————————————————————————————————
// SnapElement (unchanged)
class SnapElement {
  constructor(element, { align = ["start"], ignoreSticky = true, ignoreTransform = false } = {}) {
    this.rect = {};
    this.element = element;
    this.options = { align, ignoreSticky, ignoreTransform };
    this.align = [align].flat();
    this.wrapperResizeObserver = new ResizeObserver(this.onWrapperResize);
    this.wrapperResizeObserver.observe(document.body);
    this.onWrapperResize();
    this.resizeObserver = new ResizeObserver(this.onResize);
    this.resizeObserver.observe(element);
    this.setRect({ width: element.offsetWidth, height: element.offsetHeight });
  }
  onWrapperResize = () => {
    if (this.options.ignoreSticky) removeParentSticky(this.element);
    let top, left;
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
  onResize = ([entry]) => {
    if (!entry?.borderBoxSize?.[0]) return;
    this.setRect({
      width: entry.borderBoxSize[0].inlineSize,
      height: entry.borderBoxSize[0].blockSize,
    });
  };
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
    )
      return;
    this.rect = { top, y: top, left, x: left, width, height, bottom: top + height, right: left + width, element };
  }
  destroy() {
    this.wrapperResizeObserver.disconnect();
    this.resizeObserver.disconnect();
  }
}

// ——————————————————————————————————————————————————
// UID helper
let _uid = 0;
function uid() {
  return _uid++;
}

// ——————————————————————————————————————————————————
// Snap core
class Snap {
  constructor(lenis, {
    type = "mandatory",
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
    this.viewport = { width: innerWidth, height: innerHeight };
    this.isStopped = false;
    this.options = {
      type,
      lerp,
      easing,
      duration,
      velocityThreshold,
      debounce: debounceDelay,
      onSnapStart,
      onSnapComplete,
      // ← NEW: proximity threshold override
      proximityThreshold: undefined
    };

    // update on resize
    window.addEventListener("resize", () => {
      this.viewport.width = window.innerWidth;
      this.viewport.height = window.innerHeight;
    });

    // debounced snap invocation
    this.onSnapDebounced = debounce(this.onSnap.bind(this), this.options.debounce);

    // listen to Lenis scroll
    lenis.on("scroll", this.onScroll.bind(this));
  }

  onScroll({ lastVelocity, velocity, userData }) {
    if (this.isStopped) return;
    const isDecel = Math.abs(lastVelocity) > Math.abs(velocity);
    const isRebound = Math.sign(lastVelocity) !== Math.sign(velocity) && velocity !== 0;
    if (
      Math.abs(velocity) < this.options.velocityThreshold &&
      isDecel &&
      !isRebound &&
      userData?.initiator !== "snap"
    ) {
      this.onSnapDebounced();
    }
  }

  onSnap() {
    let { scroll } = this.lenis;
    const isHorizontal = false; // vertical snap
    scroll = Math.ceil(scroll);

    // 1) gather all snap-points
    const points = [];
    for (let { value, userData } of this.snaps.values()) points.push({ value, userData });
    for (let el of this.elements.values()) {
      const { rect, align } = el;
      for (let mode of align) {
        let val;
        if (mode === "start") {
          val = rect.top;
        } else if (mode === "center") {
          val = rect.top + rect.height / 2 - this.viewport.height / 2;
        } else if (mode === "end") {
          val = rect.top + rect.height - this.viewport.height;
        }
        if (typeof val === "number") points.push({ value: Math.ceil(val), userData: {} });
      }
    }

    // 2) pick nearest snap
    points.sort((a, b) => Math.abs(a.value - scroll) - Math.abs(b.value - scroll));
    const snap = points[0];
    const distance = Math.abs(scroll - snap.value);

    // 3) compute threshold
    const fullView = isHorizontal
      ? this.lenis.dimensions.width
      : this.lenis.dimensions.height;
    const threshold =
      typeof this.options.proximityThreshold === "number"
        ? this.options.proximityThreshold
        : fullView;

    // 4) perform mandatory/proximity check
    if (
      this.options.type === "mandatory" ||
      (this.options.type === "proximity" && distance <= threshold)
    ) {
      this.lenis.scrollTo(snap.value, {
        lerp: this.options.lerp,
        easing: this.options.easing,
        duration: this.options.duration,
        userData: { initiator: "snap" },
        onStart: () => this.options.onSnapStart?.(snap),
        onComplete: () => this.options.onSnapComplete?.(snap)
      });
    }
  }

  destroy() {
    this.lenis.off("scroll", this.onScroll);
    this.elements.forEach(e => e.destroy());
  }

  start() { this.isStopped = false; }
  stop() { this.isStopped = true; }

  add(value, userData = {}) {
    const id = uid();
    this.snaps.set(id, { value, userData });
    return () => this.snaps.delete(id);
  }

  addElement(element, options = {}) {
    const id = uid();
    this.elements.set(id, new SnapElement(element, options));
    return () => this.elements.delete(id);
  }
}

export { Snap };
