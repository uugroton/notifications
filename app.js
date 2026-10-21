// Drive Notifications — the member page.
//
// Shows the folders a person follows, recommended folders, and every folder
// they can open, with one-tap Follow and Stop. All data comes from the Apps
// Script service; requests carry no Google sign-in cookies, so the page works
// however many Google accounts the browser is signed into.
//
// The service takes a few seconds to answer, so the page never waits for it:
// changes show at once and save in the background, and the last list seen on
// this device appears immediately while a fresh copy loads.

const API_URL = 'https://script.google.com/macros/s/AKfycbx0l9REFPIVIQ23Kchi82x-m-sOr_hAsS6_iVXP-Q5k6q0pp--CFST62obpij3mIbMSiA/exec';
const STORE_KEY = 'driveNotifications.link';
const VIEW_KEY = 'driveNotifications.view';
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const state = { token: '', view: null, pending: 0 };
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

/** Remembers the last list shown, so the next visit can show it instantly. */
function saveView() {
  try {
    if (state.view) localStorage.setItem(VIEW_KEY, JSON.stringify({ token: state.token, view: state.view }));
    else localStorage.removeItem(VIEW_KEY);
  } catch (e) {
    // Not available: the page just waits for the service instead.
  }
}

function savedView() {
  try {
    const saved = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null');
    return saved && saved.token === state.token ? saved.view : null;
  } catch (e) {
    return null;
  }
}

function forgetLink(reason) {
  storeToken('');
  state.token = '';
  state.view = null;
  saveView();
  showSignIn(reason);
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
  ['who', 'mine', 'recs', 'all', 'manage'].forEach((id) => { $(id).hidden = true; });
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
  // The answer is the same for every address, so confirm at once and send in the background.
  $('signin-form').hidden = true;
  $('signin-done').textContent = `Thank you. If ${email} can use the church's Shared Drives, an email with ` +
    'your link is on its way. It can take a minute or two. If it doesn\'t arrive, check your spam folder.';
  $('signin-done').hidden = false;
  try {
    await api('requestLink', { email: email, website: $('signin-website').value });
  } catch (e) {
    $('signin-done').hidden = true;
    $('signin-form').hidden = false;
    toast('We couldn\'t send that. Check your internet connection and try again.');
  }
}

function signOut() {
  history.replaceState(null, '', location.pathname);
  forgetLink('');
}

// ---- Loading and showing the page ---------------------------------------------

const LINK_GONE = 'That link no longer works. Enter your email address and we\'ll send you a new one.';

async function load() {
  // Show the last list seen on this device straight away, if there is one.
  const saved = savedView();
  if (saved) {
    state.view = saved;
    render();
  } else {
    setStatus('Loading your folders…');
  }
  try {
    const view = await api('me', { token: state.token });
    if (!view.ok) {
      if (view.error === 'invalid_link') { forgetLink(LINK_GONE); return; }
      throw new Error(view.error);
    }
    if (state.pending) return;   // a change is saving; its answer brings the latest list
    state.view = view;
    render();
    saveView();
  } catch (e) {
    if (saved) toast('Showing your list from your last visit. We couldn\'t check for updates just now.');
    else setStatus('We couldn\'t reach Drive Notifications. Please try again in a minute.');
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
    setStatus('Your email address doesn\'t have access to any church Shared Drive folders yet. ' +
      'Ask a Manager of your team\'s Shared Drive to add you.');
    ['mine', 'recs', 'all', 'manage'].forEach((id) => { $(id).hidden = true; });
    return;
  }

  const index = folderIndex();
  const subs = view.subscriptions.filter((s) => index[s.folderId]);
  const followed = {};
  subs.forEach((s) => { followed[s.folderId] = s; });

  renderMine(subs, index);
  renderRecommendations(followed, index);
  renderAll(followed, index);
  renderManage();
}

// ---- Manage recommendations (drive Managers and the tool admin) ----------------

const openManaged = {};
function renderManage() {
  const drives = state.view.drives.filter((d) => d.canManage);
  $('manage').hidden = drives.length === 0;
  const list = $('manage-list');
  list.textContent = '';
  if (!drives.length) return;
  $('manage-intro').textContent = (state.view.isAdmin
    ? 'As the tool admin, you can suggest folders in every Shared Drive for members to follow. '
    : 'As a manager of Shared Drive(s), you can suggest folders for members to follow. ') +
    'Restricted folders are marked, and are only ever shown to people who can open them.';

  drives.forEach((drive) => {
    const count = drive.folders.filter((f) => f.recommended).length;
    const isOpen = drives.length === 1 || !!openManaged[drive.driveId];
    const block = el('details', { className: 'drive', open: isOpen }, [
      el('summary', {}, [
        document.createTextNode(drive.name + ' '),
        el('span', { className: 'count', text: count ? `(${count} recommended)` : '' })
      ])
    ]);
    block.addEventListener('toggle', () => { openManaged[drive.driveId] = block.open; });
    drive.folders.forEach((folder) => block.appendChild(manageRow(drive, folder)));
    list.appendChild(block);
  });
}

function manageRow(drive, folder) {
  const depth = Math.min(folder.path.split(' › ').length - 1, 4);
  const on = !!folder.recommended;
  const toggle = el('button', {
    type: 'button', className: 'switch', role: 'switch', 'aria-checked': on ? 'true' : 'false',
    'aria-label': `Recommend ${folder.name}`, onclick: () => recommend(drive, folder, !on)
  }, [el('span', { className: 'track' }), el('span', { text: 'Recommended' })]);

  const children = [el('div', { className: 'manage-top' }, [el('span', { className: 'fname', text: folder.name }), toggle])];
  if (folder.restricted) {
    const n = folder.openCount;
    const people = `${n} ${n === 1 ? 'person' : 'people'}`;
    children.push(el('div', { className: 'restricted-label', text: '\u{1F512} Restricted' }));
    let note;
    if (folder.unreadable) {
      note = 'The tool can\'t see who has access here, so only this drive\'s Managers get its updates.';
    } else {
      note = `Only ${people} can open this folder` + (folder.insideOf ? ` (it is inside ${folder.insideOf}).` : '.');
      if (on) note += ` Recommended only to the ${people} who can open it.`;
    }
    children.push(el('div', { className: 'restricted-note', text: note }));
  }
  return el('div', { className: `manage-row depth-${depth}${folder.restricted ? ' restricted' : ''}` }, children);
}

function recommend(drive, folder, on) {
  folder.recommended = on;
  render();
  saveView();
  toast(on
    ? `${folder.name} is now recommended to members of ${drive.name}.`
    : `${folder.name} is no longer recommended.`);
  send('recommend', { folderId: folder.id, recommended: on }, (r) => {
    const ids = {};
    r.recommended.forEach((id) => { ids[id] = true; });
    const d = state.view.drives.find((x) => x.driveId === r.driveId);
    if (d) d.folders.forEach((f) => { f.recommended = !!ids[f.id]; });
  });
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
/**
 * Every recommended folder the person can open and doesn't follow yet, in any
 * drive. Folders inside a folder they already follow are left out, since they
 * already get those updates.
 */
function renderRecommendations(followed, index) {
  const list = $('recs-list');
  list.textContent = '';
  let shown = 0;
  state.view.drives.forEach((drive) => {
    const recs = drive.folders.filter((f) =>
      f.recommended && !followed[f.id] && !followedAncestor(f, drive, followed));
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
  $('recs-count').textContent = `(${shown})`;
  // Open unless the list is long; a choice made on this device is remembered.
  const remembered = recsOpenChoice();
  $('recs').open = remembered === null ? shown <= 6 : remembered;
}

const RECS_OPEN_KEY = 'driveNotifications.recommendationsOpen';
let recsOpenThisVisit = null;   // used when the browser can't store the choice
function recsOpenChoice() {
  if (recsOpenThisVisit !== null) return recsOpenThisVisit;
  try {
    const v = localStorage.getItem(RECS_OPEN_KEY);
    return v === null ? null : v === 'true';
  } catch (e) {
    return null;
  }
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
//
// Each change updates the screen at once, then saves in the background, one
// save at a time and in order. If a save fails, the page reloads the list from
// the service so the screen never shows something that wasn't saved.

let queue = Promise.resolve();

const applySubscriptions = (r) => { state.view.subscriptions = r.subscriptions; };

function send(action, data, apply) {
  state.pending++;
  document.body.setAttribute('data-saving', '');
  queue = queue.then(async () => {
    try {
      const r = await api(action, Object.assign({ token: state.token }, data));
      if (!r.ok) {
        if (r.error === 'invalid_link') {
          state.pending = 0;
          document.body.removeAttribute('data-saving');
          forgetLink(LINK_GONE);
          return;
        }
        throw new Error(r.error);
      }
      // Only the last save in a quick series replaces the list, to avoid flicker.
      if (state.pending === 1 && state.view) {
        (apply || applySubscriptions)(r);
        render();
        saveView();
      }
    } catch (e) {
      toast('That change didn\'t save. Check your internet connection and try again.');
      state.pending = Math.max(state.pending - 1, 0);
      if (!state.pending) document.body.removeAttribute('data-saving');
      return load();
    }
    state.pending = Math.max(state.pending - 1, 0);
    if (!state.pending) document.body.removeAttribute('data-saving');
  });
  return queue;
}

/** Sets a follow on screen right away (adding it if it's new). */
function setLocal(folderId, settings) {
  const subs = state.view.subscriptions;
  let sub = subs.find((s) => s.folderId === folderId);
  if (!sub) {
    const entry = folderIndex()[folderId];
    sub = { folderId: folderId, driveId: entry ? entry.drive.driveId : '' };
    subs.push(sub);
  }
  Object.assign(sub, {
    frequency: settings.frequency,
    dailyHour: settings.frequency === 'daily' ? Number(settings.dailyHour) : sub.dailyHour,
    weeklyDay: settings.frequency === 'weekly' ? settings.weeklyDay : sub.weeklyDay
  });
  render();
  saveView();
  return sub;
}

function follow(folder) {
  const hour = state.view.defaults.dailyHour;
  setLocal(folder.id, { frequency: 'daily', dailyHour: hour });
  toast(`You now follow ${folder.name}: an email once a day, at ${hourLabel(hour)}, when something changes.`);
  send('follow', { folderId: folder.id, frequency: 'daily', dailyHour: hour });
}

function save(folderId, settings, name) {
  const sub = setLocal(folderId, settings);
  toast(`Saved. ${name}: ${describe(sub)}.`);
  send('follow', Object.assign({ folderId: folderId }, settings));
}

function unfollow(sub, name) {
  const before = Object.assign({}, sub);
  state.view.subscriptions = state.view.subscriptions.filter((s) => s.folderId !== sub.folderId);
  render();
  saveView();
  toast(`You stopped following ${name}.`, 'Undo', () => save(before.folderId, {
    frequency: before.frequency, dailyHour: before.dailyHour, weeklyDay: before.weeklyDay
  }, name));
  send('unfollow', { folderId: sub.folderId });
}

// ---- Start --------------------------------------------------------------------

(function start() {
  // Refuse to run inside another site's frame.
  if (window.top !== window.self) {
    document.body.textContent = '';
    return;
  }
  $('signin-form').addEventListener('submit', requestLink);
  // Remember whether the person keeps "Recommended for you" open or closed.
  $('recs-summary').addEventListener('click', () => {
    const willOpen = !$('recs').open;
    recsOpenThisVisit = willOpen;
    try { localStorage.setItem(RECS_OPEN_KEY, String(willOpen)); } catch (e) { /* not available */ }
  });
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
