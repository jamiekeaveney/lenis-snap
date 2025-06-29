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
    align = ["start"],
    ignoreSticky = true,
    ignoreTransform = false,
    threshold = null
  } = {}) {
    this.rect = {};
    this.element = element;
    this.options = { align, ignoreSticky, ignoreTransform, threshold };
    this.align = Array.isArray(align) ? align : [align];

    this.wrapperResizeObserver = new ResizeObserver(this.onWrapperResize);
    this.wrapperResizeObserver.observe(document.body);
    this.onWrapperResize();

    this.resizeObserver = new ResizeObserver(this.onResize);
    this.resizeObserver.observe(element);
    this.setRect({
      width: element.offsetWidth,
      height: element.offsetHeight
    });
  }

  onWrapperResize = () => {
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

  onResize = ([entry]) => {
    if (!entry?.borderBoxSize?.[0]) return;
    this.setRect({
      width: entry.borderBoxSize[0].inlineSize,
      height: entry.borderBoxSize[0].blockSize
    });
  };

  setRect({ top, left, width, height, element } = {}) {
    top     = top     ?? this.rect.top;
    left    = left    ?? this.rect.left;
    width   = width   ?? this.rect.width;
    height  = height  ?? this.rect.height;
    element = element ?? this.rect.element;
    if (
      top    === this.rect.top &&
      left   === this.rect.left &&
      width  === this.rect.width &&
      height === this.rect.height &&
      element=== this.rect.element
    ) return;

    this.rect = {
      top, y: top,
      left, x: left,
      width, height,
      bottom: top + height,
      right:  left + width,
      element
    };
  }

  destroy() {
    this.wrapperResizeObserver.disconnect();
    this.resizeObserver.disconnect();
  }
}

let _uid = 0;
function uid() {
  return _uid++;
}

class Snap {
  constructor(lenis, {
    type = "mandatory",
    lerp,
    easing,
    duration,
    velocityThreshold = 1,
    releaseVelocityThreshold = null,  // ← new
    debounce: debounceDelay = 0,
    onSnapStart,
    onSnapComplete
  } = {}) {
    this.lenis = lenis;
    this.elements = new Map();
    this.snaps    = new Map();
    this.viewport = { width: innerWidth, height: innerHeight };
    this.isStopped = false;

    this.options = {
      type, lerp, easing, duration,
      velocityThreshold,
      releaseVelocityThreshold,       // ← include
      debounce: debounceDelay,
      onSnapStart,
      onSnapComplete
    };

    window.addEventListener("resize", this.onWindowResize, false);
    this.onWindowResize();

    this.onSnapDebounced = debounce(this.onSnap, debounceDelay);
    this.lenis.on("scroll", this.onScroll);
  }

  onWindowResize = () => {
    this.viewport.width  = window.innerWidth;
    this.viewport.height = window.innerHeight;
  };

  onScroll = ({ lastVelocity, velocity, userData }) => {
    if (this.isStopped) return;

    const { velocityThreshold, releaseVelocityThreshold } = this.options;
    const isDecel    = Math.abs(lastVelocity) > Math.abs(velocity);
    const isTurningB = Math.sign(lastVelocity) !== Math.sign(velocity) && velocity !== 0;

    // 1) high-speed release snap
    if (
      releaseVelocityThreshold != null &&
      Math.abs(lastVelocity) >= releaseVelocityThreshold &&
      velocity === 0 &&
      userData?.initiator !== "snap"
    ) {
      this.onSnap();
      return;
    }

    // 2) low-velocity proximity snap (debounced)
    if (
      Math.abs(velocity) < velocityThreshold &&
      isDecel && !isTurningB &&
      userData?.initiator !== "snap"
    ) {
      this.onSnapDebounced();
    }
  };

  onSnap = () => {
    let { scroll, isHorizontal } = this.lenis;
    scroll = Math.ceil(scroll);

    // gather all snaps
    const snaps = [];
    this.snaps.forEach(({ value, userData }) => snaps.push({ value, userData }));
    this.elements.forEach(elementObj => {
      elementObj.align.forEach(a => {
        let value;
        const { rect } = elementObj;
        if (a === "start")  value = rect.top;
        if (a === "center") value = isHorizontal
          ? rect.left + rect.width  / 2 - this.viewport.width  / 2
          : rect.top  + rect.height / 2 - this.viewport.height / 2;
        if (a === "end")    value = isHorizontal
          ? rect.left + rect.width  - this.viewport.width
          : rect.top  + rect.height - this.viewport.height;
        if (typeof value === "number") snaps.push({
          value: Math.ceil(value),
          elementObj
        });
      });
    });

    // sort by absolute distance
    snaps.sort((a, b) => Math.abs(a.value - scroll) - Math.abs(b.value - scroll));

    // symmetric ± threshold/2 snapping
    let chosen = null;
    for (const s of snaps) {
      const custom = s.elementObj?.options.threshold;
      const threshold = typeof custom === "number"
        ? custom
        : (isHorizontal ? this.viewport.width : this.viewport.height);
      if (Math.abs(scroll - s.value) <= threshold / 2) {
        chosen = s;
        break;
      }
    }

    // finalize
    if (this.options.type === "mandatory" || chosen) {
      const snap = chosen || snaps[0];
      this.lenis.scrollTo(snap.value, {
        lerp:     this.options.lerp,
        easing:   this.options.easing,
        duration: this.options.duration,
        userData: { initiator: "snap" },
        onStart:  () => this.options.onSnapStart?.(snap),
        onComplete:() => this.options.onSnapComplete?.(snap)
      });
    }
  };

  destroy() {
    this.lenis.off("scroll", this.onScroll);
    window.removeEventListener("resize", this.onWindowResize, false);
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
