// Shared jsdom quieting: stub media methods, window.confirm, and the
// deliberate top-level route scroll so expected flows do not spill
// "Not implemented" into stderr. (jsdom SHIPS a scrollTo that only logs
// "Not implemented" - it must be replaced, not just checked for.)
if (typeof window !== 'undefined') {
  window.scrollTo = () => {};
}
if (typeof window !== 'undefined') {
  const proto = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
  if (proto && !proto.__imMediaPatched) {
    Object.defineProperty(proto, '__imMediaPatched', { value: true });
    Object.defineProperty(proto, 'paused', {
      configurable: true,
      get() { return this.__imMediaPaused !== undefined ? this.__imMediaPaused : true; },
      set(v) { this.__imMediaPaused = Boolean(v); },
    });
    proto.play = function play() { this.__imMediaPaused = false; return Promise.resolve(); };
    proto.pause = function pause() { this.__imMediaPaused = true; };
    proto.load = function load() {};
  }
  const confirmStub = () => false;
  confirmStub.__defaultConfirmStub = true;
  window.confirm = confirmStub;
  if (typeof window.URL.createObjectURL !== 'function') {
    window.URL.createObjectURL = () => 'blob:narration-mock';
    window.URL.revokeObjectURL = () => {};
  }
}
