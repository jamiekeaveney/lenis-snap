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
    ignoreTransform = false
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
    this.options = { align, ignoreSticky, ignoreTransform };
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
      if (Math.abs(velocity) < this.options.velocityThreshold && isDecelerating && !isTurningBack && (userData == null ? void 0 : userData.initiator) !== "snap") {
        this.onSnapDebounced();
      }
    };
    this.onSnap = () => {
      let { scroll, isHorizontal } = this.lenis;
      scroll = Math.ceil(this.lenis.scroll);
      let snaps = [...this.snaps.values()];
      this.elements.forEach(({ rect, align }) => {
        let value;
        align.forEach((align2) => {
          if (align2 === "start") {
            value = rect.top;
          } else if (align2 === "center") {
            value = isHorizontal ? rect.left + rect.width / 2 - this.viewport.width / 2 : rect.top + rect.height / 2 - this.viewport.height / 2;
          } else if (align2 === "end") {
            value = isHorizontal ? rect.left + rect.width - this.viewport.width : rect.top + rect.height - this.viewport.height;
          }
          if (typeof value === "number") {
            snaps.push({ value: Math.ceil(value), userData: {} });
          }
        });
      });
      snaps = snaps.sort((a, b) => Math.abs(a.value) - Math.abs(b.value));
      let prevSnap = snaps.findLast(({ value }) => value <= scroll);
      if (prevSnap === void 0)
        prevSnap = snaps[0];
      const distanceToPrevSnap = Math.abs(scroll - prevSnap.value);
      let nextSnap = snaps.find(({ value }) => value >= scroll);
      if (nextSnap === void 0)
        nextSnap = snaps[snaps.length - 1];
      const distanceToNextSnap = Math.abs(scroll - nextSnap.value);
      const snap = distanceToPrevSnap < distanceToNextSnap ? prevSnap : nextSnap;
      const distance = Math.abs(scroll - snap.value);
      if (this.options.type === "mandatory" || this.options.type === "proximity" && distance <= (isHorizontal ? this.lenis.dimensions.width : this.lenis.dimensions.height)) {
        this.lenis.scrollTo(snap.value, {
          lerp: this.options.lerp,
          easing: this.options.easing,
          duration: this.options.duration,
          userData: { initiator: "snap" },
          onStart: () => {
            var _a, _b;
            (_b = (_a = this.options).onSnapStart) == null ? void 0 : _b.call(_a, snap);
          },
          onComplete: () => {
            var _a, _b;
            (_b = (_a = this.options).onSnapComplete) == null ? void 0 : _b.call(_a, snap);
          }
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
      onSnapComplete
    };
    this.onWindowResize();
    window.addEventListener("resize", this.onWindowResize, false);
    this.onSnapDebounced = debounce(this.onSnap, this.options.debounce);
    this.lenis.on("scroll", this.onScroll);
  }
  destroy() {
    this.lenis.off("scroll", this.onScroll);
    window.removeEventListener("resize", this.onWindowResize, false);
    this.elements.forEach((element) => element.destroy());
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
