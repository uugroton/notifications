// Drive Notifications — test page.
// Reads the personal token from the address (after "#t="), asks the
// Apps Script back end for this person's folders, and shows them.
// Requests go out without Google sign-in cookies, so it works no matter
// how many Google accounts the browser is signed into.

const API_URL = 'https://script.google.com/macros/s/AKfycbx0l9REFPIVIQ23Kchi82x-m-sOr_hAsS6_iVXP-Q5k6q0pp--CFST62obpij3mIbMSiA/exec';

(function () {
  // Refuse to run inside another site's frame.
  if (window.top !== window.self) {
    document.body.textContent = '';
    return;
  }

  const status = document.getElementById('status');
  const show = (text) => { status.textContent = text; status.hidden = false; };

  const hash = new URLSearchParams(location.hash.slice(1));
  const query = new URLSearchParams(location.search);
  const token = hash.get('t') || query.get('t') || '';

  if (!token) {
    show("This page needs your personal link. Open it from your Drive Notifications email.");
    return;
  }

  const url = API_URL + '?api=folders&t=' + encodeURIComponent(token);
  fetch(url, { credentials: 'omit', redirect: 'follow' })
    .then((res) => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then((data) => {
      if (!data.ok) {
        show("This link isn't valid or has been replaced. Ask for a new one.");
        return;
      }
      status.hidden = true;
      document.getElementById('email').textContent = data.email;
      const list = document.getElementById('folders');
      list.textContent = '';
      (data.folders || []).forEach((name) => {
        const li = document.createElement('li');
        li.textContent = name;
        list.appendChild(li);
      });
      if (!data.folders || data.folders.length === 0) {
        const li = document.createElement('li');
        li.className = 'note';
        li.textContent = 'No folders found for this address.';
        list.appendChild(li);
      }
      document.getElementById('signed-in').hidden = false;
    })
    .catch(() => {
      show("We couldn't reach the notifications service. Please try again in a minute.");
    });
})();
