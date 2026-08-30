// Shared jsdom quieting: stub media methods and window.confirm so expected
// flows do not spill "Not implemented" into stderr.
if (typeof window !== 'undefined') {
  const proto = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
  if (proto && !proto.__stcribedMedia) {
    Object.defineProperty(proto, '__stcribedMedia', { value: true });
    Object.defineProperty(proto, 'paused', {
      configurable: true,
      get() { return this.__stcribedPaused !== undefined ? this.__stcribedPaused : true; },
      set(v) { this.__stcribedPaused = Boolean(v); },
    });
    proto.play = function play() { this.__stcribedPaused = false; return Promise.resolve(); };
    proto.pause = function pause() { this.__stcribedPaused = true; };
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
