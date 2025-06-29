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
 * the position of any 'sticky' parent elements to 'static'.
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
 * Recursively restores the 'sticky' position to parent elements.
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
 * Predicts the final scroll position based on initial velocity and friction.
 * This simulates a momentum-based scroll coasting to a stop.
 * @param {number} currentY The current scroll position.
 * @param {number} velocity The current scroll velocity from Lenis.
 * @param {number} friction A value between 0 and 1; higher means less friction (coasts longer).
 * @returns {number} The predicted final scroll position.
 */
function predictScrollEnd(currentY, velocity, friction = 0.9) {
    let distance = 0;
    let v = velocity;
    let i = 0;
    const maxIterations = 200; // Safety break for the loop
    while (Math.abs(v) > 0.1 && i < maxIterations) {
        distance += v;
        v *= friction;
        i++;
    }
    return currentY + distance;
}


/**
 * Calculates the target scroll Y position for an element based on a given alignment.
 * @param {object} rect The element's position and dimensions object.
 * @param {'start'|'center'|'end'} align The desired alignment in the viewport.
 * @param {{width: number, height: number}} viewport The viewport dimensions.
 * @returns {number} The target scroll Y position.
 */
function calculateAlignedPosition(rect, align, viewport) {
    switch (align) {
        case "start":
            return rect.top;
        case "center":
            return rect.top + rect.height / 2 - viewport.height / 2;
        case "end":
            return rect.top + rect.height - viewport.height;
        default:
            return rect.top;
    }
}

/**
 * A class to represent an element that can be snapped to. It handles
 * observing the element's position and dimensions.
 */
class SnapElement {
  constructor(element, {
    align = ["start"],
    ignoreSticky = true,
    threshold = null
  } = {}) {
    this.rect = {};

    this.onWrapperResize = () => {
      if (this.options.ignoreSticky) removeParentSticky(this.element);
      
      const rect = this.element.getBoundingClientRect();
      const top = rect.top + window.scrollY;
      const left = rect.left + window.scrollX;

      if (this.options.ignoreSticky) addParentSticky(this.element);
      
      this.setRect({ top, left });
    };

    this.onResize = ([entry]) => {
      if (!entry?.borderBoxSize[0]) return;
      const { inlineSize: width, blockSize: height } = entry.borderBoxSize[0];
      this.setRect({ width, height });
    };

    this.element = element;
    this.options = { align, ignoreSticky, threshold };
    this.align = Array.isArray(align) ? align : [align];

    this.wrapperResizeObserver = new ResizeObserver(debounce(this.onWrapperResize, 100));
    this.wrapperResizeObserver.observe(document.body);

    this.resizeObserver = new ResizeObserver(this.onResize);
    this.resizeObserver.observe(this.element);
    
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

  setRect({ top, left, width, height } = {}) {
    const newTop = top ?? this.rect.top;
    const newLeft = left ?? this.rect.left;
    const newWidth = width ?? this.rect.width;
    const newHeight = height ?? this.rect.height;

    if (newTop === this.rect.top && newLeft === this.rect.left && newWidth === this.rect.width && newHeight === this.rect.height) return;

    this.rect = {
      top: newTop, left: newLeft, width: newWidth, height: newHeight,
      y: newTop, x: newLeft, bottom: newTop + newHeight, right: newLeft + newWidth,
    };
  }
}

// Simple unique ID generator
let uidCounter = 0;
function uid() {
  return uidCounter++;
}

/**
 * The main Snap class that integrates with a Lenis instance to provide
 * scroll snapping functionality.
 */
class Snap {
  constructor(lenis, options = {}) {
    const {
      type = "mandatory", lerp, easing, duration,
      velocityThreshold = 1.0, // Trigger snap if velocity is above this
      onSnapStart, onSnapComplete
    } = options;

    this.options = { type, lerp, easing, duration, velocityThreshold, onSnapStart, onSnapComplete };
    this.lenis = lenis;
    this.elements = new Map();
    this.viewport = { width: window.innerWidth, height: window.innerHeight };
    
    this.isStopped = false;
    this.isSnapping = false; // Flag to prevent re-triggering during a snap animation
    this.lastVelocity = 0;

    this.onWindowResize = this.onWindowResize.bind(this);
    this.onScroll = this.onScroll.bind(this);

    window.addEventListener("resize", this.onWindowResize, false);
    this.lenis.on("scroll", this.onScroll);
  }

  onWindowResize() {
    this.viewport.width = window.innerWidth;
    this.viewport.height = window.innerHeight;
  }

  onScroll({ velocity, userData, event }) {
    // Exit if snapping is paused, already in progress, or no elements are registered.
    if (this.isStopped || this.isSnapping || this.elements.size === 0) {
      this.lastVelocity = velocity;
      return;
    }

    // *** THE CRITICAL FIX IS HERE ***
    // If a native 'event' exists, the user is actively scrolling (e.g., turning the wheel).
    // We do not want to snap yet, so we just track the velocity and exit.
    if (event) {
        this.lastVelocity = velocity;
        return;
    }

    // If we've reached this point, the user has stopped direct input, and the scroll is "coasting".
    // This is the ideal moment to predict where the scroll will land and trigger a snap.
    
    const isDecelerating = Math.abs(this.lastVelocity) > Math.abs(velocity);
    const isTurningBack = Math.sign(this.lastVelocity) !== Math.sign(velocity) && velocity !== 0;

    if (
      isDecelerating &&
      !isTurningBack &&
      Math.abs(velocity) > this.options.velocityThreshold &&
      userData?.initiator !== 'snap'
    ) {
      const predictedY = predictScrollEnd(this.lenis.scroll, velocity);
      this.snapToClosest(predictedY);
    }
    
    this.lastVelocity = velocity;
  }

  snapToClosest(targetY) {
    let closest = null;
    let closestDist = Infinity;

    this.elements.forEach(elementObj => {
        elementObj.align.forEach(a => {
            let value = calculateAlignedPosition(elementObj.rect, a, this.viewport);
            value = Math.max(0, Math.min(value, this.lenis.limit));
            const dist = Math.abs(value - targetY);
            const threshold = elementObj.options.threshold ?? Infinity;

            if (dist < threshold && dist < closestDist) {
                closest = { value, elementObj };
                closestDist = dist;
            }
        });
    });

    if (closest) {
      this.isSnapping = true;
      this.lenis.scrollTo(closest.value, {
        lerp: this.options.lerp,
        easing: this.options.easing,
        duration: this.options.duration,
        userData: { initiator: "snap" },
        onStart: () => this.options.onSnapStart?.(closest),
        onComplete: () => {
          this.isSnapping = false;
          this.options.onSnapComplete?.(closest);
        },
      });
    }
  }

  destroy() {
    this.isStopped = true;
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
