import browser from 'webextension-polyfill';
import {deepHtmlSearch, deepHtmlFindByTextContent} from "./domHelper";

let isSuspendRunning = false;
const components = [];
let questions = [];
const componentUrls = [];
const AUTO_SUBMIT_KEYWORDS = ['submit', 'enviar', 'check', 'check answer'];
const AUTO_SUBMIT_SELECTORS = 'button, [role="button"], input[type="button"], input[type="submit"], .js-btn-action, .btn__action';

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
const autoSubmitState = {
  requestId: 0,
  frameId: null,
  lastButton: null,
  lastClickAt: 0
};

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

const findAutoSubmitButton = () => {
  const roots = getSearchRoots(document);

  for (const root of roots) {
    let buttons = [];

    try {
      buttons = [...root.querySelectorAll(AUTO_SUBMIT_SELECTORS)];
    } catch (e) {
      continue;
    }

    const match = buttons.find(button => isAutoSubmitButton(button) && !isElementDisabled(button));

    if (match)
      return match;
  }

  return null;
};

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

const scheduleAutoSubmit = () => {
  autoSubmitState.requestId += 1;

  if (autoSubmitState.frameId) {
    cancelAnimationFrame(autoSubmitState.frameId);
    autoSubmitState.frameId = null;
  }

  const requestId = autoSubmitState.requestId;
  let attempts = 0;

  const trySubmit = () => {
    if (requestId !== autoSubmitState.requestId)
      return;

    attempts += 1;
    const button = findAutoSubmitButton();

    if (button && clickAutoSubmitButton(button)) {
      autoSubmitState.frameId = null;
      return;
    }

    if (attempts < 60) {
      autoSubmitState.frameId = requestAnimationFrame(trySubmit);
    } else {
      autoSubmitState.frameId = null;
    }
  };

  autoSubmitState.frameId = requestAnimationFrame(trySubmit);
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
              scheduleAutoSubmit();
            } else {
              const noButton = deepHtmlSearch(question.questionDiv, `.user_selects_no`);
              noButton.click();
              scheduleAutoSubmit();
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
                  scheduleAutoSubmit();
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
                  scheduleAutoSubmit();
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
                scheduleAutoSubmit();
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
                    scheduleAutoSubmit();
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
                  scheduleAutoSubmit();
                });

                dropdownItem.addEventListener('mouseover', e => {
                  if (e.ctrlKey) {
                    dropdownItem.click();
                    scheduleAutoSubmit();
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
          scheduleAutoSubmit();
        });

        optionElement.addEventListener('mouseover', e => {
          if (e.ctrlKey) {
            optionElement.click();
            scheduleAutoSubmit();
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
        scheduleAutoSubmit();
      } else if (question.questionType === 'match') {
        question.inputs.forEach(input => {
          input[0].click();
          input[1].click();
        });
        scheduleAutoSubmit();
      } else if (question.questionType === 'dropdownSelect') {
        question.inputs[0]?.click();
        scheduleAutoSubmit();
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
              scheduleAutoSubmit();
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
            scheduleAutoSubmit();
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
          scheduleAutoSubmit();
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
  setInterval(() => {
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
