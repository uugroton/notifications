// Drive Notifications — the member page.
//
// Shows the folders a person follows, recommended folders, and every folder
// they can open, with one-tap Follow and Stop. All data comes from the Apps
// Script service; requests carry no Google sign-in cookies, so the page works
// however many Google accounts the browser is signed into.

const API_URL = 'https://script.google.com/macros/s/AKfycbx0l9REFPIVIQ23Kchi82x-m-sOr_hAsS6_iVXP-Q5k6q0pp--CFST62obpij3mIbMSiA/exec';
const STORE_KEY = 'driveNotifications.link';
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const state = { token: '', view: null, busy: false };
const $ = (id) => document.getElementById(id);

// ---- Small helpers ------------------------------------------------------------

/** Creates an element. props: text, className, attributes, and on<event> handlers. */
function el(tag, props, children) {
  const node = document.createElement(tag);
  Object.entries(props || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === false) return;
    if (key === 'text') node.textContent = value;
    else if (key === 'className') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  });
  (children || []).forEach((c) => { if (c) node.appendChild(c); });
  return node;
}

function hourLabel(h) {
  const n = Number(h);
  if (n === 0) return '12am';
  if (n === 12) return '12pm';
  return n < 12 ? `${n}am` : `${n - 12}pm`;
}

function describe(sub) {
  if (sub.frequency === 'hourly') return 'every hour';
  if (sub.frequency === 'weekly') return `once a week, on ${sub.weeklyDay}`;
  return `once a day, at ${hourLabel(sub.dailyHour)}`;
}

function storeToken(token) {
  try {
    if (token) localStorage.setItem(STORE_KEY, token);
    else localStorage.removeItem(STORE_KEY);
  } catch (e) {
    // Private browsing: the page still works from the emailed link.
  }
}

function readToken() {
  const fromLink = new URLSearchParams(location.hash.slice(1)).get('t');
  if (fromLink) {
    storeToken(fromLink);
    return fromLink;
  }
  try {
    return localStorage.getItem(STORE_KEY) || '';
  } catch (e) {
    return '';
  }
}

async function api(action, data) {
  const res = await fetch(API_URL, {
    method: 'POST',
    // text/plain keeps this a simple request that Apps Script can answer.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ action: action }, data)),
    credentials: 'omit',
    redirect: 'follow'
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

let toastTimer = null;
function toast(text, actionLabel, action) {
  const box = $('toast');
  $('toast-text').textContent = text;
  const button = $('toast-action');
  button.hidden = !actionLabel;
  button.onclick = null;
  if (actionLabel) {
    button.textContent = actionLabel;
    button.onclick = () => { box.hidden = true; action(); };
  }
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, actionLabel ? 10000 : 5000);
}

function setStatus(text) {
  $('status').textContent = text || '';
  $('status').hidden = !text;
}

// ---- Signing in ---------------------------------------------------------------

function showSignIn(reason) {
  state.view = null;
  ['who', 'mine', 'recs', 'all'].forEach((id) => { $(id).hidden = true; });
  setStatus('');
  $('signin').hidden = false;
  $('signin-reason').hidden = !reason;
  $('signin-reason').textContent = reason || '';
  $('signin-done').hidden = true;
  $('signin-form').hidden = false;
}

async function requestLink(event) {
  event.preventDefault();
  const email = $('signin-email').value.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    $('signin-email').focus();
    toast('Please enter your full email address, like name@gmail.com.');
    return;
  }
  const button = $('signin-button');
  button.disabled = true;
  button.textContent = 'Sending…';
  try {
    await api('requestLink', { email: email, website: $('signin-website').value });
    $('signin-form').hidden = true;
    $('signin-done').textContent = `Thank you. If ${email} can use the church's group drives, an email with ` +
      'your link is on its way. It can take a minute or two. If it doesn\'t arrive, check your spam folder.';
    $('signin-done').hidden = false;
  } catch (e) {
    toast('We couldn\'t send that. Check your internet connection and try again.');
  } finally {
    button.disabled = false;
    button.textContent = 'Email me my link';
  }
}

function signOut() {
  storeToken('');
  state.token = '';
  history.replaceState(null, '', location.pathname);
  showSignIn('');
}

// ---- Loading and showing the page ---------------------------------------------

async function load() {
  setStatus('Loading your folders…');
  try {
    const view = await api('me', { token: state.token });
    if (!view.ok) {
      if (view.error === 'invalid_link') {
        storeToken('');
        showSignIn('That link no longer works. Enter your email address and we\'ll send you a new one.');
        return;
      }
      throw new Error(view.error);
    }
    state.view = view;
    render();
  } catch (e) {
    setStatus('We couldn\'t reach Drive Notifications. Please try again in a minute.');
  }
}

/** folderId -> { drive, folder } for everything the person can see. */
function folderIndex() {
  const index = {};
  state.view.drives.forEach((drive) => drive.folders.forEach((folder) => {
    index[folder.id] = { drive: drive, folder: folder };
  }));
  return index;
}

function render() {
  const view = state.view;
  setStatus('');
  $('signin').hidden = true;
  $('who').hidden = false;
  $('who-email').textContent = view.email;

  if (!view.drives.length) {
    setStatus('Your email address doesn\'t have access to any church group drive folders yet. ' +
      'Ask the person who manages your team\'s drive to add you.');
    ['mine', 'recs', 'all'].forEach((id) => { $(id).hidden = true; });
    return;
  }

  const index = folderIndex();
  const subs = view.subscriptions.filter((s) => index[s.folderId]);
  const followed = {};
  subs.forEach((s) => { followed[s.folderId] = s; });

  renderMine(subs, index);
  renderRecommendations(followed, index);
  renderAll(followed, index);
}

function renderMine(subs, index) {
  const list = $('mine-list');
  list.textContent = '';
  $('mine').hidden = false;
  $('mine-empty').hidden = subs.length > 0;
  subs
    .slice()
    .sort((a, b) => {
      const x = index[a.folderId], y = index[b.folderId];
      return (x.drive.name + ' ' + x.folder.path).localeCompare(y.drive.name + ' ' + y.folder.path);
    })
    .forEach((sub) => list.appendChild(followedCard(sub, index[sub.folderId])));
}

function crumbFor(entry) {
  const parts = entry.folder.path.split(' › ');
  parts.pop();
  return [entry.drive.name].concat(parts).join(' › ');
}

function followedCard(sub, entry) {
  const name = entry.folder.name;
  const frequency = el('select', { 'aria-label': `How often to email about ${name}`, onchange: (e) => {
    const f = e.target.value;
    save(sub.folderId, {
      frequency: f,
      dailyHour: f === 'daily' ? (sub.frequency === 'daily' ? sub.dailyHour : state.view.defaults.dailyHour) : '',
      weeklyDay: f === 'weekly' ? (sub.frequency === 'weekly' ? sub.weeklyDay : state.view.defaults.weeklyDay) : ''
    }, name);
  } }, [
    el('option', { value: 'hourly', text: 'Every hour', selected: sub.frequency === 'hourly' }),
    el('option', { value: 'daily', text: 'Once a day', selected: sub.frequency === 'daily' }),
    el('option', { value: 'weekly', text: 'Once a week', selected: sub.frequency === 'weekly' })
  ]);

  let when = null;
  if (sub.frequency === 'daily') {
    when = el('select', { 'aria-label': `Time of day for ${name}`, onchange: (e) =>
      save(sub.folderId, { frequency: 'daily', dailyHour: Number(e.target.value) }, name) },
    Array.from({ length: 24 }, (_, h) =>
      el('option', { value: String(h), text: `at ${hourLabel(h)}`, selected: Number(sub.dailyHour) === h })));
  } else if (sub.frequency === 'weekly') {
    when = el('select', { 'aria-label': `Day of the week for ${name}`, onchange: (e) =>
      save(sub.folderId, { frequency: 'weekly', weeklyDay: e.target.value }, name) },
    DAYS.map((d) => el('option', { value: d, text: `on ${d}`, selected: sub.weeklyDay === d })));
  }

  return el('div', { className: 'card' }, [
    el('div', { className: 'crumb', text: crumbFor(entry) }),
    el('div', { className: 'name', text: name }),
    el('div', { className: 'controls' }, [frequency, when]),
    el('div', { className: 'actions' }, [
      el('button', { type: 'button', className: 'secondary', text: 'Stop following',
        onclick: () => unfollow(sub, name) })
    ])
  ]);
}

/** Recommended folders, for each drive where the person follows nothing yet. */
function renderRecommendations(followed, index) {
  const list = $('recs-list');
  list.textContent = '';
  let shown = 0;
  state.view.drives.forEach((drive) => {
    if (drive.folders.some((f) => followed[f.id])) return;
    const recs = drive.folders.filter((f) => f.recommended);
    if (!recs.length) return;
    list.appendChild(el('div', { className: 'drive-label', text: `From ${drive.name}` }));
    recs.forEach((folder) => {
      shown++;
      const crumb = crumbFor(index[folder.id]);
      list.appendChild(el('div', { className: 'card' }, [
        crumb !== drive.name ? el('div', { className: 'crumb', text: crumb }) : null,
        el('div', { className: 'name', text: folder.name }),
        el('button', { type: 'button', className: 'primary', text: 'Follow',
          'aria-label': `Follow ${folder.name}`, onclick: () => follow(folder) })
      ]));
    });
  });
  $('recs').hidden = shown === 0;
}

let allOpen = false;
const openDrives = {};   // drives the person has expanded in the full list
function renderAll(followed, index) {
  $('all').hidden = false;
  $('all-toggle').textContent = allOpen ? 'Hide the full list' : 'See all your folders';
  const list = $('all-list');
  list.hidden = !allOpen;
  list.textContent = '';
  if (!allOpen) return;

  const many = state.view.drives.length > 1;
  state.view.drives.forEach((drive) => {
    const isOpen = many ? !!openDrives[drive.driveId] : true;
    const block = el('details', { className: 'drive', open: isOpen }, [el('summary', { text: drive.name })]);
    block.addEventListener('toggle', () => { openDrives[drive.driveId] = block.open; });
    drive.folders.forEach((folder) => {
      const depth = Math.min(folder.path.split(' › ').length - 1, 4);
      const parentFollowed = followedAncestor(folder, drive, followed);
      let right;
      if (followed[folder.id]) {
        right = el('span', { className: 'state', text: `Following, ${describe(followed[folder.id])}` });
      } else if (parentFollowed) {
        right = el('span', { className: 'state quiet', text: `Included: you follow ${parentFollowed.name}` });
      } else {
        right = el('button', { type: 'button', className: 'secondary', text: 'Follow',
          'aria-label': `Follow ${folder.name}`, onclick: () => follow(folder) });
      }
      block.appendChild(el('div', { className: `folder-row depth-${depth}` }, [
        el('span', { className: 'fname', text: folder.name }), right
      ]));
    });
    list.appendChild(block);
  });
}

/** The nearest followed folder above this one, by path, or null. */
function followedAncestor(folder, drive, followed) {
  const parts = folder.path.split(' › ');
  for (let n = parts.length - 1; n > 0; n--) {
    const prefix = parts.slice(0, n).join(' › ');
    const match = drive.folders.find((f) => f.path === prefix && followed[f.id]);
    if (match) return match;
  }
  return null;
}

// ---- Changes ------------------------------------------------------------------

async function change(action, data) {
  if (state.busy) return null;
  state.busy = true;
  // Block double taps on the folder lists while saving (the lists are redrawn afterwards).
  document.querySelectorAll('#mine button, #mine select, #recs button, #all-list button')
    .forEach((n) => { n.disabled = true; });
  try {
    const r = await api(action, Object.assign({ token: state.token }, data));
    if (!r.ok) {
      if (r.error === 'invalid_link') {
        storeToken('');
        showSignIn('That link no longer works. Enter your email address and we\'ll send you a new one.');
        return null;
      }
      throw new Error(r.error);
    }
    state.view.subscriptions = r.subscriptions;
    return r;
  } catch (e) {
    toast('That didn\'t save. Check your internet connection and try again.');
    return null;
  } finally {
    state.busy = false;
    if (state.view) render();
  }
}

async function follow(folder) {
  const d = state.view.defaults;
  const r = await change('follow', { folderId: folder.id, frequency: 'daily', dailyHour: d.dailyHour });
  if (r) toast(`You now follow ${folder.name}: an email once a day, at ${hourLabel(d.dailyHour)}, when something changes.`);
}

async function save(folderId, settings, name) {
  const r = await change('follow', Object.assign({ folderId: folderId }, settings));
  if (r) {
    const sub = r.subscriptions.find((s) => s.folderId === folderId);
    if (sub) toast(`Saved. ${name}: ${describe(sub)}.`);
  }
}

async function unfollow(sub, name) {
  const before = Object.assign({}, sub);
  const r = await change('unfollow', { folderId: sub.folderId });
  if (r) {
    toast(`You stopped following ${name}.`, 'Undo', () => save(before.folderId, {
      frequency: before.frequency, dailyHour: before.dailyHour, weeklyDay: before.weeklyDay
    }, name));
  }
}

// ---- Start --------------------------------------------------------------------

(function start() {
  // Refuse to run inside another site's frame.
  if (window.top !== window.self) {
    document.body.textContent = '';
    return;
  }
  $('signin-form').addEventListener('submit', requestLink);
  $('signout').addEventListener('click', signOut);
  $('all-toggle').addEventListener('click', () => {
    allOpen = !allOpen;
    render();
    if (allOpen) $('all-list').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  // A new link opened while the page is already showing changes only the "#" part.
  window.addEventListener('hashchange', () => {
    const fresh = new URLSearchParams(location.hash.slice(1)).get('t');
    if (fresh && fresh !== state.token) {
      storeToken(fresh);
      state.token = fresh;
      load();
    }
  });
  state.token = readToken();
  if (state.token) load();
  else showSignIn('');
})();
