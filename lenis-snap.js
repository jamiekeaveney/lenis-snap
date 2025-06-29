class Snap {
  constructor(lenis, opts = {}) {
    // Existing constructor setup
    this.lenis = lenis;
    this.elements = new Map();
    this.snaps    = new Map();
    this.viewport = { width: innerWidth, height: innerHeight };
    this.isStopped = false;

    // ─────────── predictive scroll options ───────────
    this.predictFactor   = opts.predictFactor ?? 14;  // wheel look-ahead multiplier
    this.snapThreshold   = opts.snapThreshold ?? 0.1; // fraction of viewport
    this.snapDuration    = opts.snapDuration ?? this.options.duration;
    this.lockoutMs       = opts.lockoutMs ?? 300;
    this.scrollEndDelay  = opts.scrollEndDelay ?? 120;

    // State
    this.isLocked      = false;
    this.activeScroll  = null;
    this.scrollEndTmr  = null;
    this.currentScroll = 0;
    this.snapPositions = [];

    // Set up initial snap positions and listen to changes
    this.calcSnapPositions();
    window.addEventListener('resize', this.debounce(() => {
      this.calcSnapPositions();
      this.lenis.resize();
    }, 100));
    new MutationObserver(this.debounce(() => this.calcSnapPositions(), 50))
      .observe(document.body, { childList: true, subtree: true });

    // Hook into Lenis scroll
    this.lenis.on('scroll', ({ scroll }) => {
      this.currentScroll = scroll;
      clearTimeout(this.scrollEndTmr);
      this.scrollEndTmr = setTimeout(() => this.evaluateSnap(this.currentScroll), this.scrollEndDelay);
    });

    // Predictive wheel snapping
    window.addEventListener('wheel', e => {
      if (this.isLocked || Math.abs(e.deltaY) < 1) return;
      const lookAhead = this.currentScroll + e.deltaY * this.predictFactor;
      this.evaluateSnap(lookAhead, Math.sign(e.deltaY), e);
    }, { passive: false });
  }

  // ─────────── new methods ───────────

  // Build a flat array of pixel positions to snap to
  calcSnapPositions() {
    const { width: vw, height: vh } = this.viewport;
    this.snapPositions = [];

    // Add primitive snap positions
    this.snaps.forEach(({ value }) => {
      this.snapPositions.push(value);
    });

    // Add element-based snap positions
    this.elements.forEach(el => {
      el.align.forEach(a => {
        let val;
        const r = el.rect;
        if (a === 'start')  val = r.top;
        if (a === 'center') val = this.lenis.isHorizontal
          ? r.left + r.width/2  - vw/2
          : r.top  + r.height/2 - vh/2;
        if (a === 'end')    val = this.lenis.isHorizontal
          ? r.left + r.width   - vw
          : r.top  + r.height  - vh;
        this.snapPositions.push(Math.ceil(val));
      });
    });

    // Keep snap positions sorted and remove duplicates
    this.snapPositions = Array.from(new Set(this.snapPositions))
                              .sort((a, b) => a - b);
  }

  // Simple nearest-point finder
  getNearestSnap(y) {
    return this.snapPositions.reduce((closest, pt) =>
      Math.abs(pt - y) < Math.abs(closest - y) ? pt : closest
    , this.snapPositions[0]);
  }

  // Perform a scroll to the target snap position
  startSnap(target) {
    if (this.activeScroll?.cancel) this.activeScroll.cancel();
    this.activeScroll = this.lenis.scrollTo(target, {
      duration: this.snapDuration,
      easing:    t => 1 - (1 - t)**2.5,
      onStart:   () => { this.isLocked = true; },
      onComplete:() => {
        setTimeout(() => this.isLocked = false, this.lockoutMs);
        this.activeScroll = null;
      }
    });
  }

  /**
   * Evaluate whether to snap based on the look-ahead scroll position
   * @param {number} lookY       – the scroll position to test (either real scroll or look-ahead)
   * @param {number} deltaDir    – +1 / -1 or 0; direction of wheel if predictive
   * @param {Event}  evt         – optional wheel event to preventDefault
   */
  evaluateSnap(lookY, deltaDir = 0, evt) {
    const nearest = this.getNearestSnap(lookY);
    const inZone  = Math.abs(lookY - nearest) < window.innerHeight * this.snapThreshold;
    const sameDir = deltaDir === 0 || Math.sign(nearest - this.currentScroll) === deltaDir;

    if (!inZone || !sameDir || this.isLocked) return;
    evt?.preventDefault();
    this.startSnap(nearest);
  }

  // Utility debounce method to limit function calls
  debounce(fn, ms) {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  }

  // ─────────── existing methods ───────────

  destroy() {
    this.lenis.off('scroll', this.onScroll);
    window.removeEventListener('resize', this.onWindowResize, false);
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
