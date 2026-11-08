/**
 * Browser Compatibility Polyfills for Android 7 & Android 8 (Chrome 50+)
 * Provides missing APIs: AbortController, Object methods, Array methods, Promise.finally, String methods, flex-gap detection
 */
(function(window) {
  'use strict';

  // 1. globalThis
  if (typeof globalThis === 'undefined') {
    window.globalThis = window;
  }

  // 2. AbortController & AbortSignal (required by Supabase & modern fetch)
  if (typeof window.AbortController === 'undefined') {
    function AbortSignal() {
      this.aborted = false;
      this.reason = undefined;
      this._listeners = [];
      this.onabort = null;
    }
    AbortSignal.prototype.addEventListener = function(type, listener) {
      if (type === 'abort' && typeof listener === 'function') {
        this._listeners.push(listener);
      }
    };
    AbortSignal.prototype.removeEventListener = function(type, listener) {
      if (type === 'abort') {
        var idx = this._listeners.indexOf(listener);
        if (idx !== -1) this._listeners.splice(idx, 1);
      }
    };
    AbortSignal.prototype.dispatchEvent = function(event) {
      if (event && event.type === 'abort') {
        this.aborted = true;
        if (typeof this.onabort === 'function') {
          try { this.onabort.call(this, event); } catch (e) { setTimeout(function() { throw e; }, 0); }
        }
        var copy = this._listeners.slice();
        for (var i = 0; i < copy.length; i++) {
          try { copy[i].call(this, event); } catch (e) { setTimeout(function() { throw e; }, 0); }
        }
        return true;
      }
      return false;
    };

    function AbortController() {
      this.signal = new AbortSignal();
    }
    AbortController.prototype.abort = function(reason) {
      if (this.signal.aborted) return;
      this.signal.aborted = true;
      this.signal.reason = reason || new (window.DOMException || Error)('The user aborted a request.', 'AbortError');
      var evt;
      try {
        evt = new Event('abort');
      } catch (e) {
        evt = document.createEvent('Event');
        evt.initEvent('abort', false, false);
      }
      this.signal.dispatchEvent(evt);
    };

    window.AbortController = AbortController;
    window.AbortSignal = AbortSignal;

    // Wrap fetch to honor AbortSignal if not natively supported
    if (typeof window.fetch === 'function') {
      var origFetch = window.fetch;
      window.fetch = function(input, init) {
        if (init && init.signal) {
          var signal = init.signal;
          if (signal.aborted) {
            var err = signal.reason || new (window.DOMException || Error)('The user aborted a request.', 'AbortError');
            return Promise.reject(err);
          }
          return new Promise(function(resolve, reject) {
            var onAbort = function() {
              signal.removeEventListener('abort', onAbort);
              reject(signal.reason || new (window.DOMException || Error)('The user aborted a request.', 'AbortError'));
            };
            signal.addEventListener('abort', onAbort);
            origFetch(input, init).then(function(res) {
              signal.removeEventListener('abort', onAbort);
              resolve(res);
            }, function(err) {
              signal.removeEventListener('abort', onAbort);
              reject(err);
            });
          });
        }
        return origFetch(input, init);
      };
    }
  }

  // 3. Object.fromEntries
  if (typeof Object.fromEntries !== 'function') {
    Object.fromEntries = function(iterable) {
      if (!iterable) return {};
      var obj = {};
      var arr = Array.isArray(iterable) ? iterable : Array.from(iterable);
      for (var i = 0; i < arr.length; i++) {
        var pair = arr[i];
        if (Object(pair) !== pair) throw new TypeError('iterable for fromEntries should yield objects');
        obj[pair[0]] = pair[1];
      }
      return obj;
    };
  }

  // 4. Object.entries
  if (typeof Object.entries !== 'function') {
    Object.entries = function(obj) {
      var ownProps = Object.keys(obj), i = ownProps.length, resArray = new Array(i);
      while (i--) resArray[i] = [ownProps[i], obj[ownProps[i]]];
      return resArray;
    };
  }

  // 5. Object.values
  if (typeof Object.values !== 'function') {
    Object.values = function(obj) {
      var ownProps = Object.keys(obj), i = ownProps.length, resArray = new Array(i);
      while (i--) resArray[i] = obj[ownProps[i]];
      return resArray;
    };
  }

  // 6. Promise.prototype.finally
  if (typeof Promise.prototype.finally !== 'function') {
    Promise.prototype.finally = function(callback) {
      var constructor = this.constructor;
      return this.then(
        function(value) { return constructor.resolve(callback()).then(function() { return value; }); },
        function(reason) { return constructor.resolve(callback()).then(function() { throw reason; }); }
      );
    };
  }

  // 7. Array.prototype.flat & flatMap
  if (typeof Array.prototype.flat !== 'function') {
    Array.prototype.flat = function(depth) {
      var d = depth === undefined ? 1 : Math.floor(depth);
      if (d < 1) return Array.prototype.slice.call(this);
      return (function flatten(arr, currentDepth) {
        var out = [];
        for (var i = 0; i < arr.length; i++) {
          if (Array.isArray(arr[i]) && currentDepth < d) {
            out.push.apply(out, flatten(arr[i], currentDepth + 1));
          } else if (i in arr) {
            out.push(arr[i]);
          }
        }
        return out;
      })(this, 0);
    };
  }
  if (typeof Array.prototype.flatMap !== 'function') {
    Array.prototype.flatMap = function(callback, thisArg) {
      return Array.prototype.map.call(this, callback, thisArg).flat();
    };
  }

  // 8. Array.prototype.at & String.prototype.at
  if (typeof Array.prototype.at !== 'function') {
    Array.prototype.at = function(n) {
      n = Math.trunc(n) || 0;
      if (n < 0) n += this.length;
      if (n < 0 || n >= this.length) return undefined;
      return this[n];
    };
  }
  if (typeof String.prototype.at !== 'function') {
    String.prototype.at = function(n) {
      n = Math.trunc(n) || 0;
      if (n < 0) n += this.length;
      if (n < 0 || n >= this.length) return '';
      return this.charAt(n);
    };
  }

  // 9. String.prototype.padStart & padEnd
  if (typeof String.prototype.padStart !== 'function') {
    String.prototype.padStart = function(targetLength, padString) {
      targetLength = targetLength >> 0;
      padString = String(typeof padString !== 'undefined' ? padString : ' ');
      if (this.length > targetLength) return String(this);
      targetLength = targetLength - this.length;
      if (targetLength > padString.length) {
        padString += padString.repeat(targetLength / padString.length);
      }
      return padString.slice(0, targetLength) + String(this);
    };
  }
  if (typeof String.prototype.padEnd !== 'function') {
    String.prototype.padEnd = function(targetLength, padString) {
      targetLength = targetLength >> 0;
      padString = String(typeof padString !== 'undefined' ? padString : ' ');
      if (this.length > targetLength) return String(this);
      targetLength = targetLength - this.length;
      if (targetLength > padString.length) {
        padString += padString.repeat(targetLength / padString.length);
      }
      return String(this) + padString.slice(0, targetLength);
    };
  }

  // 10. String.prototype.replaceAll
  if (typeof String.prototype.replaceAll !== 'function') {
    String.prototype.replaceAll = function(search, replacement) {
      if (search instanceof RegExp) {
        if (!search.global) throw new TypeError('replaceAll called with a non-global RegExp');
        return this.replace(search, replacement);
      }
      return this.split(search).join(replacement);
    };
  }

  // 11. queueMicrotask
  if (typeof window.queueMicrotask !== 'function') {
    window.queueMicrotask = function(callback) {
      Promise.resolve().then(callback).catch(function(err) {
        setTimeout(function() { throw err; }, 0);
      });
    };
  }

  // 12. crypto.randomUUID
  if (typeof window.crypto === 'object' && typeof window.crypto.randomUUID !== 'function') {
    window.crypto.randomUUID = function() {
      return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, function(c) {
        var num = parseInt(c, 10);
        return (num ^ (window.crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (num / 4)))).toString(16);
      });
    };
  }

  // 13. Detect flexbox gap support and apply fallback class
  (function() {
    try {
      var flex = document.createElement('div');
      flex.style.display = 'flex';
      flex.style.flexDirection = 'column';
      flex.style.rowGap = '1px';
      flex.appendChild(document.createElement('div'));
      flex.appendChild(document.createElement('div'));
      document.documentElement.appendChild(flex);
      var isSupported = (flex.scrollHeight === 1);
      flex.parentNode.removeChild(flex);
      if (!isSupported) {
        document.documentElement.classList.add('no-flex-gap');
      }
    } catch (e) {
      document.documentElement.classList.add('no-flex-gap');
    }
  })();

})(typeof window !== 'undefined' ? window : globalThis);
