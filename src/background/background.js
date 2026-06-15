import browser from 'webextension-polyfill';

let headers = null;
let languages = [];
let language = 'en-US';

const pathJoin = (...parts) => {
  return parts.filter(p => p).join('/').replace(/([^:]\/)\/+/g, '$1');
};

const isInternalRequest = (details) => {
  return details.initiator &&
    (details.initiator.startsWith('chrome-extension://') || details.initiator.startsWith('moz-extension://'));
};

const jsonDeepSearchCourseModules = (obj, results = []) => {
  if (!obj || typeof obj !== 'object') {
    return results;
  }

  if (
    typeof obj.url === 'string' &&
    typeof obj.type === 'string' &&
    typeof obj.params === 'string'
  ) {
    results.push({
      url: obj.url,
      type: obj.type,
      params: obj.params
    });
  }

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      jsonDeepSearchCourseModules(obj[key], results);
    }
  }

  return results;
};

const jsonDeepSearchCourseLanguages = (obj) => {
  if (!obj || typeof obj !== 'object') {
    return null;
  }

  if (
    Array.isArray(obj) &&
    (obj.includes('en-US') || obj.includes('es-XL') || obj.includes('zh-CN'))
  ) {
    return obj;
  }

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const found = jsonDeepSearchCourseLanguages(obj[key]);
      if (found) return found;
    }
  }

  return null;
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
  const sendInterval = setInterval(handleSendUrl, 1000);

  setTimeout(() => {
    clearInterval(sendInterval);
  }, 30000);
};

const getComponentUrls = async (bodyString) => {
  const extractCourseComponentLinks = data => {
    if (!!data.data?.getLaunchInfo?.service?.technicalServiceDetails?.languages) {
      languages = data.data.getLaunchInfo.service.technicalServiceDetails.languages;
    } else {
      // finds an array of language sets
      languages = jsonDeepSearchCourseLanguages(data);
    }

    let courseModules;

    if (!!data.data?.getLaunchInfo?.courseOutline?.components) {
      const components = data.data.getLaunchInfo.courseOutline.components;
      let moduleParts = [];

      for (const value of Object.values(components)) {
        if (value.type.toLowerCase() === 'module') {
          moduleParts.push(value.launchConfig);
        }
      }

      courseModules = moduleParts;
    } else {
      // finds objects with module paths
      courseModules = jsonDeepSearchCourseModules(data);
    }

    const links = [];

    for (const value of courseModules) {
      const parts = [
        'https://www.netacad.com',
        value.url.replace('index.html', ''),
        value.params,
        language,
        'components.json'
      ];

      links.push(pathJoin(...parts));
    }

    return links;
  };

  // format headers from names and values
  const headersObject = Object.fromEntries(
    headers.map(item => [item.name, item.value])
  );

  // recreating the same request as front-end did to get links of course components
  await fetch('https://api.netacad.com/api', {
    headers: headersObject,
    method: 'POST',
    mode: 'cors',
    credentials: 'include',
    body: bodyString
  })
    .then(async e => {
      const data = await e.json();

      const links = extractCourseComponentLinks(data);
      await sendMessage({componentUrls: links})
    })
    .catch(e => console.error(e));
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

// api body
browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (isInternalRequest(details))
      return;

    if (details.requestBody && details.requestBody.raw) {
      const decoder = new TextDecoder("utf-8");

      details.requestBody.raw.forEach(async (element) => {
        const bodyString = decoder.decode(element.bytes);
        const bodyJson = JSON.parse(bodyString);

        if (bodyJson.operationName === 'getLaunchInfo' || bodyJson.operationName === 'getResourceOutline') {
          await getComponentUrls(bodyString);
        }
      });
    }
  },
  {urls: ['https://api.netacad.com/api*']},
  ["requestBody"]
);

// catches api headers
browser.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (isInternalRequest(details))
      return;

    headers = details.requestHeaders;
  },
  {urls: ['https://api.netacad.com/api*']},
  ["requestHeaders", "extraHeaders"]
);

// catches display language
browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (isInternalRequest(details))
      return;

    for (const lan of languages) {
      if (details.url.includes(lan)) {
        language = lan;
      }
    }
  },
  {
    urls: ['https://*.netacad.com/content/*', 'https://*.netacad.com/authoring-resources/*']
  }
);
