/** call with selector like `[index="0"]` or `#${CSS.escape(4d76993c11374083829fec95af541640)}-1-input` */
export const deepHtmlSearch = (document, selector, unwrap = false, count = 1) => {
  if (!document)
    return null;

  // test if more elements should be found
  if (count > 1) {
    const directMatch = [...document.querySelectorAll(selector)];

    if (directMatch.length === count)
      return unwrap ? unwrapElementContent(directMatch) : directMatch;
  } else {
    const directMatch = document.querySelector(selector);

    if (directMatch)
      return unwrap ? unwrapElementContent(directMatch) : directMatch;
  }

  // searches in all the iframes
  const iframes = document.querySelectorAll('iframe');

  for (const iframe of iframes) {
    const foundTarget = deepHtmlSearch(iframe.contentDocument, selector, unwrap);

    if (foundTarget)
      return foundTarget;
  }

  const elementsWithShadow = [...document.querySelectorAll('*')]
    .filter(el => el.shadowRoot);

  for (const element of elementsWithShadow) {
    // test if more elements should be found
    if (count > 1) {
      const shadowMatch = [...element.shadowRoot.querySelectorAll(selector)];

      if (shadowMatch.length === count)
        return unwrap ? unwrapElementContent(shadowMatch) : shadowMatch;
    } else {
      const shadowMatch = element.shadowRoot.querySelector(selector);

      if (shadowMatch)
        return unwrap ? unwrapElementContent(shadowMatch) : shadowMatch;
    }

    const foundTarget = deepHtmlSearch(element.shadowRoot, selector, unwrap);

    if (foundTarget)
      return foundTarget;
  }

  return null;
};

export const deepHtmlFindByTextContent = (currentDocument, textContent) => {
  if (!currentDocument)
    return null;

  textContent = textContent.trim();

  const directMatch = [...currentDocument.querySelectorAll('*')]
    .reverse()
    .find(el => el.textContent.trim() === textContent);

  if (directMatch)
    return directMatch;

  const iframes = currentDocument.querySelectorAll('iframe');

  for (const iframe of iframes) {
    const foundTarget = deepHtmlFindByTextContent(iframe.contentDocument, textContent);

    if (foundTarget)
      return foundTarget;
  }

  const shadowHosts = [...currentDocument.querySelectorAll('*')]
    .filter(el => el.tagName.toLowerCase().endsWith('-view') || el.tagName.toLowerCase() === 'app-root');

  for (const host of shadowHosts) {
    if (!host.shadowRoot)
      continue;

    const foundTarget = deepHtmlFindByTextContent(host.shadowRoot, textContent);

    if (foundTarget)
      return foundTarget;
  }

  return null;
};

export const findVisibleFromComponents = async (rootDocument, targetArray) => {
  const textsToIdsMap = new Map();
  const textsSet = new Set();
  const foundIdsSet = new Set();

  for (const item of targetArray) {
    if (!item.body || !item._id)
      continue;

    const cleanBody = item.body.trim();

    if (!textsToIdsMap.has(cleanBody)) {
      textsToIdsMap.set(cleanBody, []);
    }

    textsToIdsMap.get(cleanBody).push(item._id);
    textsSet.add(cleanBody);
  }

  await deepHtmlFindIdsInternalAsync(rootDocument, textsToIdsMap, textsSet, foundIdsSet);
  return foundIdsSet;
};

export const findVisibleQuestionPartsFromComponents = async (rootDocument, componentsArray) => {
  const results = {};
  const pendingClasses = new Set();
  const pendingTexts = new Map();

  for (const comp of componentsArray) {
    if (!comp._id || !comp.body)
      continue;

    results[comp._id] = {questionDiv: null, questionElement: null};

    pendingClasses.add(comp._id);
    const cleanBody = comp.body.trim();

    if (!pendingTexts.has(cleanBody)) {
      pendingTexts.set(cleanBody, []);
    }
    pendingTexts.get(cleanBody).push(comp._id);
  }

  await deepHtmlBatchSearchInternalAsync(rootDocument, pendingClasses, pendingTexts, results);
  return results;
};

const yieldToEventLoop = () => new Promise(resolve => setTimeout(resolve, 0));

const deepHtmlBatchSearchInternalAsync = async (currentDocument, pendingClasses, pendingTexts, results) => {
  if (!currentDocument || (pendingClasses.size === 0 && pendingTexts.size === 0)) {
    return results;
  }

  const elements = [...currentDocument.querySelectorAll('*')].reverse();

  for (const el of elements) {
    if (pendingClasses.size > 0 && el.classList.length > 0) {
      for (const className of el.classList) {
        if (pendingClasses.has(className)) {
          results[className].questionDiv = el;
          pendingClasses.delete(className);
          break;
        }
      }
    }

    if (pendingTexts.size > 0) {
      const text = el.textContent.trim();
      if (pendingTexts.has(text)) {
        const componentIds = pendingTexts.get(text);

        componentIds.forEach(id => {
          if (!results[id].questionElement) {
            results[id].questionElement = el;
          }
        });

        pendingTexts.delete(text);
      }
    }

    if (pendingClasses.size === 0 && pendingTexts.size === 0) {
      return results;
    }
  }

  const iframes = currentDocument.querySelectorAll('iframe');
  for (const iframe of iframes) {
    if (pendingClasses.size === 0 && pendingTexts.size === 0) return results;
    await yieldToEventLoop();

    try {
      if (iframe.contentDocument) {
        await deepHtmlBatchSearchInternalAsync(iframe.contentDocument, pendingClasses, pendingTexts, results);
      }
    } catch (e) {
    }
  }

  const shadowHosts = [...currentDocument.querySelectorAll('*')]
    .filter(el => el.shadowRoot || el.tagName.toLowerCase().endsWith('-view') || el.tagName.toLowerCase() === 'app-root');

  for (const host of shadowHosts) {
    if (!host.shadowRoot) continue;
    if (pendingClasses.size === 0 && pendingTexts.size === 0) return results;

    await yieldToEventLoop();
    await deepHtmlBatchSearchInternalAsync(host.shadowRoot, pendingClasses, pendingTexts, results);
  }

  return results;
};


const deepHtmlFindIdsInternalAsync = async (currentDocument, textsToIdsMap, textsSet, foundIdsSet) => {
  if (!currentDocument || textsSet.size === 0)
    return foundIdsSet;

  const elements = [...currentDocument.querySelectorAll('*')].reverse();

  for (const el of elements) {
    const text = el.textContent.trim();

    if (textsSet.has(text)) {
      const ids = textsToIdsMap.get(text);
      ids.forEach(id => foundIdsSet.add(id));
      textsSet.delete(text);

      if (textsSet.size === 0)
        return foundIdsSet;
    }
  }

  const iframes = currentDocument.querySelectorAll('iframe');

  for (const iframe of iframes) {
    if (textsSet.size === 0)
      return foundIdsSet;
    await yieldToEventLoop();

    try {
      if (iframe.contentDocument) {
        await deepHtmlFindIdsInternalAsync(iframe.contentDocument, textsToIdsMap, textsSet, foundIdsSet);
      }
    } catch (e) {
    }
  }

  const shadowHosts = [...currentDocument.querySelectorAll('*')]
    .filter(el => el.tagName.toLowerCase().endsWith('-view') || el.tagName.toLowerCase() === 'app-root');

  for (const host of shadowHosts) {
    if (!host.shadowRoot)
      continue;
    if (textsSet.size === 0)
      return foundIdsSet;

    await yieldToEventLoop();
    await deepHtmlFindIdsInternalAsync(host.shadowRoot, textsToIdsMap, textsSet, foundIdsSet);
  }

  return foundIdsSet;
};

export const deepHtmlFindByTextContentPart = (currentDocument, textContent) => {
  if (!currentDocument)
    return null;

  textContent = textContent.trim();

  const directMatch = [...currentDocument.querySelectorAll('*')]
    .find(el => el.textContent.trim().includes(textContent));

  if (directMatch)
    return directMatch;

  const iframes = currentDocument.querySelectorAll('iframe');

  for (const iframe of iframes) {
    const foundTarget = deepHtmlFindByTextContentPart(iframe.contentDocument, textContent);

    if (foundTarget)
      return foundTarget;
  }

  const shadowHosts = [...currentDocument.querySelectorAll('*')]
    .filter(el => el.tagName.toLowerCase().endsWith('-view') || el.tagName.toLowerCase() === 'app-root');

  for (const host of shadowHosts) {
    if (!host.shadowRoot) continue;

    const target = [...host.shadowRoot.querySelectorAll('*')]
      .find(el => el.textContent.trim().includes(textContent));

    if (target)
      return target;

    const foundTarget = deepHtmlFindByTextContentPart(host.shadowRoot, textContent);

    if (foundTarget)
      return foundTarget;
  }
};

export const disableAnimationsDeep = async (mainDiv) => {
  if (!mainDiv)
    return;

  const disableAnimationCss = `
    *, *::before, *::after {
      animation-duration: 0.1s !important;
      transition-duration: 0.1s !important;
    }
  `;

  const injectStyle = (target) => {
    if (target.querySelector('style[data-kill-animations]')) return;

    const style = document.createElement('style');
    style.setAttribute('data-kill-animations', 'true');
    style.textContent = disableAnimationCss;
    target.appendChild(style);
  };

  injectStyle(mainDiv);

  const traverseAndKill = async (currentScope) => {
    const allElements = currentScope.querySelectorAll('*');

    for (const el of allElements) {
      if (el.shadowRoot) {
        injectStyle(el.shadowRoot);
        await yieldToEventLoop();
        await traverseAndKill(el.shadowRoot);
      }
    }
  };

  await traverseAndKill(mainDiv);
};

export const unwrapElementContent = element => {
  if (Array.isArray(element)) {
    return element.map(unwrapElementContent);
  }

  if (element.contentDocument) {
    return element.contentDocument;
  } else if (element.shadowRoot) {
    return element.shadowRoot;
  }
  return element;
};

export const enableTextSelectionRecursive = (doc = document) => {
  if (!doc) return;

  const stopPropHandler = (e) => e.stopImmediatePropagation();

  const protectSelectionHandler = (e) => {
    const target = e.target;

    if (target && (
      target.tagName === 'VIDEO' ||
      target.tagName === 'AUDIO' ||
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.closest?.('.html5-video-player, [data-testid="videoComponent"], .twitter-video')
    )) {
      return;
    }

    if (e.detail >= 2) {
      e.stopImmediatePropagation();
    }
  };

  doc.addEventListener?.('selectstart', stopPropHandler, true);
  doc.addEventListener?.('selectionchange', stopPropHandler, true);
  doc.addEventListener?.('contextmenu', stopPropHandler, true);
  doc.addEventListener?.('dragstart', stopPropHandler, true);
  doc.addEventListener?.('copy', stopPropHandler, true);
  doc.addEventListener?.('cut', stopPropHandler, true);
  doc.addEventListener?.('paste', stopPropHandler, true);

  doc.addEventListener?.('mousedown', protectSelectionHandler, true);
  doc.addEventListener?.('mouseup', protectSelectionHandler, true);
  doc.addEventListener?.('click', protectSelectionHandler, true);
  doc.addEventListener?.('dblclick', protectSelectionHandler, true);

  try {
    const target = doc.head || doc.body || doc;
    if (target && !target.querySelector?.('style[data-force-select]')) {
      const style = (doc.ownerDocument || doc).createElement?.('style');

      if (style) {
        style.setAttribute('data-force-select', 'true');
        style.textContent = `
          *, *::before, *::after {
            user-select: text !important;
            -webkit-user-select: text !important;
            -moz-user-select: text !important;
            -ms-user-select: text !important;
          }
        `;
        target.appendChild(style);
      }
    }
  } catch (e) {
  }

  const iframes = doc.querySelectorAll?.('iframe');
  iframes?.forEach(iframe => {
    try {
      if (iframe.contentDocument)
        enableTextSelectionRecursive(iframe.contentDocument);
    } catch (e) {
    }
  });

  const shadowRoots = [...(doc.querySelectorAll?.('*') || [])].filter(el => el.shadowRoot);
  shadowRoots.forEach(el => {
    try {
      enableTextSelectionRecursive(el.shadowRoot);
    } catch (e) {
    }
  });
};
