import browser from 'webextension-polyfill';

let isReady = false;
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

const setQuestions = document => {
  if (!document) return;

  const iframes = document.querySelectorAll('iframe');

  let isSetNew = false;

  for (const iframe of iframes) {
    setQuestions(iframe.contentDocument);
    isSetNew = true;
  }

  if (isSetNew) {
    return;
  }

  const documents = [...document.querySelectorAll('*')]
    .filter(el => el.tagName.toLowerCase().endsWith('-view') || el.tagName.toLowerCase() === 'app-root');

  for (const document of documents) {
    for (const component of components) {
      const questionDiv = document.shadowRoot.querySelector(`.${CSS.escape(component._id)}`);

      if (questionDiv) {
        questions.push({questionDiv, id: component._id, answersLength: component._items.length});
        break;
      }
    }

    setQuestions(document.shadowRoot);
  }
};

const findQuestionElement = currentDocument => {
  for (const component of components) {
    const questionElement = [...currentDocument.querySelectorAll('*')]
      .filter(el => el.textContent === component.body);

    if (questionElement.length > 0) {
      return questionElement[0];
    }
  }

  const documents = [...currentDocument.querySelectorAll('*')]
    .filter(el => el.tagName.toLowerCase().endsWith('-view'));

  for (const document of documents) {
    for (const component of components) {
      const questionElement = [...document.shadowRoot.querySelectorAll('*')]
        .filter(el => el.textContent === component.body);

      if (questionElement.length > 0) {
        return questionElement[0];
      }
    }

    if (document.shadowRoot) {
      findQuestionElement(document.shadowRoot);
    }
  }
};

const findAnswerInputsBasic = (currentDocument, questionId, answersLength, inputs = []) => {
  for (let i = 0; i < answersLength; i++) {
    const answerInput = currentDocument.querySelector(`#${CSS.escape(questionId)}-${i}-input`);

    if (answerInput) {
      inputs.push(answerInput);

      if (inputs.length === answersLength) {
        return inputs;
      }
    }
  }

  const documents = [...currentDocument.querySelectorAll('*')]
    .filter(el => el.tagName.toLowerCase().endsWith('-view'));

  for (const document of documents) {
    for (let i = 0; i < answersLength; i++) {
      const answerInput = document.shadowRoot.querySelector(`#${CSS.escape(questionId)}-${i}-input`);

      if (answerInput) {
        inputs.push(answerInput);

        if (inputs.length === answersLength) {
          return inputs;
        }
      }
    }

    if (document.shadowRoot) {
      findAnswerInputsBasic(document.shadowRoot, questionId, answersLength, inputs);
    }
  }
};

const findAnswerInputsMatch = (currentDocument, questionId, answersLength, buttons = []) => {
  for (let i = 0; i < answersLength; i++) {
    const answerInputs = currentDocument.querySelectorAll(`[data-id="${i}"]`);

    if (answerInputs && answerInputs.length === 2) {
      buttons.push(answerInputs);

      if (buttons.length === answersLength) {
        return buttons;
      }
    }
  }

  const documents = [...currentDocument.querySelectorAll('*')]
    .filter(el => el.tagName.toLowerCase().endsWith('-view'));

  for (const document of documents) {
    for (let i = 0; i < answersLength; i++) {
      const answerInputs = document.shadowRoot.querySelector(`[data-id="${i}"]`);

      if (answerInputs && answerInputs.length === 2) {
        buttons.push(answerInputs);

        if (buttons.length === answersLength) {
          return buttons;
        }
      }
    }

    if (document.shadowRoot) {
      findAnswerInputsMatch(document.shadowRoot, questionId, answersLength, buttons);
    }
  }
};

const setQuestionElements = () => {
  questions.map(question => {
    question.questionElement = findQuestionElement(question.questionDiv);
    question.inputs = findAnswerInputsBasic(question.questionDiv, question.id, question.answersLength) || [];
    question.answerType = 'basic';

    if (question.inputs.length === 0) {
      question.inputs = findAnswerInputsMatch(question.questionDiv, question.id, question.answersLength) || [];
      question.answerType = 'match';
    }
    return question;
  });
};

const initClickListeners = () => {
  questions.forEach((question) => {
    const component = components.find(c => c._id === question.id);

    question.questionElement.addEventListener('click', () => {
      if (question.answerType === 'basic') {
        question.inputs.forEach((input, i) => {
          if (input.checked) {
            input.click();
          }

          if (component._items[i]._shouldBeSelected) {
            input.click();
          }
        });
      } else if (question.answerType === 'match') {
        question.inputs.forEach(input => {
          input[0].click();
          input[1].click();
        });
      }
    });
  });
};

const setIsReady = document => {
  if (!document) return;

  const iframes = document.querySelectorAll('iframe');

  let isSetNew = false;

  for (const iframe of iframes) {
    setIsReady(iframe.contentDocument);
    isSetNew = true;
  }

  if (!isSetNew) {
    const documents = [...document.querySelectorAll('*')]
      .filter(el => el.tagName.toLowerCase().endsWith('-view') || el.tagName.toLowerCase() === 'app-root');

    for (const document of documents) {
      for (const component of components) {
        const questionDiv = document?.shadowRoot?.querySelector(`.${CSS.escape(component._id)}`);

        if (questionDiv) {
          isReady = true;
          return;
        }
      }

      setIsReady(document.shadowRoot);
    }
  }
};

const main = () => {
  questions = [];
  setQuestions(document);
  setQuestionElements();
  initClickListeners();
};

const suspendMain = () => {
  const checking = () => {
    if (!isReady) {
      setIsReady(document);
    } else {
      clearInterval(interval);
      main();
      isInitiated = true;
    }
  };

  const interval = setInterval(checking, 1000);
};

if (window) {
  let previousUrl = '';

  setInterval(() => {
    if (window.location.href !== previousUrl) {
      previousUrl = window.location.href;
      suspendMain();
    }
  }, 1000);

  window.addEventListener('load', suspendMain);
}
