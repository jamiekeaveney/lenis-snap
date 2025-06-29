/**
 * A debounce function that delays invoking a callback until after a specified
 * wait time has elapsed since the last time it was invoked.
 * @param {Function} callback The function to debounce.
 * @param {number} delay The number of milliseconds to delay.
 * @returns {Function} The new debounced function.
 */
function debounce(callback, delay) {
  let timer;
  return function (...args) {
    const context = this;
    clearTimeout(timer);
    timer = setTimeout(() => {
      callback.apply(context, args);
    }, delay);
  };
}

/**
 * Recursively traverses up the DOM tree from the given element and sets
 * the position of any 'sticky' parent elements to 'static'. This is used
 * to calculate the element's absolute position without being affected by
 * sticky positioning.
 * @param {HTMLElement} element The element to start from.
 */
function removeParentSticky(element) {
  if (!element) return;
  const position = getComputedStyle(element).position;
  if (position === "sticky") {
    element.style.setProperty("position", "static");
    element.dataset.sticky = "true";
  }
  if (element.offsetParent instanceof HTMLElement) {
    removeParentSticky(element.offsetParent);
  }
}

/**
 * Recursively restores the 'sticky' position to parent elements that were
 * modified by removeParentSticky.
 * @param {HTMLElement} element The element to start from.
 */
function addParentSticky(element) {
  if (!element) return;
  if (element.dataset?.sticky === "true") {
    element.style.removeProperty("position");
    delete element.dataset.sticky;
  }
  if (element.offsetParent instanceof HTMLElement) {
    addParentSticky(element.offsetParent);
  }
}

/**
 * A class to represent an element that can be snapped to. It handles
 * observing the element's position and dimensions.
 */
class SnapElement {
  constructor(element, {
    align = ["start"],
    ignoreSticky = true
  } = {}) {
    this.rect = {};

    this.onWrapperResize = () => {
      if (this.options.ignoreSticky) {
        removeParentSticky(this.element);
      }
      
      const rect = this.element.getBoundingClientRect();
      const top = rect.top + window.scrollY;
      const left = rect.left + window.scrollX;

      if (this.options.ignoreSticky) {
        addParentSticky(this.element);
      }
      
      this.setRect({ top, left });
    };

    this.onResize = ([entry]) => {
      if (!entry?.borderBoxSize[0]) return;
      const { inlineSize: width, blockSize: height } = entry.borderBoxSize[0];
      this.setRect({ width, height });
    };

    this.element = element;
    this.options = { align, ignoreSticky };
    this.align = Array.isArray(align) ? align : [align];

    this.wrapperResizeObserver = new ResizeObserver(debounce(this.onWrapperResize, 100));
    this.wrapperResizeObserver.observe(document.body);

    this.resizeObserver = new ResizeObserver(this.onResize);
    this.resizeObserver.observe(this.element);
    
    // Initial calculation
    this.onWrapperResize();
    this.setRect({
        width: this.element.offsetWidth,
        height: this.element.offsetHeight,
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
    height
  } = {}) {
    const newTop = top ?? this.rect.top;
    const newLeft = left ?? this.rect.left;
    const newWidth = width ?? this.rect.width;
    const newHeight = height ?? this.rect.height;

    if (
      newTop === this.rect.top &&
      newLeft === this.rect.left &&
      newWidth === this.rect.width &&
      newHeight === this.rect.height
    ) {
      return;
    }

    this.rect = {
      top: newTop,
      left: newLeft,
      width: newWidth,
      height: newHeight,
      y: newTop,
      x: newLeft,
      bottom: newTop + newHeight,
      right: newLeft + newWidth,
    };
  }
}

// Simple unique ID generator
let uidCounter = 0;
function uid() {
  return uidCounter++;
}


/**
 * Predicts the final scroll position based on current velocity and friction.
 * @param {number} currentY The current scroll position.
 * @param {number} velocity The current scroll velocity.
 * @param {number} friction The friction factor (0 to 1).
 * @param {number} maxFrames The maximum number of frames to simulate.
 * @returns {number} The predicted final scroll position.
 */
function predictScrollEnd(currentY, velocity, friction = 0.1, maxFrames = 60) {
  let predictedY = currentY;
  let v = velocity;

  for (let i = 0; i < maxFrames; i++) {
    v *= (1 - friction);
    predictedY += v;
    if (Math.abs(v) < 0.1) break;
  }

  return predictedY;
}

/**
 * The main Snap class that integrates with a Lenis instance to provide
 * scroll snapping functionality.
 */
class Snap {
  constructor(lenis, options = {}) {
    const {
      type = "mandatory",
      lerp,
      easing,
      duration,
      velocityThreshold = 1,
      onSnapStart,
      onSnapComplete
    } = options;

    this.options = {
      type,
      lerp,
      easing,
      duration,
      velocityThreshold,
      onSnapStart,
      onSnapComplete
    };

    this.lenis = lenis;
    this.elements = new Map();
    this.viewport = {
      width: window.innerWidth,
      height: window.innerHeight
    };
    this.isStopped = false;

    // Bind methods
    this.onWindowResize = this.onWindowResize.bind(this);
    this.onScroll = this.onScroll.bind(this);

    // Attach event listeners
    window.addEventListener("resize", this.onWindowResize, false);
    this.lenis.on("scroll", this.onScroll);
  }

  // Handle window resize
  onWindowResize() {
    this.viewport.width = window.innerWidth;
    this.viewport.height = window.innerHeight;
  }

  // Handle scroll events to determine when to snap
  onScroll({ lastVelocity, velocity, userData }) {
    if (this.isStopped || this.elements.size === 0) return;

    const isDecelerating = Math.abs(lastVelocity) > Math.abs(velocity);
    const isTurningBack = Math.sign(lastVelocity) !== Math.sign(velocity) && velocity !== 0;

    if (
      Math.abs(velocity) < this.options.velocityThreshold &&
      isDecelerating &&
      !isTurningBack &&
      userData?.initiator !== "snap"
    ) {
      // Predict where the scroll will end and snap to the closest element
      const predictedY = predictScrollEnd(this.lenis.scroll, velocity, 0.15, 80);
      this.snapToClosest(predictedY);
    }
  }

  // Find the closest snap point and scroll to it
  snapToClosest(targetY) {
    let closest = null;
    let closestDist = Infinity;

    this.elements.forEach(elementObj => {
      const { rect, align, options } = elementObj;

      align.forEach(a => {
        let value;

        if (a === "start") {
          value = rect.top;
        } else if (a === "center") {
          value = rect.top + rect.height / 2 - this.viewport.height / 2;
        } else if (a === "end") {
          value = rect.top + rect.height - this.viewport.height;
        }
        
        // Ensure value is within scrollable bounds
        value = Math.max(0, Math.min(value, this.lenis.limit));

        const dist = Math.abs(value - targetY);

        // Use custom threshold if provided, otherwise check against closest distance
        const threshold = options.threshold ?? Infinity;

        if (dist < threshold && dist < closestDist) {
          closest = { value, elementObj };
          closestDist = dist;
        }
      });
    });

    if (closest) {
      this.lenis.scrollTo(closest.value, {
        lerp: this.options.lerp,
        easing: this.options.easing,
        duration: this.options.duration,
        userData: { initiator: "snap" },
        onStart: () => this.options.onSnapStart?.(closest),
        onComplete: () => this.options.onSnapComplete?.(closest),
      });
    }
  }

  // Clean up all event listeners and observers
  destroy() {
    this.lenis.off("scroll", this.onScroll);
    window.removeEventListener("resize", this.onWindowResize, false);
    this.elements.forEach(el => el.destroy());
    this.elements.clear();
  }

  start() {
    this.isStopped = false;
  }

  stop() {
    this.isStopped = true;
  }

  addElement(element, options = {}) {
    const id = uid();
    const snapElement = new SnapElement(element, options);
    this.elements.set(id, snapElement);
    
    // Return a function to remove the element
    return () => this.removeElement(id);
  }

  removeElement(id) {
    const element = this.elements.get(id);
    if (element) {
        element.destroy();
        this.elements.delete(id);
    }
  }
}

export { Snap };
