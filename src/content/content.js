import browser from 'webextension-polyfill';
import {
  deepHtmlSearch,
  deepHtmlFindByTextContent,
  enableTextSelectionRecursive,
  deepHtmlFindByTextContentPart, findVisibleFromComponents,
  disableAnimationsDeep, findElementsByIdClassAsync
} from "./domHelper";

let isSuspendRunning = false;
const components = [];
let questions = [];
const componentUrls = [];

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
const processedAccordionQuestions = new WeakSet();

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

browser.runtime.onMessage.addListener(async (request) => {
  if (request?.componentsUrl && typeof request.componentsUrl === 'string' && !componentUrls.includes(request.componentsUrl)) {
    if (!componentUrls.includes(request.componentsUrl)) {
      componentUrls.push(request.componentsUrl);
      await setComponents(request.componentsUrl);
      suspendMain();
    }
  }
});

const getTextContentOfText = htmlString => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, 'text/html');
  return doc.body.textContent;
};

const setComponents = async url => {
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

const setFinalExamComponentsFromStorage = async () => {
  const serviceId = new URL(window.location).searchParams.get('id');
  const finalUrls = await browser.storage.local.get(`service-${serviceId}`);
  const urlsArray = finalUrls?.[`service-${serviceId}`];

  if (Array.isArray(urlsArray)) {
    for (const url of urlsArray) {
      if (!componentUrls.includes(url)) {
        componentUrls.push(url);
        await setComponents(url);
      }
    }
  }
};

const setQuestionSections = async () => {
  let isAtLeaseOneSet = false;

  const foundFromComponents = await findElementsByIdClassAsync(document, components);

  for (const component of components) {
    const data = foundFromComponents[component._id];

    const questionDiv = data?.questionDiv;
    const questionElement = data?.questionElement;

    if (questionDiv) {
      isAtLeaseOneSet = true;
      let questionType = 'basic';

      if (component._component === 'accordion') {
        questionType = 'accordion';
      } else if (component._items[0].text && component._items[0]._options) {
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
        questionElement,
        id: component._id,
        answersLength: component._items.length,
        questionType,
        items: component._items
      });
    }
  }

  return isAtLeaseOneSet;
};

const findAnswerInputsBasic = (question) => {
  const inputs = [];

  for (let i = 0; i < question.answersLength; i++) {
    const div = deepHtmlFindByTextContentPart(question.questionDiv, question.items[i].text);
    const input = deepHtmlSearch(question.questionDiv, `#${CSS.escape(question.id)}-${i}-input`);
    const label = deepHtmlSearch(question.questionDiv, `#${CSS.escape(question.id)}-${i}-label`);

    inputs.push({
      input: input,
      label: label,
      div: div
    });

    if (inputs.length === question.answersLength) {
      return inputs;
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
      if (!question.items[0].text || question.items.length !== question.answersLength) {
        question.skip = true;
        return;
      }

      question.items = question.items.map(item => ({...item, text: getTextContentOfText(item.text.trim())}));
      question.inputs = findAnswerInputsBasic(question) || [];
    } else if (question.questionType === 'match') {
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
    } else if (question.questionType === 'accordion') {
      setAccordionQuestions(question);
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
        } else {
          const noButton = deepHtmlSearch(question.questionDiv, `.user_selects_no`);
          noButton.click();
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
            }
            break;
          }
        }
      }
    }
  });
};

const setOpenTextInputQuestions = question => {
  question.items.forEach(async (item, i) => {
    await disableAnimationsDeep(question.questionDiv);

    let currentAnswerElement = deepHtmlSearch(question.questionDiv, '#' + CSS.escape(`${question.id}-option-${i}`));

    if (!currentAnswerElement) {
      currentAnswerElement = deepHtmlSearch(question.questionDiv, `#item-${i}`);
    }

    const button = deepHtmlSearch(question.questionDiv, `.current-item-${i}`, true);

    if (currentAnswerElement && !processedOpenTextQuestions.has(currentAnswerElement)) {
      processedOpenTextQuestions.add(currentAnswerElement);

      currentAnswerElement.addEventListener('click', () => {
        setTimeout(() => {
          button.click();

          let currentQuestion, rightPosition;

          for (const item of question.items) {
            currentQuestion = deepHtmlFindByTextContentPart(currentAnswerElement, item._options.text.trim());
            rightPosition = item.position[0];

            if (!!currentQuestion) {
              break;
            }
          }

          if (rightPosition) {
            setTimeout(() => {
              const input = deepHtmlSearch(question.questionDiv, `[data-target="${rightPosition}"]`);
              if (input) {
                input?.click();
              } else {
                question.questionDiv.click();
              }
            }, 100);
          }
        }, 100);
      });
    }

    // not sure if this part even do something anymore
    if (button && !processedOpenTextButtons.has(button)) {
      processedOpenTextButtons.add(button);

      button.addEventListener('click', () => {
        setTimeout(() => {
          let currentQuestion, rightPosition;

          for (const item of question.items) {
            currentQuestion = deepHtmlFindByTextContentPart(currentAnswerElement, item._options.text.trim());
            rightPosition = item.position[0];

            if (!!currentQuestion) {
              break;
            }
          }

          if (rightPosition) {
            setTimeout(() => {
              const input = deepHtmlSearch(question.questionDiv, `[data-target="${rightPosition}"]`);

              if (input && !input.dataset.hoverListenerAdded) {
                input.dataset.hoverListenerAdded = 'true';

                input.addEventListener('mouseover', e => {
                  if (e.ctrlKey) {
                    input.click();
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
                });

                dropdownItem.addEventListener('mouseover', e => {
                  if (e.ctrlKey)
                    dropdownItem.click();
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
        });

        optionElement.addEventListener('mouseover', e => {
          if (e.ctrlKey) {
            optionElement.click();
          }
        });
        break;
      }
    }
  });
};

const setAccordionQuestions = question => {
  if (processedAccordionQuestions.has(question.questionDiv))
    return;
  processedAccordionQuestions.add(question.questionDiv);

  const buttons = [...question.questionDiv.querySelectorAll('button')];

  for (const button of buttons) {
    button.addEventListener('mouseenter', async e => {
      if (!e.ctrlKey)
        return;

      button.click();
      await sleep(1);
      button.click();
    });
  }
};

const initClickListeners = () => {
  questions.forEach((question) => {
    if (question.skip || !question.questionElement || !question.inputs)
      return;

    if (processedQuestionElements.has(question.questionElement))
      return;
    processedQuestionElements.add(question.questionElement);

    question.questionElement.addEventListener('click', () => {
      if (question.questionType === 'basic') {
        const component = components.find(c => c._id === question.id);

        question.inputs.forEach(({input, label, div}, i) => {
          if (!input || !label) {
            label = [...div.querySelectorAll('label')].find(el => el.textContent.includes(component._items[i].text));
            const inputId = label.getAttribute('for');
            input = div.querySelector(`[id="${inputId}"]`);
          }

          if (input.checked) {
            label.click();
          }

          if (component._items[i]._shouldBeSelected) {
            setTimeout(() => label.click(), 50);
          }
        });
      } else if (question.questionType === 'match') {
        question.inputs.forEach(input => {
          input[0].click();
          input[1].click();
        });
      } else if (question.questionType === 'dropdownSelect') {
        question.inputs[0]?.click();
      }
    });
  });
};

const initHoverListeners = () => {
  questions.forEach((question) => {
    if (question.skip || !question.inputs)
      return;

    const component = components.find(c => c._id === question.id);

    if (question.questionType === 'basic') {
      question.inputs.forEach(({input, label, div}, i) => {
        if (!input || !label) {
          label = [...div.querySelectorAll('label')].find(el => el.textContent.includes(component._items[i].text));
          const inputId = label.getAttribute('for');
          input = div.querySelector(`[id="${inputId}"]`);
        }

        if (!label || processedLabels.has(label))
          return;
        processedLabels.add(label);

        label.addEventListener('mouseenter', e => {
          if (e.ctrlKey) {
            if (input.checked) {
              label.click();
            }

            if (component._items[i]._shouldBeSelected) {
              setTimeout(() => label.click(), 50);
            }
          }
        });
      });
    } else if (question.questionType === 'match') {
      question.inputs.forEach(input => {
        if (!input[0] || processedMatchPairs.has(input[0]))
          return;
        processedMatchPairs.add(input[0]);

        input[0].addEventListener('mouseenter', e => {
          if (e.ctrlKey) {
            input[0].click();
            input[1].click();
          }
        });
      });
    } else if (question.questionType === 'dropdownSelect') {
      const optionEl = question.inputs[0];

      if (!optionEl || processedDropdownOptions.has(optionEl))
        return;
      processedDropdownOptions.add(optionEl);

      optionEl.addEventListener('mouseenter', e => {
        if (e.ctrlKey) {
          optionEl.click();
        }
      });
    }
  });
};

const removeTagsFromString = string => string.replace(/<[^>]*>?/gm, '').trim();
const areSetsEqual = (a, b) => a.size === b.size && [...a].every(v => b.has(v));

const main = async () => {
  await setFinalExamComponentsFromStorage();

  questions = [];
  const isAtLeaseOneSet = await setQuestionSections();

  if (!isAtLeaseOneSet)
    return;

  setQuestionElements();
  initClickListeners();
  initHoverListeners();
};

const suspendMain = () => {
  if (isSuspendRunning) return;

  isSuspendRunning = true;

  main().finally(() => {
    isSuspendRunning = false;
  });
};

if (window) {
  setInterval(async () => {
    if (isSuspendRunning || components.length === 0)
      return;

    let visibleContainers = await findVisibleFromComponents(document, components);
    const processedCount = new Set(questions.map(q => q.id));

    if (!areSetsEqual(visibleContainers, processedCount)) {
      suspendMain();
    }
  }, 500);

  setInterval(() => {
    enableTextSelectionRecursive();
  }, 2000);
}
