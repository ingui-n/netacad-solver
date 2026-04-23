import browser from 'webextension-polyfill';
import {deepHtmlSearch, deepHtmlFindByTextContent} from "./domHelper";

let isSuspendRunning = false;
const components = [];
let questions = [];
const componentUrls = [];
const AUTO_SUBMIT_KEYWORDS = ['submit', 'enviar', 'check', 'check answer'];
const AUTO_SUBMIT_SELECTORS = 'button, [role="button"], input[type="button"], input[type="submit"], .js-btn-action, .btn__action';
const AUTO_SUBMIT_RETRY_DELAY = 120;
const AUTO_SUBMIT_RETRY_LIMIT = 8;
const TABS_SELECTORS = '.tabs__nav-item-btn, .js-tabs-nav-item-btn-click, .tabs__nav button, .tabs__nav-inner button, [role="tab"], [aria-controls*="tabpanel"]';
const TABS_CONTAINER_SELECTORS = '.tabs__nav, .component.tabs, .tab__widget, .tabs__widget, tabs-view';
const ACCORDION_SELECTORS = '.accordion__item-btn, [aria-controls^="accordion-item"]';
const ACCORDION_CONTAINER_SELECTORS = '.accordion__widget, .component.accordion, accordion-view';
const VIDEO_SELECTORS = 'video, .vjs-tech, iframe[src*="brightcovePlayer"]';
const VIDEO_CONTAINER_SELECTORS = '.component__widget, .video__widget, .component, block-view, article-view';
const PAGE_TRACER_SELECTORS = '.pageTracer-button, [data-page-tracer-button-id], pagetracer-view button.btn__action';
const PAGE_TRACER_CLOSE_SELECTORS = '#close-btn, .close-button';
const NOTIFY_CLOSE_SELECTORS = '.js-notify-close-btn, .notify__close-btn';
const MATCHING_DROPDOWN_SELECTORS = 'matching-dropdown-view, .matching__item_main';
const MATCHING_DROPDOWN_CONTAINER_SELECTORS = '.matching__widget, matching-view';
const OBJECT_MATCHING_SELECTORS = '.objectMatching-category-item, .objectMatching-option-item';
const OBJECT_MATCHING_CONTAINER_SELECTORS = '.objectMatching__widget, object-matching-view';
const ALT_SWEEP_INTERVAL = 18;
const AUTOMATION_CLICK_DELAY = 140;
const PAGETRACER_RETRY_DELAY = 120;
const PAGETRACER_RETRY_LIMIT = 10;

const processedQuestionElements = new WeakSet();
const processedLabels = new WeakSet();
const processedMatchPairs = new WeakSet();
const processedDropdownOptions = new WeakSet();
const processedYesNoContainers = new WeakSet();
const processedOpenTextQuestions = new WeakSet();
const processedFillBlankDivs = new WeakSet();
const processedTableRows = new WeakSet();
const processedOpenTextButtons = new WeakSet();
const processedTableOptions = new WeakSet();
const processedFillBlankOptions = new WeakSet();
const processedTabsContainers = new WeakSet();
const processedAccordionContainers = new WeakSet();
const processedVideoElements = new WeakSet();
const pendingVideoElements = new WeakSet();
const processedInteractionDocuments = new WeakSet();
const processedMatchingContainers = new WeakSet();
const processedKeyboardDocuments = new WeakSet();
const processedAltSweepElements = new WeakSet();
const autoSubmitState = {
  requestId: 0,
  timerId: null,
  lastButton: null,
  lastClickAt: 0,
  scope: null
};
const pageTracerState = {
  requestId: 0,
  timerId: null
};
const notifyCloseState = {
  requestId: 0,
  timerId: null
};
const altSweepState = {
  enabled: false,
  timerId: null
};

let globalInteractionAutomationsInitialized = false;
let globalKeyboardAutomationsInitialized = false;

const normalizeText = value => value?.replace(/\s+/g, ' ').trim().toLowerCase() || '';

const isElementVisible = element => {
  if (!element)
    return false;

  if (element.offsetParent || element.getClientRects?.().length)
    return true;

  const style = window.getComputedStyle?.(element);
  return style?.visibility !== 'hidden' && style?.display !== 'none';
};

const isElementDisabled = element => {
  if (!element)
    return true;

  return Boolean(
    element.disabled
    || element.ariaDisabled === 'true'
    || element.getAttribute?.('aria-disabled') === 'true'
    || element.classList?.contains('is-disabled')
    || element.classList?.contains('disabled')
  );
};

const isElementClickable = element => isElementVisible(element) && !isElementDisabled(element);

const clickElement = element => {
  if (!element || !isElementClickable(element))
    return false;

  try {
    element.scrollIntoView({block: 'center', inline: 'center'});
  } catch (e) {
  }

  element.click();
  return true;
};

const getEventPathElements = event => (event.composedPath?.() || []).filter(node => node?.nodeType === Node.ELEMENT_NODE);

const findPathElement = (event, selector) => getEventPathElements(event)
  .find(element => element.matches?.(selector)) || null;

const findClosestPathElement = (event, selector) => getEventPathElements(event)
  .find(element => element.closest?.(selector))?.closest?.(selector) || null;

const findFirstClickable = (scope, selectors) => {
  for (const root of getScopedRoots(scope)) {
    let elements = [];

    try {
      elements = [...root.querySelectorAll(selectors)];
    } catch (e) {
      continue;
    }

    const match = elements.find(isElementClickable);

    if (match)
      return match;
  }

  return null;
};

const findVideoTrigger = event => {
  const directMatch = findPathElement(event, VIDEO_SELECTORS);

  if (directMatch)
    return directMatch;

  const containerMatch = findClosestPathElement(event, VIDEO_CONTAINER_SELECTORS);

  if (containerMatch)
    return containerMatch;

  return getEventPathElements(event).find(element => {
    try {
      return Boolean(element.querySelector?.(VIDEO_SELECTORS));
    } catch (e) {
      return false;
    }
  }) || null;
};

const findMatchingTrigger = event => findPathElement(event, MATCHING_DROPDOWN_SELECTORS)
  || findClosestPathElement(event, MATCHING_DROPDOWN_CONTAINER_SELECTORS);

const getShadowClickable = host => {
  const shadowRoot = host?.shadowRoot;

  if (!shadowRoot)
    return host;

  return shadowRoot.querySelector('button, [role="button"], .btn__action, .dropdown__btn, .dropdown__selected, .matching__item_main') || host;
};

const getScopedRoots = scope => {
  if (!scope || scope === document)
    return getSearchRoots(document);

  const roots = [];

  if (scope.querySelectorAll) {
    getSearchRoots(scope, roots);
  } else if (scope.ownerDocument) {
    getSearchRoots(scope.ownerDocument, roots);
  }

  if (!roots.includes(document)) {
    getSearchRoots(document, roots);
  }

  return roots;
};

const findButtonsByKeywords = (scope, selectors, keywords) => {
  const normalizedKeywords = keywords.map(normalizeText);

  for (const root of getScopedRoots(scope)) {
    let elements = [];

    try {
      elements = [...root.querySelectorAll(selectors)];
    } catch (e) {
      continue;
    }

    const match = elements.find(element => {
      if (!isElementClickable(element))
        return false;

      const text = normalizeText(
        element.textContent
        || element.value
        || element.getAttribute?.('aria-label')
        || element.getAttribute?.('title')
      );

      return normalizedKeywords.some(keyword => text.includes(keyword));
    });

    if (match)
      return match;
  }

  return null;
};

const getOrderedElements = (container, selector) => [...container.querySelectorAll(selector)]
  .filter(isElementVisible)
  .sort((a, b) => Number(a.dataset.index || 0) - Number(b.dataset.index || 0));

const getAltSweepCandidates = () => {
  const groups = [
    '.mcq__item-label.js-item-label:not(.is-disabled):not(.is-selected)',
    '.mcq__item.js-mcq-item:not(.is-disabled):not(.is-correct):not(.is-incorrect)',
    '.objectMatching-category-item:not(.is-disabled), .objectMatching-option-item:not(.is-disabled)',
    'matching-dropdown-view, .matching__item_main',
    '.accordion__item-btn[aria-expanded="false"]',
    '.tabs__nav-item-btn[aria-selected="false"], .js-tabs-nav-item-btn-click[aria-selected="false"], [role="tab"][aria-selected="false"]',
    '.pageTracer-button, [data-page-tracer-button-id]',
    'button[type="submit"], input[type="submit"], .js-btn-action, .btn__action'
  ];

  const candidates = [];

  for (const selector of groups) {
    for (const root of getScopedRoots(document)) {
      let elements = [];

      try {
        elements = [...root.querySelectorAll(selector)];
      } catch (e) {
        continue;
      }

      elements.forEach(element => {
        const target = element.matches?.(MATCHING_DROPDOWN_SELECTORS) ? getShadowClickable(element) : element;

        if (!target || processedAltSweepElements.has(target) || !isElementClickable(target))
          return;

        candidates.push(target);
      });
    }

    if (candidates.length > 0)
      break;
  }

  return candidates;
};

const stopAltSweep = () => {
  altSweepState.enabled = false;

  if (altSweepState.timerId) {
    clearTimeout(altSweepState.timerId);
    altSweepState.timerId = null;
  }
};

const runAltSweep = () => {
  if (!altSweepState.enabled)
    return;

  const [candidate] = getAltSweepCandidates();

  if (!candidate) {
    stopAltSweep();
    return;
  }

  processedAltSweepElements.add(candidate);
  clickElement(candidate);
  altSweepState.timerId = setTimeout(runAltSweep, ALT_SWEEP_INTERVAL);
};

const toggleAltSweep = () => {
  if (altSweepState.enabled) {
    stopAltSweep();
    return;
  }

  altSweepState.enabled = true;
  runAltSweep();
};

const scheduleClicks = (elements, delay = AUTOMATION_CLICK_DELAY) => {
  elements.forEach((element, index) => {
    setTimeout(() => {
      clickElement(element);
    }, index * delay);
  });
};

const finalizeVideoElement = video => {
  if (!video || processedVideoElements.has(video) || pendingVideoElements.has(video))
    return false;

  const complete = () => {
    if (processedVideoElements.has(video))
      return;

    try {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        video.currentTime = Math.max(video.duration - 0.01, 0);
      }
    } catch (e) {
    }

    try {
      video.pause();
    } catch (e) {
    }

    ['timeupdate', 'seeking', 'seeked', 'ended', 'pause'].forEach(type => {
      try {
        video.dispatchEvent(new Event(type, {bubbles: true}));
      } catch (e) {
      }
    });

    pendingVideoElements.delete(video);
    processedVideoElements.add(video);
  };

  if (Number.isFinite(video.duration) && video.duration > 0) {
    complete();
  } else {
    pendingVideoElements.add(video);
    ['loadedmetadata', 'loadeddata', 'durationchange', 'canplay'].forEach(type => {
      video.addEventListener(type, complete, {once: true});
    });
    setTimeout(complete, 50);
    setTimeout(complete, 400);
  }

  return true;
};

const finalizeVideosNear = trigger => {
  const scope = trigger?.closest?.('.component, .component__widget, .block, article-view') || trigger || document;
  let completed = false;

  for (const root of getScopedRoots(scope)) {
    let videos = [];

    try {
      videos = [...root.querySelectorAll('video')].filter(isElementVisible);
    } catch (e) {
      continue;
    }

    videos.forEach(video => {
      if (finalizeVideoElement(video)) {
        completed = true;
      }
    });
  }

  return completed;
};

const automateTabsFrom = trigger => {
  const container = trigger?.closest?.(TABS_CONTAINER_SELECTORS);

  if (!container || processedTabsContainers.has(container))
    return false;

  const buttons = getOrderedElements(container, TABS_SELECTORS)
    .filter(button => button.getAttribute('aria-selected') !== 'true');

  if (buttons.length === 0)
    return false;

  processedTabsContainers.add(container);
  scheduleClicks(buttons);
  return true;
};

const automateAccordionFrom = trigger => {
  const container = trigger?.closest?.(ACCORDION_CONTAINER_SELECTORS);

  if (!container || processedAccordionContainers.has(container))
    return false;

  const buttons = getOrderedElements(container, ACCORDION_SELECTORS)
    .filter(button => button.getAttribute('aria-expanded') !== 'true');

  if (buttons.length === 0)
    return false;

  processedAccordionContainers.add(container);
  scheduleClicks(buttons);
  return true;
};

const automateMatchingDropdownsFrom = trigger => {
  const container = trigger?.closest?.(MATCHING_DROPDOWN_CONTAINER_SELECTORS);

  if (!container || processedMatchingContainers.has(container))
    return false;

  const items = getOrderedElements(container, MATCHING_DROPDOWN_SELECTORS)
    .map(getShadowClickable)
    .filter(isElementClickable);

  if (items.length === 0)
    return false;

  processedMatchingContainers.add(container);
  scheduleClicks(items);
  return true;
};

const scheduleNotifyClose = scope => {
  notifyCloseState.requestId += 1;

  if (notifyCloseState.timerId) {
    clearTimeout(notifyCloseState.timerId);
    notifyCloseState.timerId = null;
  }

  const requestId = notifyCloseState.requestId;
  let attempts = 0;

  const tryClose = () => {
    if (requestId !== notifyCloseState.requestId)
      return;

    attempts += 1;

    const button = findFirstClickable(scope, NOTIFY_CLOSE_SELECTORS)
      || findButtonsByKeywords(scope, NOTIFY_CLOSE_SELECTORS, ['cerrar ventana emergente', 'cerrar', 'close']);

    if (button && clickElement(button)) {
      notifyCloseState.timerId = null;
      return;
    }

    if (attempts < PAGETRACER_RETRY_LIMIT) {
      notifyCloseState.timerId = setTimeout(tryClose, PAGETRACER_RETRY_DELAY);
    } else {
      notifyCloseState.timerId = null;
    }
  };

  notifyCloseState.timerId = setTimeout(tryClose, PAGETRACER_RETRY_DELAY);
};

const schedulePageTracerClose = scope => {
  pageTracerState.requestId += 1;

  if (pageTracerState.timerId) {
    clearTimeout(pageTracerState.timerId);
    pageTracerState.timerId = null;
  }

  const requestId = pageTracerState.requestId;
  let attempts = 0;

  const tryClose = () => {
    if (requestId !== pageTracerState.requestId)
      return;

    attempts += 1;
    const button = findFirstClickable(scope, PAGE_TRACER_CLOSE_SELECTORS)
      || findButtonsByKeywords(scope, PAGE_TRACER_CLOSE_SELECTORS, ['close', 'cerrar']);

    if (button && clickElement(button)) {
      pageTracerState.timerId = null;
      return;
    }

    if (attempts < PAGETRACER_RETRY_LIMIT) {
      pageTracerState.timerId = setTimeout(tryClose, PAGETRACER_RETRY_DELAY);
    } else {
      pageTracerState.timerId = null;
    }
  };

  pageTracerState.timerId = setTimeout(tryClose, PAGETRACER_RETRY_DELAY);
};

const getSearchRoots = (root, roots = [], visited = new WeakSet()) => {
  if (!root || visited.has(root))
    return roots;
  visited.add(root);
  roots.push(root);

  let elements = [];
  try {
    elements = [...root.querySelectorAll('*')];
  } catch (e) {
    return roots;
  }

  elements.forEach(element => {
    if (element.shadowRoot) {
      getSearchRoots(element.shadowRoot, roots, visited);
    }

    if (element.tagName === 'IFRAME') {
      try {
        if (element.contentDocument) {
          getSearchRoots(element.contentDocument, roots, visited);
        }
      } catch (e) {
      }
    }
  });

  return roots;
};

const isAutoSubmitButton = element => {
  if (!element || !isElementVisible(element))
    return false;

  const text = normalizeText(
    element.textContent
    || element.value
    || element.getAttribute?.('aria-label')
    || element.getAttribute?.('title')
  );

  return AUTO_SUBMIT_KEYWORDS.some(keyword => text.includes(keyword));
};

const findAutoSubmitButton = scope => findButtonsByKeywords(scope, AUTO_SUBMIT_SELECTORS, AUTO_SUBMIT_KEYWORDS);

const clickAutoSubmitButton = button => {
  if (!button)
    return false;

  const now = Date.now();

  if (autoSubmitState.lastButton === button && now - autoSubmitState.lastClickAt < 250)
    return true;

  autoSubmitState.lastButton = button;
  autoSubmitState.lastClickAt = now;
  button.click();
  return true;
};

const scheduleAutoSubmit = scope => {
  autoSubmitState.requestId += 1;
  autoSubmitState.scope = scope || document;

  if (autoSubmitState.timerId) {
    clearTimeout(autoSubmitState.timerId);
    autoSubmitState.timerId = null;
  }

  const requestId = autoSubmitState.requestId;
  let attempts = 0;

  const trySubmit = () => {
    if (requestId !== autoSubmitState.requestId)
      return;

    attempts += 1;
    const button = findAutoSubmitButton(autoSubmitState.scope);

    if (button && clickAutoSubmitButton(button)) {
      scheduleNotifyClose(autoSubmitState.scope);
      autoSubmitState.timerId = null;
      return;
    }

    if (attempts < AUTO_SUBMIT_RETRY_LIMIT) {
      autoSubmitState.timerId = setTimeout(trySubmit, AUTO_SUBMIT_RETRY_DELAY);
    } else {
      autoSubmitState.timerId = null;
    }
  };

  autoSubmitState.timerId = setTimeout(trySubmit, AUTO_SUBMIT_RETRY_DELAY);
};

const initGlobalInteractionAutomations = () => {
  const attachInteractionAutomation = rootDocument => {
    if (!rootDocument || processedInteractionDocuments.has(rootDocument))
      return;
    processedInteractionDocuments.add(rootDocument);

    rootDocument.addEventListener('click', event => {
    if (!event.isTrusted)
      return;

    const videoTrigger = findVideoTrigger(event);
    if (videoTrigger) {
      finalizeVideosNear(videoTrigger);
    }

    const tabsTrigger = findPathElement(event, TABS_SELECTORS);
    if (tabsTrigger) {
      automateTabsFrom(tabsTrigger);
    }

    const pageTracerTrigger = findPathElement(event, PAGE_TRACER_SELECTORS);
    if (pageTracerTrigger) {
      schedulePageTracerClose(pageTracerTrigger);
    }

    const matchingTrigger = findMatchingTrigger(event);
    if (matchingTrigger) {
      automateMatchingDropdownsFrom(matchingTrigger);
    }

    const accordionTrigger = findPathElement(event, ACCORDION_SELECTORS);
    if (accordionTrigger) {
      automateAccordionFrom(accordionTrigger);
    }
    }, true);
  };

  if (!globalInteractionAutomationsInitialized) {
    globalInteractionAutomationsInitialized = true;
    attachInteractionAutomation(document);
  }

  for (const root of getScopedRoots(document)) {
    if (root.nodeType === Node.DOCUMENT_NODE) {
      attachInteractionAutomation(root);
    }
  }
};

const initGlobalKeyboardAutomations = () => {
  const attachKeyboardAutomation = rootDocument => {
    if (!rootDocument || processedKeyboardDocuments.has(rootDocument))
      return;
    processedKeyboardDocuments.add(rootDocument);

    rootDocument.addEventListener('keydown', event => {
      if (event.repeat || event.key !== 'Alt')
        return;

      event.preventDefault();
      toggleAltSweep();
    }, true);
  };

  if (!globalKeyboardAutomationsInitialized) {
    globalKeyboardAutomationsInitialized = true;
    attachKeyboardAutomation(document);
  }

  for (const root of getScopedRoots(document)) {
    if (root.nodeType === Node.DOCUMENT_NODE) {
      attachKeyboardAutomation(root);
    }
  }
};

browser.runtime.onMessage.addListener(async (request) => {
  if (request?.componentsUrl && typeof request.componentsUrl === 'string' && !componentUrls.includes(request.componentsUrl)) {
    componentUrls.push(request.componentsUrl);
    await setComponents(request.componentsUrl);
    suspendMain();
  }
});

const setComponents = async url => {
  const getTextContentOfText = htmlString => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');
    return doc.body.textContent;
  };

  try {
    const res = await fetch(url);

    if (!res.ok)
      return;

    let json = await res.json();
    json = json
      .filter(component => component._items)
      .filter(component => !components.map(c => c._id).includes(component._id))
      .map(component => {
        component.body = getTextContentOfText(component.body);
        return component;
      });

    components.push(...json);
  } catch (e) {
    console.error(e);
  }
};

const setQuestionSections = async () => {
  let isAtLeaseOneSet = false;

  for (const component of components) {
    const questionDiv = deepHtmlSearch(document, `.${CSS.escape(component._id)}`);

    if (questionDiv) {
      isAtLeaseOneSet = true;
      let questionType = 'basic';

      if (component._items[0].text && component._items[0]._options) {
        questionType = 'dropdownSelect';
      } else if (component._items[0].question && component._items[0].answer) {
        questionType = 'match';
      } else if (component._items[0]._graphic?.alt && component._items[0]._graphic?.src) {
        questionType = 'yesNo';
      } else if (component._items[0].id && component._items[0]._options?.text) {
        questionType = 'openTextInput';
      } else if (component._items[0].preText && component._items[0].postText && component._items[0]._options?.[0]?.text) {
        questionType = 'fillBlanks';
      } else if (component._items[0]._options?.[0].text && typeof component._items[0]._options?.[0]._isCorrect === 'boolean') {
        questionType = 'tableDropdown';
      }

      questions.push({
        questionDiv,
        id: component._id,
        answersLength: component._items.length,
        questionType,
        items: component._items
      });
    }
  }

  if (!isAtLeaseOneSet) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    return await setQuestionSections();
  }
};

const findQuestionElement = document => {
  for (const component of components) {
    const questionElement = deepHtmlFindByTextContent(document, component.body);

    if (questionElement) {
      return questionElement;
    }
  }
};

const findAnswerInputsBasic = (document, questionId, answersLength, inputs = []) => {
  for (let i = 0; i < answersLength; i++) {
    const input = deepHtmlSearch(document, `#${CSS.escape(questionId)}-${i}-input`);
    const label = deepHtmlSearch(document, `#${CSS.escape(questionId)}-${i}-label`);

    if (input) {
      inputs.push({input, label});

      if (inputs.length === answersLength) {
        return inputs;
      }
    }
  }
};

const findAnswerInputsMatch = (document, answersLength, buttons = []) => {
  for (let i = 0; i < answersLength; i++) {
    const answerInputs = deepHtmlSearch(document, `[data-id="${i}"]`, false, 2);

    if (answerInputs) {
      buttons.push(answerInputs);

      if (buttons.length === answersLength) {
        return buttons;
      }
    }
  }
};

const setQuestionElements = () => {
  questions.map(question => {
    if (question.questionType === 'basic') {
      question.questionElement = findQuestionElement(question.questionDiv);
      question.inputs = findAnswerInputsBasic(question.questionDiv, question.id, question.answersLength) || [];
    } else if (question.questionType === 'match') {
      question.questionElement = findQuestionElement(question.questionDiv);
      question.inputs = findAnswerInputsMatch(question.questionDiv, question.answersLength) || [];
    } else if (question.questionType === 'dropdownSelect') {
      setDropdownSelectQuestions(question);
      question.skip = true;
    } else if (question.questionType === 'yesNo') {
      // yes - no questions are dynamic - they use the same elements but changes attributes
      initYeNoQuestions(question);
      question.skip = true;
    } else if (question.questionType === 'openTextInput') {
      // buttons are static but questions are moving around
      setOpenTextInputQuestions(question);
      question.skip = true;
    } else if (question.questionType === 'fillBlanks') {
      setFillBlanksQuestions(question);
      question.skip = true;
    } else if (question.questionType === 'tableDropdown') {
      // when there is no description in the table down only mouseover works
      setTableDropdownQuestions(question);
      question.skip = true;
    }

    return question;
  });
};

const setDropdownSelectQuestions = question => {
  question.items.forEach((item, i) => {
    const questionDiv = deepHtmlSearch(question.questionDiv, `[index="${i}"]`, true);
    const questionElement = deepHtmlFindByTextContent(questionDiv, item.text.trim());

    for (const [index, option] of item._options.entries()) {
      if (option._isCorrect) {
        const optionElement = deepHtmlSearch(questionDiv, `#dropdown__item-index-${index}`, true);

        questions.push({
          questionDiv,
          questionElement,
          inputs: [optionElement],
          questionType: question.questionType
        });
        return;
      }
    }
  });
};

const initYeNoQuestions = question => {
  if (processedYesNoContainers.has(question.questionDiv))
    return;
  processedYesNoContainers.add(question.questionDiv);

  const questionElement = deepHtmlSearch(question.questionDiv, `.img_question`);

  if (!questionElement)
    return;

  questionElement.parentElement?.addEventListener('click', e => {
    const questionElement = deepHtmlSearch(e.target, `.img_question`);

        for (const item of question.items) {
          if (questionElement.alt === item._graphic.alt) {
            if (item._shouldBeSelected) {
              const yesButton = deepHtmlSearch(question.questionDiv, `.user_selects_yes`);
              yesButton.click();
              scheduleAutoSubmit(question.questionDiv);
            } else {
              const noButton = deepHtmlSearch(question.questionDiv, `.user_selects_no`);
              noButton.click();
              scheduleAutoSubmit(question.questionDiv);
            }
          }
        }
  });

  const yesButton = deepHtmlSearch(question.questionDiv, `.user_selects_yes`);
  const noButton = deepHtmlSearch(question.questionDiv, `.user_selects_no`);

  yesButton?.addEventListener('mouseover', e => {
    if (e.ctrlKey) {
      const questionElement = deepHtmlSearch(question.questionDiv, `.img_question`);

          if (questionElement) {
            for (const item of question.items) {
              if (item._graphic.alt === questionElement.alt) {
                if (item._shouldBeSelected) {
                  yesButton.click();
                  scheduleAutoSubmit(question.questionDiv);
                }
                break;
              }
        }
      }
    }
  });

  noButton?.addEventListener('mouseover', e => {
    if (e.ctrlKey) {
      const questionElement = deepHtmlSearch(question.questionDiv, `.img_question`);

          if (questionElement) {
            for (const item of question.items) {
              if (item._graphic.alt === questionElement.alt) {
                if (!item._shouldBeSelected) {
                  noButton.click();
                  scheduleAutoSubmit(question.questionDiv);
                }
                break;
              }
        }
      }
    }
  });
};

const setOpenTextInputQuestions = question => {
  question.items.forEach((item, i) => {
    const questionElement = deepHtmlSearch(question.questionDiv, '#' + CSS.escape(`${question.id}-option-${i}`));
    const button = deepHtmlSearch(question.questionDiv, `.current-item-${i}`, true);

    if (questionElement && !processedOpenTextQuestions.has(questionElement)) {
      processedOpenTextQuestions.add(questionElement);

      questionElement.addEventListener('click', () => {
        setTimeout(() => {
          button.click();
          const currentQuestion = questionElement.textContent?.trim();
          const position = question.items.find(item => item._options.text.trim() === currentQuestion)?.position?.[0];

          if (position) {
            setTimeout(() => {
              const input = deepHtmlSearch(question.questionDiv, `[data-target="${position}"]`);
              if (input) {
                input?.click();
                scheduleAutoSubmit(question.questionDiv);
              } else {
                question.questionDiv.click();
              }
            }, 100);
          }
        }, 100);
      });
    }

    if (button && !processedOpenTextButtons.has(button)) {
      processedOpenTextButtons.add(button);

      button.addEventListener('click', () => {
        setTimeout(() => {
          const currentQuestion = questionElement?.textContent?.trim();
          const position = question.items.find(item => item._options.text.trim() === currentQuestion)?.position?.[0];

          if (position) {
            setTimeout(() => {
              const input = deepHtmlSearch(question.questionDiv, `[data-target="${position}"]`);

              if (input && !input.dataset.hoverListenerAdded) {
                input.dataset.hoverListenerAdded = 'true';

                input.addEventListener('mouseover', e => {
                  if (e.ctrlKey) {
                    input.click();
                    scheduleAutoSubmit(question.questionDiv);
                  }
                });
              }
            }, 100);
          }
        }, 100);
      });
    }
  });
};

const setFillBlanksQuestions = question => {
  const questionDivs = [...deepHtmlSearch(question.questionDiv, '.fillblanks__item', true, question.answersLength)];

  questionDivs.forEach(questionDiv => {
    if (processedFillBlankDivs.has(questionDiv))
      return;
    processedFillBlankDivs.add(questionDiv);

    const textContent = questionDiv.textContent.trim();

    for (const item of question.items) {
      if (textContent.startsWith(removeTagsFromString(item.preText)) && textContent.endsWith(removeTagsFromString(item.postText))) {
        for (const option of item._options) {
          if (option._isCorrect) {
            const dropdownItems = [...deepHtmlSearch(questionDiv, '.dropdown__item', true, item._options.length)];

            for (const dropdownItem of dropdownItems) {
              if (processedFillBlankOptions.has(dropdownItem))
                break;
              processedFillBlankOptions.add(dropdownItem);

              if (dropdownItem.textContent.trim() === option.text.trim()) {
                questionDiv.addEventListener('click', (e) => {
                  if (!e.target.textContent?.trim())
                    return;
                  dropdownItem.click();
                  scheduleAutoSubmit(question.questionDiv);
                });

                dropdownItem.addEventListener('mouseover', e => {
                  if (e.ctrlKey) {
                    dropdownItem.click();
                    scheduleAutoSubmit(question.questionDiv);
                  }
                });
                break;
              }
            }
            break;
          }
        }
        break;
      }
    }
  });
};

const setTableDropdownQuestions = question => {
  const sectionDivs = Array.from(deepHtmlSearch(question.questionDiv, 'tbody tr', true, question.answersLength));

  sectionDivs.forEach((section, i) => {
    if (processedTableRows.has(section))
      return;
    processedTableRows.add(section);

    const optionElements = Array.from(deepHtmlSearch(section, '[role="option"]', true, question.items[i]._options.length));
    const correctOption = question.items[i]._options.find(option => option._isCorrect);

    for (const optionElement of optionElements) {
      if (processedTableOptions.has(optionElement))
        break;
      processedTableOptions.add(optionElement);

      if (optionElement.textContent.trim() === correctOption.text.trim()) {
        section.addEventListener('click', () => {
          optionElement.click();
          scheduleAutoSubmit(question.questionDiv);
        });

        optionElement.addEventListener('mouseover', e => {
          if (e.ctrlKey) {
            optionElement.click();
            scheduleAutoSubmit(question.questionDiv);
          }
        });
        break;
      }
    }
  });
};

const initClickListeners = () => {
  questions.forEach((question) => {
    if (question.skip || !question.questionElement)
      return;

    if (processedQuestionElements.has(question.questionElement))
      return;
    processedQuestionElements.add(question.questionElement);

    question.questionElement.addEventListener('click', () => {
      if (question.questionType === 'basic') {
        const component = components.find(c => c._id === question.id);

        question.inputs.forEach(({input, label}, i) => {
          if (input.checked) {
            label.click();
          }

          if (component._items[i]._shouldBeSelected) {
            setTimeout(() => label.click(), 10);
          }
        });
        scheduleAutoSubmit(question.questionDiv);
      } else if (question.questionType === 'match') {
        question.inputs.forEach(input => {
          input[0].click();
          input[1].click();
        });
        scheduleAutoSubmit(question.questionDiv);
      } else if (question.questionType === 'dropdownSelect') {
        question.inputs[0]?.click();
        scheduleAutoSubmit(question.questionDiv);
      }
    });
  });
};

const initHoverListeners = () => {
  questions.forEach((question) => {
    if (question.skip)
      return;

    const component = components.find(c => c._id === question.id);

    if (question.questionType === 'basic') {
      question.inputs.forEach(({input, label}, i) => {
        if (!label || processedLabels.has(label))
          return;
        processedLabels.add(label);

        label.addEventListener('mouseover', e => {
          if (e.ctrlKey) {
            if (input.checked) {
              label.click();
            }

            if (component._items[i]._shouldBeSelected) {
              setTimeout(() => label.click(), 10);
              scheduleAutoSubmit(question.questionDiv);
            }
          }
        });
      });
    } else if (question.questionType === 'match') {
      question.inputs.forEach(input => {
        if (!input[0] || processedMatchPairs.has(input[0]))
          return;
        processedMatchPairs.add(input[0]);

        input[0].addEventListener('mouseover', e => {
          if (e.ctrlKey) {
            input[0].click();
            input[1].click();
            scheduleAutoSubmit(question.questionDiv);
          }
        });
      });
    } else if (question.questionType === 'dropdownSelect') {
      const optionEl = question.inputs[0];

      if (!optionEl || processedDropdownOptions.has(optionEl))
        return;
      processedDropdownOptions.add(optionEl);

      optionEl.addEventListener('mouseover', e => {
        if (e.ctrlKey) {
          optionEl.click();
          scheduleAutoSubmit(question.questionDiv);
        }
      });
    }
  });
};

const removeTagsFromString = string => string.replace(/<[^>]*>?/gm, '').trim();

const setIsReady = () => {
  for (const component of components) {
    const questionDiv = deepHtmlSearch(document, `.${CSS.escape(component._id)}`);

    if (questionDiv)
      return true;
  }

  return false;
};

const main = async () => {
  initGlobalInteractionAutomations();
  initGlobalKeyboardAutomations();
  questions = [];
  await setQuestionSections();
  setQuestionElements();
  initClickListeners();
  initHoverListeners();
};

const suspendMain = () => {
  if (isSuspendRunning) return;

  isSuspendRunning = true;

  const checking = async () => {
    if (setIsReady()) {
      clearInterval(interval);
      main().finally(() => {
        isSuspendRunning = false;
      });
    }
  };

  const interval = setInterval(checking, 1000);
};

if (window) {
  initGlobalInteractionAutomations();
  initGlobalKeyboardAutomations();
  setInterval(() => {
    initGlobalInteractionAutomations();
    initGlobalKeyboardAutomations();

    if (isSuspendRunning || components.length === 0)
      return;

    let visibleContainers = 0;
    for (const component of components) {
      if (deepHtmlSearch(document, `.${CSS.escape(component._id)}`)) {
        visibleContainers++;
      }
    }

    const processedCount = questions.length;

    if (visibleContainers !== processedCount) {
      suspendMain();
    }
  }, 1000);
}
