import { api } from '../services/api.js';
import { h } from '../core/dom.js';
import { refreshAccounts } from '../state/actions.js';
import { toast } from './toast.js';
import { openModal } from './modal.js';
import { errorMessage } from '../core/format.js';

const ELY_REGISTER_URL = 'https://account.ely.by/register';

/**
 * Sign-in dialog for Ely.by, opened over the accounts dialog. The two-factor code field
 * appears only when Ely.by asks for it. Closes itself once the account is added.
 */
export function openElyLoginModal() {
  const submitOnEnter = (event) => {
    if (event.key === 'Enter') {
      submit();
    }
  };
  const loginInput = h('input', {
    class: 'input',
    type: 'text',
    placeholder: 'Ник или e-mail Ely.by',
    autocomplete: 'username',
    spellcheck: 'false',
    onkeydown: submitOnEnter,
  });
  const passwordInput = h('input', {
    class: 'input',
    type: 'password',
    placeholder: 'Пароль',
    autocomplete: 'current-password',
    onkeydown: submitOnEnter,
  });
  const codeInput = h('input', {
    class: 'input',
    type: 'text',
    inputmode: 'numeric',
    maxlength: '6',
    placeholder: 'Код из приложения (6 цифр)',
    autocomplete: 'one-time-code',
    onkeydown: submitOnEnter,
  });
  const codeField = h(
    'div',
    { class: 'field', hidden: true },
    h('span', { class: 'field__label' }, 'Код двухэтапной проверки'),
    h('span', { class: 'field__hint' }, 'Введите код из приложения-аутентификатора.'),
    codeInput,
  );
  const submitButton = h('button', { class: 'btn btn--primary btn--compact', type: 'button', onclick: () => submit() }, 'Войти');
  const cancelButton = h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => modal.close() }, 'Отмена');
  const registerLink = h(
    'button',
    {
      class: 'btn btn--ghost btn--compact',
      type: 'button',
      onclick: () => api.app.openExternal(ELY_REGISTER_URL).catch((error) => toast(errorMessage(error), 'error')),
    },
    'Нет аккаунта? Регистрация на Ely.by',
  );

  const content = h(
    'div',
    { class: 'modal__section' },
    h('p', { class: 'field__hint' }, 'Бесплатный аккаунт со своим скином. Работает на серверах с авторизацией Ely.by. Пароль не сохраняется.'),
    h('div', { class: 'field' }, h('span', { class: 'field__label' }, 'Ник или e-mail'), loginInput),
    h('div', { class: 'field' }, h('span', { class: 'field__label' }, 'Пароль'), passwordInput),
    codeField,
    registerLink,
  );

  let busy = false;
  let closed = false;

  async function submit() {
    if (busy || closed) {
      return;
    }
    busy = true;
    submitButton.disabled = true;
    submitButton.textContent = 'Входим…';
    try {
      const result = await api.accounts.addEly({
        login: loginInput.value,
        password: passwordInput.value,
        totp: codeField.hidden ? '' : codeInput.value,
      });
      if (result?.status === 'totp-required') {
        codeField.hidden = false;
        codeInput.focus();
        toast('Введите код двухэтапной проверки Ely.by', 'info');
        return;
      }
      await refreshAccounts();
      toast(`Аккаунт Ely.by ${result?.account?.username ?? ''} добавлен`, 'success');
      modal.close();
    } catch (error) {
      codeInput.value = '';
      toast(errorMessage(error), 'error');
    } finally {
      busy = false;
      submitButton.disabled = false;
      submitButton.textContent = 'Войти';
    }
  }

  const modal = openModal({
    title: 'Вход через Ely.by',
    content,
    footer: [cancelButton, submitButton],
    onClose: () => {
      closed = true;
    },
  });
}
