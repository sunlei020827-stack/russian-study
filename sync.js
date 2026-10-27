/**
 * 俄语学习工具箱 · 通用离线优先云端同步插件 (sync.js)
 * 支持：本地 localStorage 秒存 + 云端 (Supabase REST / JSONBin / 自定义 KV) 自动同步 + 离线队列 + JSON 备份恢复
 * 未来新增任何 HTML 工具，只需在 </body> 前加一行：<script src="sync.js"></script>
 */
(function(){
  const CFG_KEY = 'ru_study_sync_config_v1';
  const META_KEY = 'ru_study_sync_meta_v1';
  const DIRTY_KEY = 'ru_study_sync_dirty_v1';

  // 自动识别所有学习工具的 localStorage 键（排除同步配置本身）
  function isStudyKey(k) {
    if (!k) return false;
    if (k === CFG_KEY || k === META_KEY || k === DIRTY_KEY) return false;
    return k.startsWith('neo-') || k.startsWith('ru-') || k.startsWith('study-');
  }

  function loadCfg() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY)) || { provider: 'supabase', url: '', apiKey: '', syncId: 'my-russian-study' }; }
    catch { return { provider: 'supabase', url: '', apiKey: '', syncId: 'my-russian-study' }; }
  }
  function saveCfg(cfg) {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch {}
  }
  function loadMeta() {
    try { return JSON.parse(localStorage.getItem(META_KEY)) || { updatedAt: 0, lastSyncAt: 0 }; }
    catch { return { updatedAt: 0, lastSyncAt: 0 }; }
  }
  function saveMeta(m) {
    try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch {}
  }
  function setDirty(val) {
    try { localStorage.setItem(DIRTY_KEY, val ? '1' : '0'); } catch {}
  }
  function isDirty() {
    try { return localStorage.getItem(DIRTY_KEY) === '1'; } catch { return false; }
  }

  // 收集当前设备上的所有学习数据
  function collectSnapshot() {
    const data = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (isStudyKey(k)) data[k] = localStorage.getItem(k);
      }
    } catch {}
    return data;
  }

  // 将云端或备份快照写入本地
  const rawSetItem = Storage.prototype.setItem;
  const rawRemoveItem = Storage.prototype.removeItem;
  let suppressHook = false;

  function applySnapshot(data) {
    if (!data || typeof data !== 'object') return false;
    suppressHook = true;
    let changed = false;
    try {
      for (const [k, v] of Object.entries(data)) {
        if (isStudyKey(k) && typeof v === 'string') {
          if (localStorage.getItem(k) !== v) {
            rawSetItem.call(localStorage, k, v);
            changed = true;
          }
        }
      }
    } catch {}
    suppressHook = false;
    return changed;
  }

  // 拦截 localStorage.setItem，实现零侵入自动追踪修改并触发防抖同步
  let syncTimer = null;
  Storage.prototype.setItem = function(k, v) {
    rawSetItem.call(this, k, v);
    if (!suppressHook && this === window.localStorage && isStudyKey(k)) {
      const m = loadMeta();
      m.updatedAt = Date.now();
      saveMeta(m);
      setDirty(true);
      updateBadge('dirty');
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => syncWithCloud(false), 1800);
    }
  };

  // 云端读写适配器（支持 Supabase 数据表 或 JSONBin.io）
  async function fetchRemote(cfg) {
    if (manualTrigger !== true) return;
    if (!cfg.apiKey) throw new Error('未配置 API Key');
    if (cfg.provider === 'jsonbin') {
      if (!cfg.url) throw new Error('请填写 JSONBin Bin ID');
      const binId = cfg.url.trim().replace(/^https?:\/\/[^/]+\/v3\/b\//, '');
      const res = await fetch('https://api.jsonbin.io/v3/b/' + encodeURIComponent(binId) + '/latest', {
        headers: { 'X-Master-Key': cfg.apiKey.trim() }
      });
      if (!res.ok) throw new Error('读取失败 (' + res.status + ')');
      const j = await res.json();
      return j.record || { updatedAt: 0, data: {} };
    } else {
      // 默认 Supabase REST (表名: study_sync, 字段: id text primary key, payload jsonb)
      const base = cfg.url.trim().replace(/\/+$/, '');
      const syncId = (cfg.syncId || 'my-russian-study').trim();
      const res = await fetch(base + '/rest/v1/study_sync?id=eq.' + encodeURIComponent(syncId) + '&select=payload', {
        headers: {
          'apikey': cfg.apiKey.trim(),
          'Authorization': 'Bearer ' + cfg.apiKey.trim()
        }
      });
      if (!res.ok) throw new Error('云端连接失败 (' + res.status + ')');
      const rows = await res.json();
      if (!rows.length || !rows[0].payload) return { updatedAt: 0, data: {} };
      return rows[0].payload;
    }
  }

  async function pushRemote(cfg, payload) {
    if (cfg.provider === 'jsonbin') {
      const binId = cfg.url.trim().replace(/^https?:\/\/[^/]+\/v3\/b\//, '');
      const res = await fetch('https://api.jsonbin.io/v3/b/' + encodeURIComponent(binId), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': cfg.apiKey.trim()
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('上传失败 (' + res.status + ')');
    } else {
      const base = cfg.url.trim().replace(/\/+$/, '');
      const syncId = (cfg.syncId || 'my-russian-study').trim();
      const res = await fetch(base + '/rest/v1/study_sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': cfg.apiKey.trim(),
          'Authorization': 'Bearer ' + cfg.apiKey.trim(),
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify({ id: syncId, payload: payload })
      });
      if (!res.ok) throw new Error('上传失败 (' + res.status + ')');
    }
  }

  let syncing = false;
  async function syncWithCloud(manualTrigger) {
    const cfg = loadCfg();
    if (!cfg.apiKey || !cfg.url) {
      updateBadge(navigator.onLine ? 'local' : 'offline');
      if (manualTrigger) openSyncModal();
      return;
    }
    if (!navigator.onLine) {
      updateBadge('offline');
      return;
    }
    if (syncing) return;
    syncing = true;
    updateBadge('syncing');
    try {
      const remote = await fetchRemote(cfg);
      const meta = loadMeta();
      const localSnap = collectSnapshot();
      const remoteTime = Number(remote.updatedAt || 0);
      const localTime = Number(meta.updatedAt || 0);

      if (remoteTime > localTime) {
        // 云端比本地新：合并云端数据到本地
        const merged = Object.assign({}, localSnap, remote.data || {});
        const changed = applySnapshot(merged);
        meta.updatedAt = remoteTime;
        meta.lastSyncAt = Date.now();
        saveMeta(meta);
        setDirty(false);
        updateBadge('synced');
        if (changed && typeof window.onStudyCloudSyncApplied === 'function') {
          window.onStudyCloudSyncApplied();
        } else if (changed && manualTrigger) {
          location.reload();
        }
      } else if (localTime > remoteTime || isDirty() || manualTrigger) {
        // 本地有新进度：推送到云端
        const now = Math.max(localTime, Date.now());
        const merged = Object.assign({}, remote.data || {}, localSnap);
        await pushRemote(cfg, { updatedAt: now, data: merged });
        meta.updatedAt = now;
        meta.lastSyncAt = Date.now();
        saveMeta(meta);
        setDirty(false);
        updateBadge('synced');
      } else {
        meta.lastSyncAt = Date.now();
        saveMeta(meta);
        updateBadge('synced');
      }
    } catch (err) {
      console.warn('Sync error:', err);
      updateBadge('error', err.message);
    } finally {
      syncing = false;
    }
  }

  // UI 状态栏与配置弹窗
  function updateBadge(state, msg) {
    const btn = document.getElementById('ru-sync-badge');
    if (!btn) return;
    const map = {
      local:   { dot: '#8c7858', text: '本地离线保存 · 点击配置云同步' },
      offline: { dot: '#b5654d', text: '离线背诵中（联网后自动同步）' },
      dirty:   { dot: '#c28b38', text: '进度已存本地 · 准备同步…' },
      syncing: { dot: '#315c4e', text: '正在与云端同步…' },
      synced:  { dot: '#2e7d5b', text: '云端已同步 · 跨设备实时共享' },
      error:   { dot: '#b84a39', text: '同步待重试：' + (msg || '请检查配置') }
    };
    const cur = map[state] || map.local;
    btn.innerHTML = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + cur.dot + ';margin-right:7px"></span>' + cur.text;
  }

  function openSyncModal() {
    const modal = document.getElementById('ru-sync-modal');
    if (!modal) return;
    const cfg = loadCfg();
    document.getElementById('ru-sync-provider').value = cfg.provider || 'supabase';
    document.getElementById('ru-sync-url').value = cfg.url || '';
    document.getElementById('ru-sync-key').value = cfg.apiKey || '';
    document.getElementById('ru-sync-id').value = cfg.syncId || 'my-russian-study';
    modal.hidden = false;
  }

  function injectUI() {
    if (document.getElementById('ru-sync-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'ru-sync-bar';
    bar.style.cssText = 'background:#e8ebe0;border-bottom:1px solid #d5dacb;padding:8px 5vw;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#233d37';
    bar.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <a href="index.html" style="color:#233d37;text-decoration:none;font-weight:600;padding:4px 10px;background:#fffef9;border:1px solid #cfd5c4;border-radius:6px">← 工具箱主页</a>
        <button type="button" id="ru-sync-badge" style="cursor:pointer;border:1px solid #cfd5c4;background:#fffef9;color:#233d37;padding:4px 11px;border-radius:99px;font:inherit"></button>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <button type="button" id="ru-sync-now" style="cursor:pointer;border:1px solid #cfd5c4;background:#fffef9;color:#233d37;padding:4px 10px;border-radius:6px;font:inherit">立即同步</button>
        <button type="button" id="ru-sync-cfg-btn" style="cursor:pointer;border:1px solid #315c4e;background:#315c4e;color:#fff;padding:4px 10px;border-radius:6px;font:inherit">云端与备份设置</button>
      </div>
    `;
    document.body.prepend(bar);

    const modal = document.createElement('div');
    modal.id = 'ru-sync-modal';
    modal.hidden = true;
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(25,38,34,.45);display:grid;place-items:center;padding:16px;z-index:9999;font:14px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;color:#233d37';
    modal.innerHTML = `
      <div style="background:#fffef9;border:1px solid #d5dacb;border-radius:16px;max-width:540px;width:100%;padding:24px;box-shadow:0 18px 45px rgba(0,0,0,.16);max-height:90vh;overflow:auto">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <strong style="font-size:18px">跨设备云端同步与离线设置</strong>
          <button type="button" id="ru-sync-close" style="border:1px solid #d5dacb;background:#fffef9;border-radius:6px;padding:4px 10px;cursor:pointer">关闭</button>
        </div>
        <p style="font-size:13px;color:#667066;margin:0 0 14px">配置一次后保存在当前设备。平时没网也能直接背诵，联网后自动将所有工具的词表、段落、勾选进度同步到云端。</p>
        <label style="display:block;font-weight:600;margin:10px 0 4px">云端存储服务（免费）</label>
        <select id="ru-sync-provider" style="width:100%;padding:9px;border:1px solid #cbd3c1;border-radius:8px;background:#fff">
          <option value="supabase">Supabase 免费云数据库（推荐，国内/海外均稳定）</option>
          <option value="jsonbin">JSONBin.io 极简云存储（免建表，填 Bin ID 即可）</option>
        </select>
        <label style="display:block;font-weight:600;margin:10px 0 4px">项目地址 URL（或 JSONBin 的 Bin ID）</label>
        <input id="ru-sync-url" type="text" placeholder="例如：https://xxxx.supabase.co 或 671f8a..." style="width:100%;padding:9px;border:1px solid #cbd3c1;border-radius:8px;background:#fff">
        <label style="display:block;font-weight:600;margin:10px 0 4px">密钥 API Key（Supabase anon key 或 JSONBin X-Master-Key）</label>
        <input id="ru-sync-key" type="password" placeholder="粘贴你的免费 API Key" style="width:100%;padding:9px;border:1px solid #cbd3c1;border-radius:8px;background:#fff">
        <label style="display:block;font-weight:600;margin:10px 0 4px">你的专属同步暗号（多台设备填同一个暗号即可共享进度）</label>
        <input id="ru-sync-id" type="text" placeholder="my-russian-study" style="width:100%;padding:9px;border:1px solid #cbd3c1;border-radius:8px;background:#fff">
        <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">
          <button type="button" id="ru-sync-save" style="background:#315c4e;color:#fff;border:1px solid #315c4e;padding:9px 16px;border-radius:8px;cursor:pointer">保存并立即同步</button>
          <button type="button" id="ru-sync-export" style="background:#fffef9;border:1px solid #cbd3c1;padding:9px 14px;border-radius:8px;cursor:pointer">导出全部进度备份 (.json)</button>
          <label style="background:#fffef9;border:1px solid #cbd3c1;padding:9px 14px;border-radius:8px;cursor:pointer;margin:0;font-weight:400">
            导入备份恢复 <input type="file" id="ru-sync-import" accept=".json" style="display:none">
          </label>
        </div>
        <div id="ru-sync-msg" style="margin-top:10px;font-size:12px;color:#315c4e"></div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('ru-sync-badge').onclick = openSyncModal;
    document.getElementById('ru-sync-cfg-btn').onclick = openSyncModal;
    document.getElementById('ru-sync-close').onclick = () => { modal.hidden = true; };
    document.getElementById('ru-sync-now').onclick = () => syncWithCloud(true);
    document.getElementById('ru-sync-save').onclick = () => {
      const cfg = {
        provider: document.getElementById('ru-sync-provider').value,
        url: document.getElementById('ru-sync-url').value.trim(),
        apiKey: document.getElementById('ru-sync-key').value.trim(),
        syncId: document.getElementById('ru-sync-id').value.trim() || 'my-russian-study'
      };
      saveCfg(cfg);
      document.getElementById('ru-sync-msg').textContent = '配置已保存，正在尝试连接云端…';
      syncWithCloud(true).then(() => { modal.hidden = true; });
    };
    document.getElementById('ru-sync-export').onclick = () => {
      const blob = new Blob([JSON.stringify({ updatedAt: Date.now(), data: collectSnapshot() }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'russian-study-backup.json';
      a.click();
    };
    document.getElementById('ru-sync-import').onchange = (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          applySnapshot(parsed.data || parsed);
          const m = loadMeta(); m.updatedAt = Date.now(); saveMeta(m);
          location.reload();
        } catch {
          document.getElementById('ru-sync-msg').textContent = '备份文件格式不正确';
        }
      };
      reader.readAsText(file);
    };

    const cfg = loadCfg();
    updateBadge(!navigator.onLine ? 'offline' : (cfg.apiKey && cfg.url ? 'synced' : 'local'));
  }

  window.addEventListener('DOMContentLoaded', () => {
    injectUI();
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
    syncWithCloud(false);
  });
  window.addEventListener('online', () => syncWithCloud(false));
  window.addEventListener('offline', () => updateBadge('offline'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncWithCloud(false);
  });

  window.RuStudySync = { syncNow: () => syncWithCloud(true), openConfig: openSyncModal, collectSnapshot };
})();
