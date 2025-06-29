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

function predictScrollEnd(currentY, velocity, friction = 0.1, maxFrames = 60) {
  let predictedY = currentY;
  let v = velocity;

  for (let i = 0; i < maxFrames; i++) {
    v *= 1 - friction;
    predictedY += v;
    if (Math.abs(v) < 0.1) break;
  }

  return predictedY;
}

class Snap {
  constructor(lenis, options = {}) {
    const {
      type = "mandatory",
      lerp,
      easing,
      duration,
      velocityThreshold = 1,
      debounce: debounceDelay = 0,
      onSnapStart,
      onSnapComplete
    } = options;

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

    this.lenis = lenis;
    this.elements = new Map();
    this.snaps = new Map();
    this.viewport = {
      width: window.innerWidth,
      height: window.innerHeight
    };
    this.isStopped = false;

    // Bind methods BEFORE using them
    this.onWindowResize = this.onWindowResize.bind(this);
    this.onScroll = this.onScroll.bind(this);
    this.snapToClosest = this.snapToClosest.bind(this);
    this._onSnap = this._onSnap.bind(this); // note: renamed to avoid conflict

    // Debounced version of snap callback
    this.onSnapDebounced = debounce(this._onSnap, this.options.debounce);

    // Add event listeners
    window.addEventListener("resize", this.onWindowResize, false);
    this.lenis.on("scroll", this.onScroll);
  }

  onScroll({ lastVelocity, velocity, userData }) {
    if (this.isStopped) return;

    const isDecelerating = Math.abs(lastVelocity) > Math.abs(velocity);
    const isTurningBack = Math.sign(lastVelocity) !== Math.sign(velocity) && velocity !== 0;

    if (
      Math.abs(velocity) < this.options.velocityThreshold &&
      isDecelerating &&
      !isTurningBack &&
      userData?.initiator !== "snap"
    ) {
      const predictedY = predictScrollEnd(this.lenis.scroll, velocity);
      this.snapToClosest(predictedY);
    }
  }

  snapToClosest(targetY) {
    let closest = null;
    let closestDist = Infinity;

    this.elements.forEach(elementObj => {
      const { rect, align } = elementObj;
      align.forEach(a => {
        let value;

        if (a === "start") {
          value = rect.top;
        } else if (a === "center") {
          value = rect.top + rect.height / 2 - this.viewport.height / 2;
        } else if (a === "end") {
          value = rect.top + rect.height - this.viewport.height;
        }

        let dist = Math.abs(value - targetY);
        if (dist < closestDist) {
          closest = { value, elementObj };
          closestDist = dist;
        }
      });
    });

    if (closest) {
      this.lenis.scrollTo(closest.value, {
        lerp: this.options.lerp,
        easing: this.options.easing,
        userData: { initiator: "snap" },
        onStart: () => this.options.onSnapStart?.(closest),
        onComplete: () => this.options.onSnapComplete?.(closest),
      });
    }
  }

  destroy() {
    this.lenis.off("scroll", this.onScroll);
    window.removeEventListener("resize", this.onWindowResize, false);
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
