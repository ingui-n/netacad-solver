import browser from 'webextension-polyfill';

const pathJoin = (...parts) => {
  return parts.filter(p => p).join('/').replace(/([^:]\/)\/+/g, '$1');
};

// receive message from intercept.js and send response to background.js
window.addEventListener('message', (e) => {
  if (e.source === window && e.data && e.data.source === 'netacad-solver-interceptor') {
    const serviceId = new URL(window.top.location).searchParams.get('id');
    const data = e.data.payload.context.extensions;
    const lang = new URL(e.data.referrer).searchParams.get('lang');

    const parts = [
      'https://www.netacad.com/content',
      data['https://www.netacad.com/course/name'],
      data['https://www.netacad.com/schema/version'] || '1.0',
      'courses/content/final-exam-ilt',
      lang || 'en-US',
      'components.json'
    ];

    const finalUrl = pathJoin(...parts);

    browser.runtime.sendMessage({
      type: 'netacad-solver-interceptor',
      url: finalUrl,
      serviceId: serviceId
    }).catch(() => {
    });
  }
});
