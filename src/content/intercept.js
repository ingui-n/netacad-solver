(() => {
  // XMLHttpRequest
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._interceptUrl = String(url);
    return originalOpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    const url = this._interceptUrl;

    if (url && url.includes('/adl/content/launch/')) {
      this.addEventListener('readystatechange', function () {
        if (this.readyState === 4 && this.status === 200) {
          try {
            const data = JSON.parse(this.responseText);

            window.postMessage({
              source: 'netacad-solver-interceptor',
              payload: data,
              requestUrl: url,
              referrer: window.location.href
            }, '*');
          } catch (e) {
          }
        }
      });
    }

    try {
      return originalSend.apply(this, args);
    } catch (e) {
    }
  };

  // fetch
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0] instanceof URL ? args[0].href : '');
    const response = await originalFetch(...args);

    if (url && url.includes('/adl/content/launch/')) {
      try {
        const clone = response.clone();
        const data = await clone.json();

        window.postMessage({
          source: 'netacad-solver-interceptor',
          payload: data,
          requestUrl: url,
          referrer: window.location.href
        }, '*');
      } catch (e) {
      }
    }
    return response;
  };
})();
