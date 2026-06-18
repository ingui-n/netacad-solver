import browser from 'webextension-polyfill';

const isInternalRequest = (details) => {
  return details.initiator &&
    (details.initiator.startsWith('chrome-extension://') || details.initiator.startsWith('moz-extension://'));
};

const sendMessage = async (message) => {
  const handleSendUrl = async () => {
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];

      try {
        await browser.tabs.sendMessage(tab.id, message);

        tabs.splice(i, 1);
        i--;

        if (tabs.length === 0) {
          clearInterval(sendInterval);
        }
      } catch (e) {
      }
    }
  };

  let tabs = (await browser.tabs.query({})).filter(t => t.id && t.title);
  const sendInterval = setInterval(handleSendUrl, 500);

  setTimeout(() => {
    clearInterval(sendInterval);
  }, 50000);
};

// catches component URLs
browser.webRequest.onSendHeaders.addListener(async (details) => {
    if (isInternalRequest(details))
      return;

    await sendMessage({componentsUrl: details.url});
  },
  {
    urls: ['https://*.netacad.com/*/components.json*']
  }
);

// get message with final exam url form catcher.js and save it to local storage
browser.runtime.onMessage.addListener(async (message, sender) => {
  if (sender.id === browser.runtime.id && message.type === 'netacad-solver-interceptor') {
    await sendMessage({componentsUrl: message.url});

    const name = `service-${message.serviceId}`;

    const result = await browser.storage.local.get(name);
    const obj = result[name] || [];

    if (!obj.includes(message.url)) {
      obj.push(message.url);
      await browser.storage.local.set({[name]: obj});
    }
  }
});
