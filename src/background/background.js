import browser from 'webextension-polyfill';

const updateCurrentTab = async () => {
  const [tab] = await browser.tabs.query({active: true, lastFocusedWindow: true});
  return tab;
};

browser.webRequest.onSendHeaders.addListener(async ({url}) => {
    console.log(url)
    const tab = await updateCurrentTab();
    if (tab?.id) {
      await browser.tabs.sendMessage(tab.id, {
        componentsUrl: url
      });
    }
  },
  {
    urls: ['https://*.netacad.com/content/noes/*/components.json']
  }
);

browser.webRequest.onBeforeSendHeaders.addListener((details) => {
    console.log(details)
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
