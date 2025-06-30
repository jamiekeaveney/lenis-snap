(function(p,v){
  typeof exports=="object"&&typeof module!="undefined"?v(exports):
  typeof define=="function"&&define.amd?define(["exports"],v):
  (p=typeof globalThis!="undefined"?globalThis:p||self,v({}));
})(this,function(p){"use strict";
  function v(i,t){let e;return function(...o){let r=this;clearTimeout(e),e=setTimeout(()=>{
      e=void 0,i.apply(r,o)
    },t)}}
  function g(i){
    getComputedStyle(i).position==="sticky"&&(i.style.setProperty("position","static"),i.dataset.sticky="true"),
    i.offsetParent&&g(i.offsetParent)
  }
  function m(i){
    var t;((t=i==null?void 0:i.dataset)==null?void 0:t.sticky)==="true"&&(
      i.style.removeProperty("position"),delete i.dataset.sticky
    ),i.offsetParent&&m(i.offsetParent)
  }
  function R(i,t=0){
    const e=t+i.offsetTop;
    return i.offsetParent?R(i.offsetParent,e):e
  }
  function P(i,t=0){
    const e=t+i.offsetLeft;
    return i.offsetParent?P(i.offsetParent,e):e
  }
  function M(i,t=0){
    const e=t+i.scrollTop;
    return i.offsetParent?M(i.offsetParent,e):e+window.scrollY
  }
  function T(i,t=0){
    const e=t+i.scrollLeft;
    return i.offsetParent?T(i.offsetParent,e):e+window.scrollX
  }
  class x{
    constructor(t,{align:e=["start"],ignoreSticky:o=!0,ignoreTransform:r=!1}={}){
      this.rect={};
      this.onWrapperResize=()=>{let n,d;
        if(this.options.ignoreSticky&&g(this.element),
           this.options.ignoreTransform){
          n=R(this.element),d=P(this.element);
        } else {
          const l=this.element.getBoundingClientRect();
          n=l.top+M(this.element),d=l.left+T(this.element);
        }
        if(this.options.ignoreSticky) m(this.element);
        this.setRect({top:n,left:d});
      };
      this.onResize=([n])=>{
        if(!(n==null?void 0:n.borderBoxSize[0]))return;
        const d=n.borderBoxSize[0].inlineSize,
              l=n.borderBoxSize[0].blockSize;
        this.setRect({width:d,height:l});
      };
      this.element=t;
      this.options={align:e,ignoreSticky:o,ignoreTransform:r};
      this.align=[e].flat();
      this.wrapperResizeObserver=new ResizeObserver(this.onWrapperResize);
      this.wrapperResizeObserver.observe(document.body);
      this.onWrapperResize();
      this.resizeObserver=new ResizeObserver(this.onResize);
      this.resizeObserver.observe(this.element);
      this.setRect({
        width:this.element.offsetWidth,
        height:this.element.offsetHeight
      });
    }
    destroy(){
      this.wrapperResizeObserver.disconnect();
      this.resizeObserver.disconnect();
    }
    setRect({top:t,left:e,width:o,height:r,element:n}={}){
      t=t!=null?t:this.rect.top;
      e=e!=null?e:this.rect.left;
      o=o!=null?o:this.rect.width;
      r=r!=null?r:this.rect.height;
      n=n!=null?n:this.rect.element;
      if(t===this.rect.top&&e===this.rect.left&&o===this.rect.width&&r===this.rect.height&&n===this.rect.element)
        return;
      this.rect.top=t;
      this.rect.y=t;
      this.rect.width=o;
      this.rect.height=r;
      this.rect.left=e;
      this.rect.x=e;
      this.rect.bottom=t+r;
      this.rect.right=e+o;
    }
  }
  let W=0;
  function k(){return W++;}
  class E{
    constructor(t,{type:e="mandatory",lerp:o,easing:r,duration:n,velocityThreshold:d=1,debounce:l=0,onSnapStart:O,onSnapComplete:L}={}){
      this.lenis=t;
      this.elements=new Map;
      this.snaps=new Map;
      this.viewport={width:window.innerWidth,height:window.innerHeight};
      this.isStopped=!1;
      this.onWindowResize=()=>{
        this.viewport.width=window.innerWidth;
        this.viewport.height=window.innerHeight;
      };
      this.onScroll=({lastVelocity:a,velocity:f,userData:h})=>{
        if(this.isStopped)return;
        const u=Math.abs(a)>Math.abs(f),
              z=Math.sign(a)!==Math.sign(f)&&f!==0;
        Math.abs(f)<this.options.velocityThreshold&&u&&!z&&(h==null?void 0:h.initiator)!=="snap"&&this.onSnapDebounced();
      };
      this.onSnap=()=>{
        let{scroll:a,isHorizontal:f}=this.lenis;
        a=Math.ceil(this.lenis.scroll);
        let snapsArr=[...this.snaps.values()];
        this.elements.forEach(({rect:s,align:c})=>{
          c.forEach(y=>{
            let w;
            if(y==="start") w=s.top;
            else if(y==="center") w=f
              ? s.left+s.width/2-this.viewport.width/2
              : s.top+s.height/2-this.viewport.height/2;
            else if(y==="end") w=f
              ? s.left+s.width-this.viewport.width
              : s.top+s.height-this.viewport.height;
            typeof w=="number"&&snapsArr.push({value:Math.ceil(w),userData:{}});
          });
        });
        snapsArr=snapsArr.sort((s,c)=>Math.abs(s.value)-Math.abs(c.value));
        let u=snapsArr.findLast(({value:s})=>s<=a);
        u===void 0&&(u=snapsArr[0]);
        const z=Math.abs(a-u.value);
        let S=snapsArr.find(({value:s})=>s>=a);
        S===void 0&&(S=snapsArr[snapsArr.length-1]);
        const B=Math.abs(a-S.value),
              b=z<B?u:S,
              C=Math.abs(a-b.value);
        const half=(this.options.type==="mandatory"||this.options.type==="proximity"&&C<=(f?this.lenis.dimensions.width:this.lenis.dimensions.height));
        if(half){
          this.lenis.scrollTo(b.value,{
            lerp:this.options.lerp,
            easing:this.options.easing,
            duration:this.options.duration,
            userData:{initiator:"snap"},
            onStart:()=>{ this.options.onSnapStart?.(b) },
            onComplete:()=>{ this.options.onSnapComplete?.(b) }
          });
        }
      };
      this.options={type:e,lerp:o,easing:r,duration:n,velocityThreshold:d,debounce:l,onSnapStart:O,onSnapComplete:L};
      this.onWindowResize();
      window.addEventListener("resize",this.onWindowResize,false);
      this.onSnapDebounced=v(this.onSnap,this.options.debounce);
      this.lenis.on("scroll",this.onScroll);
    }
    destroy(){
      this.lenis.off("scroll",this.onScroll);
      window.removeEventListener("resize",this.onWindowResize,false);
      this.elements.forEach(el=>el.destroy());
    }
    start(){ this.isStopped=!1 }
    stop(){ this.isStopped=!0 }
    add(value,userData={}){const id=k();this.snaps.set(id,{value,userData});return()=>this.remove(id)}
    remove(id){this.snaps.delete(id)}
    addElement(el,opts={}){const id=k();this.elements.set(id,new x(el,opts));return()=>this.removeElement(id)}
    removeElement(id){this.elements.delete(id)}
  }

  // ← HERE is your new global export:
  window.Snap = E;

  // keep these so CJS/AMD still work if needed:
  Object.defineProperty(p,"__esModule",{value:!0});
  p[Symbol.toStringTag] = "Module";
});
