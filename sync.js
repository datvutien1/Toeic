let client = null;
let connecting = null;
let onlineSession = false;

async function getClient() {
  if (!client) {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    client ||= createClient(
      'https://ouheuyzzctzivwdnlvtm.supabase.co',
      'sb_publishable_eKhnobY0hWuvV1yLdDEjLg_mGbGzhoI'
    );
  }
  return client;
}
const app = window.soTu;
const get = (id) => document.getElementById(id);
const status = get('cloud-status');
const login = get('cloud-login');
const actions = get('cloud-actions');
const main = document.querySelector('main');
let user = null;
let revision = 0;
let pending = false;
let conflict = false;
let busy = false;
let ready = false;

const activeKey = 'so-tu-offline-account-v1';
const cacheKey = () => 'so-tu-device-state:' + user.id;
const pendingKey = () => 'so-tu-pending:' + user.id;
const offlineBanner = get('offline-banner');

function say(message, showNotice = false) {
  status.textContent = message;
  if (offlineBanner) {
    const show = ready && (showNotice || !navigator.onLine || !onlineSession || pending || conflict);
    offlineBanner.hidden = !show;
    offlineBanner.textContent = show ? message : '';
  }
}

function allowStudy() {
  ready = true;
  main.inert = false;
  actions.hidden = false;
}

function cacheDeviceState() {
  try {
    localStorage.setItem(cacheKey(), JSON.stringify({ revision, payload: app.snapshot(), pending }));
    localStorage.setItem(activeKey, JSON.stringify({ id: user.id, email: user.email }));
    return true;
  } catch {
    return false;
  }
}

function readDeviceState() {
  try {
    const saved = JSON.parse(localStorage.getItem(cacheKey()) || 'null');
    return Number.isSafeInteger(saved?.revision) && saved.revision >= 0 && app.valid(saved.payload) ? saved : null;
  } catch {
    return null;
  }
}

function restoreDeviceState() {
  const saved = readDeviceState() || readPending();
  if (!saved) return;
  revision = saved.revision;
  app.apply(saved.payload);
  pending = saved.pending ?? true;
  allowStudy();
}
function savePending() {
  try {
    return cacheDeviceState();
  } catch {
    return false;
  }
}
function clearPending() {
  try { localStorage.removeItem(pendingKey()); } catch {}
}
function readPending() {
  try {
    const saved = JSON.parse(localStorage.getItem(pendingKey()) || 'null');
    return Number.isInteger(saved?.revision) && app.valid(saved.payload) ? saved : null;
  } catch {
    return null;
  }
}

async function readCloud() {
  const { data, error } = await client.from('so_tu_state')
    .select('revision,payload').eq('user_id', user.id).maybeSingle();
  if (error) throw error;
  if (data && !app.valid(data.payload)) throw new Error('Dữ liệu trên máy chủ không đúng định dạng.');
  return data;
}

async function synchronize({ load = false } = {}) {
  if (busy || !user || conflict || !onlineSession || !navigator.onLine) return;
  busy = true;
  try {
    if (pending) {
      const payload = app.snapshot();
      const sent = JSON.stringify(payload);
      const query = revision
        ? client.from('so_tu_state').update({ revision: revision + 1, payload }).eq('user_id', user.id).eq('revision', revision)
        : client.from('so_tu_state').insert({ user_id: user.id, revision: 1, payload });
      const { data, error } = await query.select('revision');
      if (error?.code === '23505' || (!error && !data?.length)) {
        conflict = true;
        say('Thiết bị khác đã lưu dữ liệu mới hơn. Hãy xuất bản sao trên máy này nếu cần, rồi bấm Đồng bộ lại để tải dữ liệu online.');
        return;
      }
      if (error) throw error;
      revision = data[0].revision;
      pending = sent !== JSON.stringify(app.snapshot());
      const saved = cacheDeviceState();
      if (saved) clearPending();
    } else if (load || (ready && app.atHome())) {
      const remote = await readCloud();
      if (!pending && (load || app.atHome()) && (!ready || (remote?.revision || 0) !== revision)) {
        revision = remote?.revision || 0;
        app.apply(remote?.payload || { version: 1, library: { decks: [], entries: [] }, progress: {} });
      }
    }
    allowStudy();
    login.hidden = true;
    const saved = cacheDeviceState();
    if (saved) clearPending();
    say(!saved ? 'Đã đồng bộ, nhưng trình duyệt không lưu được bản ngoại tuyến.' :
      pending ? 'Đang lưu thay đổi…' : 'Đã đồng bộ · ' + user.email, !saved);
  } catch (error) {
    console.error(error);
    if (error?.code === 'PGRST301' || error?.code === 'PGRST303') {
      onlineSession = false;
      login.hidden = false;
    }
    say(ready ? 'Chưa đồng bộ được. Bạn có thể học tiếp với dữ liệu trên thiết bị.' :
      'Chưa tải được dữ liệu. Hãy kiểm tra kết nối và bảng so_tu_state trong Supabase.', true);
    actions.hidden = false;
  } finally {
    busy = false;
  }
}

app.onChange = () => {
  if (!ready || !user) return;
  pending = true;
  const saved = savePending();
  if (!saved) {
    say('Chưa lưu được kết quả trên thiết bị. Hãy xuất bản sao trước khi đóng trang.');
  } else if (conflict) {
    say('Thiết bị khác đã lưu dữ liệu mới hơn. Bản học trên máy này vẫn được giữ.');
  } else {
    say(navigator.onLine && onlineSession ? 'Đang lưu thay đổi…' : 'Đang học ngoại tuyến. Kết quả đã lưu trên thiết bị.');
  }
  if (!conflict) queueMicrotask(() => synchronize());
};

async function openAccount(session) {
  onlineSession = Boolean(session?.user);
  if (!onlineSession) {
    login.hidden = false;
    say(ready ? 'Đăng nhập lại để đồng bộ. Bạn vẫn có thể học với bản lưu trên thiết bị.' :
      'Kết nối mạng và đăng nhập một lần để chuẩn bị học ngoại tuyến.');
    return;
  }
  if (user?.id !== session.user.id) {
    ready = false;
    pending = false;
    conflict = false;
    revision = 0;
    main.inert = true;
    actions.hidden = true;
    user = session.user;
    restoreDeviceState();
  } else {
    user = session.user;
  }
  login.hidden = true;
  await synchronize({ load: true });
}

function connect() {
  if (!navigator.onLine) return Promise.resolve();
  if (connecting) return connecting;
  connecting = (async () => {
    try {
      const sdk = await getClient();
      const { data, error } = await sdk.auth.getSession();
      if (error) throw error;
      await openAccount(data.session);
    } catch (error) {
      console.error(error);
      if (!ready) login.hidden = false;
      say(ready ? 'Chưa kết nối được. Bạn vẫn có thể học với bản lưu trên thiết bị.' :
        'Chưa kết nối được. Hãy thử đăng nhập lại khi có mạng.');
    }
  })().finally(() => { connecting = null; });
  return connecting;
}

login.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = login.querySelector('button');
  button.disabled = true;
  try {
    if (connecting) await connecting;
    if (!navigator.onLine) {
      say('Cần kết nối mạng để đăng nhập.');
      return;
    }
    const sdk = await getClient();
    const { data, error } = await sdk.auth.signInWithPassword({
      email: get('cloud-email').value.trim(),
      password: get('cloud-password').value
    });
    get('cloud-password').value = '';
    if (error) {
      say('Đăng nhập thất bại. Hãy kiểm tra email và mật khẩu Sổ từ.');
      return;
    }
    await openAccount(data.session);
  } catch {
    say('Chưa kết nối được với Supabase.');
  } finally {
    button.disabled = false;
  }
});

const importStatus = document.createElement('p');
importStatus.setAttribute('role', 'status');
importStatus.hidden = true;
status.before(importStatus);

function explainImport(message) {
  importStatus.hidden = false;
  importStatus.textContent = message;
}

get('cloud-import').addEventListener('change', async (event) => {
  const picker = event.currentTarget;
  const file = picker.files[0];
  if (!file) return;
  picker.value = '';

  if (!ready || !user) {
    explainImport('Hãy đăng nhập và đợi Sổ từ tải dữ liệu trước khi nhập.');
    return;
  }
  if (conflict || !app.atHome()) {
    explainImport(conflict ? 'Hãy xử lý thông báo đồng bộ bên dưới rồi chọn lại tệp.' :
      'Hãy về trang chủ Sổ từ rồi chọn lại tệp.');
    return;
  }

  picker.disabled = true;
  explainImport('Đang đọc bản sao lưu…');
  try {
    let backup;
    try {
      backup = JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
    } catch {
      explainImport('Không đọc được tệp. Hãy chọn tệp JSON từ nút Xuất dữ liệu của Sổ từ.');
      return;
    }
    if (!app.valid(backup)) {
      explainImport('Định dạng chưa đúng. Hãy chọn tệp JSON từ nút Xuất dữ liệu của Sổ từ.');
      return;
    }
    if (!app.atHome() || conflict) {
      explainImport('Sổ từ chưa thể nhập lúc này. Hãy về trang chủ, xử lý thông báo đồng bộ nếu có rồi chọn lại tệp.');
      return;
    }
    if (!confirm('Dùng bản sao lưu này để thay toàn bộ bộ từ và tiến độ của tài khoản hiện tại?')) {
      explainImport('Đã hủy nhập bản sao lưu.');
      return;
    }
    app.apply(backup);
    app.onChange();
    explainImport('Đã nhập “' + file.name + '”. Xem trạng thái lưu lên Supabase bên dưới.');
  } catch (error) {
    console.error(error);
    explainImport('Chưa nhập được bản sao lưu. Hãy tải lại trang rồi thử lại.');
  } finally {
    picker.disabled = false;
  }
});

get('cloud-retry').addEventListener('click', async () => {
  if (busy || !app.atHome()) return;
  if (!navigator.onLine) {
    say('Đang ngoại tuyến. Kết quả sẽ được gửi khi có mạng.');
    return;
  }
  if (!onlineSession) {
    await connect();
    return;
  }
  if (!user) return;
  if (conflict) {
    if (!confirm('Tải dữ liệu mới nhất từ Supabase và bỏ thay đổi chưa đồng bộ trên máy này?')) return;
    try {
      busy = true;
      const remote = await readCloud();
      app.apply(remote?.payload || { version: 1, library: { decks: [], entries: [] }, progress: {} });
      revision = remote?.revision || 0;
      pending = false;
      conflict = false;
      if (cacheDeviceState()) clearPending();
    } catch {
      say('Chưa tải được dữ liệu online. Bản lưu trên máy vẫn còn.');
      return;
    } finally {
      busy = false;
    }
  }
  await synchronize({ load: true });
});

get('cloud-logout').addEventListener('click', async () => {
  if (busy) return;
  if (!onlineSession || !navigator.onLine) {
    say('Hãy kết nối mạng để đăng xuất.');
    return;
  }
  if (pending && !savePending()) {
    say('Hãy xuất bản sao lưu trước khi đóng trang. Trình duyệt chưa giữ được thay đổi đang chờ.');
    return;
  }
  const { error } = await client.auth.signOut({ scope: 'local' });
  if (error) {
    say('Chưa đăng xuất được. Hãy thử lại.');
    return;
  }
  localStorage.removeItem(activeKey);
  if (!pending) localStorage.removeItem(cacheKey());
  location.reload();
});

try {
  const account = JSON.parse(localStorage.getItem(activeKey) || 'null');
  if (typeof account?.id === 'string' && typeof account.email === 'string') {
    user = account;
    restoreDeviceState();
  }
} catch {}

if (ready) say('Đang dùng bản lưu trên thiết bị.');
else if (!navigator.onLine) {
  login.hidden = false;
  say('Hãy mở Sổ từ và đăng nhập một lần khi có mạng để học ngoại tuyến.');
}

function resumeSync() {
  if (!navigator.onLine) return;
  if (!onlineSession) connect();
  else if (pending || app.atHome()) synchronize();
}

window.addEventListener('focus', resumeSync);
window.addEventListener('online', resumeSync);
window.addEventListener('offline', () => {
  say(ready ? 'Đang học ngoại tuyến. Kết quả sẽ lưu trên thiết bị.' :
    'Hãy đăng nhập một lần khi có mạng để học ngoại tuyến.');
});
window.addEventListener('storage', (event) => {
  if (event.key === activeKey && user) {
    let active;
    try { active = JSON.parse(event.newValue || 'null'); } catch {}
    if (active?.id !== user.id) location.reload();
  }
});
setInterval(() => {
  if (onlineSession && (pending || app.atHome())) synchronize();
}, 8000);
connect();
