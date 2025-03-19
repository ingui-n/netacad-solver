import browser from 'webextension-polyfill';

browser.webRequest.onSendHeaders.addListener(async ({url}) => {
    const handleSendUrl = async () => {
      for (let i = 0; i < tabs.length; i++) {
        const tab = tabs[i];

        try {
          await browser.tabs.sendMessage(tab.id, {
            componentsUrl: url
          });

          tabs.splice(i, 1);
          i--;

          if (tabs.length === 0) {
            clearInterval(sendInterval);
          }
        } catch (e) {
        }
      }
    };

    let tabs = (await browser.tabs.query({}))
      .filter(t => t.url?.includes('netacad.com') && t.id)
      .filter(t => !t.url?.endsWith('components.json'));

    const sendInterval = setInterval(handleSendUrl, 1000);
  },
  {
    urls: ['https://*.netacad.com/content/noes/*/components.json']
  }
);

browser.webRequest.onBeforeSendHeaders.addListener((details) => {
    return {
      requestHeaders: details.requestHeaders.map(header => {
        if (header.name.toLowerCase() === 'cache-control') {
          return {
            name: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate'
          };
        }
        return header;
      })
    };
  },
  {urls: ['https://*.netacad.com/content/noes/*/components.json']},
  ["requestHeaders"]
);
