import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const client = createClient(
  'https://ouheuyzzctzivwdnlvtm.supabase.co',
  'sb_publishable_eKhnobY0hWuvV1yLdDEjLg_mGbGzhoI'
);
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

const pendingKey = () => 'so-tu-pending:' + user.id;
function say(message) {
  status.textContent = message;
}
function savePending() {
  try {
    localStorage.setItem(pendingKey(), JSON.stringify({ revision, payload: app.snapshot() }));
    return true;
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
  if (busy || !user || conflict) return;
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
      if (pending) savePending();
      else clearPending();
    } else if (load || (ready && app.atHome())) {
      const remote = await readCloud();
      if (!pending && (load || app.atHome()) && (!ready || (remote?.revision || 0) !== revision)) {
        revision = remote?.revision || 0;
        app.apply(remote?.payload || { version: 1, library: { decks: [], entries: [] }, progress: {} });
      }
    }
    if (!ready) {
      ready = true;
      main.inert = false;
      actions.hidden = false;
    }
    say(pending ? 'Đang lưu thay đổi…' : 'Đã đồng bộ · ' + user.email);
  } catch (error) {
    console.error(error);
    say(ready ? 'Chưa đồng bộ được. Hãy kiểm tra kết nối và bấm Đồng bộ lại.' :
      'Chưa tải được dữ liệu. Hãy kiểm tra kết nối và bảng so_tu_state trong Supabase.');
    actions.hidden = false;
  } finally {
    busy = false;
  }
}

app.onChange = () => {
  if (!ready || !user) return;
  pending = true;
  const saved = savePending();
  if (!conflict) {
    say(saved ? 'Đang lưu thay đổi…' : 'Trình duyệt không giữ được bản lưu tạm. Hãy mở trang đến khi đồng bộ xong.');
    queueMicrotask(() => synchronize());
  }
};

async function openAccount(session) {
  user = session?.user || null;
  login.hidden = Boolean(user);
  main.inert = true;
  if (!user) {
    say('Đăng nhập cùng tài khoản trên laptop và điện thoại.');
    return;
  }
  const saved = readPending();
  if (saved) {
    revision = saved.revision;
    app.apply(saved.payload);
    pending = true;
  }
  await synchronize({ load: true });
  if (conflict) {
    ready = true;
    main.inert = false;
    actions.hidden = false;
  }
}

login.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = login.querySelector('button');
  button.disabled = true;
  try {
    const { data, error } = await client.auth.signInWithPassword({
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
  if (!user || busy || !app.atHome()) return;
  if (conflict) {
    if (!confirm('Tải dữ liệu mới nhất từ Supabase và bỏ thay đổi chưa đồng bộ trên máy này?')) return;
    try {
      busy = true;
      const remote = await readCloud();
      app.apply(remote?.payload || { version: 1, library: { decks: [], entries: [] }, progress: {} });
      revision = remote?.revision || 0;
      pending = false;
      conflict = false;
      clearPending();
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
  if (pending && !savePending()) {
    say('Hãy xuất bản sao lưu trước khi đóng trang. Trình duyệt chưa giữ được thay đổi đang chờ.');
    return;
  }
  const { error } = await client.auth.signOut({ scope: 'local' });
  if (!error) location.reload();
  else say('Chưa đăng xuất được. Hãy thử lại.');
});

window.addEventListener('focus', () => { if (user) synchronize(); });
window.addEventListener('online', () => { if (user) synchronize(); });
setInterval(() => { if (user && (pending || app.atHome())) synchronize(); }, 8000);
try {
  const { data } = await client.auth.getSession();
  await openAccount(data.session);
} catch {
  say('Chưa mở được phiên đăng nhập. Hãy tải lại trang.');
}
