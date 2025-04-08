import browser from 'webextension-polyfill';
import {deepHtmlSearch, deepHtmlFindByTextContent} from "./domHelper";

let isSuspendRunning = false;
let isInitiated = false;
const components = [];
let questions = [];
const componentUrls = [];

browser.runtime.onMessage.addListener(async (request) => {
  if (request?.componentsUrl && typeof request.componentsUrl === 'string' && !componentUrls.includes(request.componentsUrl)) {
    componentUrls.push(request.componentsUrl);
    await setComponents(request.componentsUrl);
    if (isInitiated) {
      suspendMain();
    }
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
  question.items.forEach((item, i) => {
    const questionElement = deepHtmlSearch(question.questionDiv, '#' + CSS.escape(`${question.id}-option-${i}`));
    const button = deepHtmlSearch(question.questionDiv, `.current-item-${i}`, true);

    questionElement?.addEventListener('click', () => {
      setTimeout(() => {
        button.click();
        const currentQuestion = questionElement?.textContent?.trim();
        const position = question.items.find(item => item._options.text.trim() === currentQuestion)?.position?.[0];

        if (position) {
          setTimeout(() => {
            const input = deepHtmlSearch(question.questionDiv, `[data-target="${position}"]`);
            if (input) {
              input?.click();
            } else {
              question.questionDiv.click();
            }
          }, 100);
        }
      }, 100);
    });

    button?.addEventListener('click', () => {
      setTimeout(() => {
        const currentQuestion = questionElement?.textContent?.trim();
        const position = question.items.find(item => item._options.text.trim() === currentQuestion)?.position?.[0];

        if (position) {
          setTimeout(() => {
            const input = deepHtmlSearch(question.questionDiv, `[data-target="${position}"]`);

            input?.addEventListener('mouseover', e => {
              if (e.ctrlKey) {
                input.click();
              }
            });
          }, 100);
        }
      }, 100);
    });
  });
};

const setFillBlanksQuestions = question => {
  const questionDivs = [...deepHtmlSearch(question.questionDiv, '.fillblanks__item', true, question.answersLength)];

  if (questionDivs.length > 0) {
    questionDivs.forEach(questionDiv => {
      const textContent = questionDiv.textContent.trim();

      for (const item of question.items) {
        if (textContent.startsWith(removeTagsFromString(item.preText)) && textContent.endsWith(removeTagsFromString(item.postText))) {
          for (const option of item._options) {
            if (option._isCorrect) {
              const dropdownItems = [...deepHtmlSearch(questionDiv, '.dropdown__item', true, item._options.length)];

              for (const dropdownItem of dropdownItems) {
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
  }
};

const setTableDropdownQuestions = question => {
  const sectionDivs = Array.from(deepHtmlSearch(question.questionDiv, 'tbody tr', true, question.answersLength));

  sectionDivs.forEach((section, i) => {
    const optionElements = Array.from(deepHtmlSearch(section, '[role="option"]', true, question.items[i]._options.length));
    const correctOption = question.items[i]._options.find(option => option._isCorrect);

    for (const optionElement of optionElements) {
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

const initClickListeners = () => {
  questions.forEach((question) => {
    if (question.skip)
      return;

    question.questionElement?.addEventListener('click', () => {
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
    if (question.skip)
      return;

    const component = components.find(c => c._id === question.id);

    if (question.questionType === 'basic') {
      question.inputs.forEach(({input, label}, i) => {
        label?.addEventListener('mouseover', e => {
          if (e.ctrlKey) {
            if (input.checked) {
              label.click();
            }

            if (component._items[i]._shouldBeSelected) {
              setTimeout(() => label.click(), 10);
            }
          }
        });
      });
    } else if (question.questionType === 'match') {
      question.inputs.forEach(input => {
        input[0]?.addEventListener('mouseover', e => {
          if (e.ctrlKey) {
            input[0].click();
            input[1].click();
          }
        });
      });
    } else if (question.questionType === 'dropdownSelect') {
      question.inputs[0]?.addEventListener('mouseover', e => {
        if (e.ctrlKey) {
          question.inputs[0].click();
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
  let isReady = false;
  isSuspendRunning = true;

  const checking = async () => {
    if (!isReady) {
      isReady = !!setIsReady();
    } else {
      clearInterval(interval);
      await main();
      isInitiated = true;
      isSuspendRunning = false;
    }
  };

  const interval = setInterval(checking, 1000);
};

if (window) {
  let previousUrl = '';

  setInterval(() => {
    if (window.location.href !== previousUrl) {
      previousUrl = window.location.href;

      if (!isSuspendRunning)
        suspendMain();
    }
  }, 1000);
}
