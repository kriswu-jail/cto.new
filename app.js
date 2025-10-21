(function(){
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  const fileInput = $('#file-input');
  const startBtn = $('#start-btn');
  const errorRegion = $('#error-region');
  const taskList = $('#task-list');
  const resultCards = $('#result-cards');
  const resultsRegion = $('#results');
  const yearEl = $('#year');
  const typeSelect = $('#type-select');
  const qualityInput = $('#quality');
  const qualityOutput = $('#quality-output');

  yearEl.textContent = new Date().getFullYear();

  qualityInput.addEventListener('input', () => {
    qualityOutput.textContent = qualityInput.value + '%';
    qualityInput.setAttribute('aria-valuenow', qualityInput.value);
  });

  /** State **/
  let tasks = []; // {id, file, status, progress, resultUrl, error}
  let nextId = 1;
  const CONCURRENCY = 2;
  let active = 0;

  function humanSize(bytes){
    if(bytes < 1024) return bytes + ' B';
    if(bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
    return (bytes/1024/1024).toFixed(2) + ' MB';
  }

  function showError(msg){
    errorRegion.textContent = msg;
    errorRegion.classList.add('show');
    setTimeout(()=> errorRegion.classList.remove('show'), 4000);
  }

  function validateFiles(files){
    const maxSize = 10 * 1024 * 1024; // 10MB
    const allowed = [
      'image/', 'application/pdf', 'text/plain'
    ];
    const invalid = [];
    for(const f of files){
      const okType = allowed.some(t => t.endsWith('/') ? f.type.startsWith(t) : f.type === t);
      const okSize = f.size <= maxSize;
      if(!okType) invalid.push(`${f.name}：不支持的类型`);
      if(!okSize) invalid.push(`${f.name}：超过大小限制 (≤10MB)`);
    }
    return invalid;
  }

  function addTasksFromFiles(files){
    const invalid = validateFiles(files);
    if(invalid.length){
      showError('文件校验失败：\n' + invalid.join('\n'));
    }
    const type = typeSelect.value;
    const params = {
      quality: Number(qualityInput.value),
      advanced: $('#advanced').checked
    };
    for(const f of files){
      if(validateFiles([f]).length) continue; // skip invalid
      tasks.push({
        id: nextId++,
        file: f,
        type,
        params,
        status: 'queued', // queued | processing | done | failed
        progress: 0,
        resultUrl: null,
        error: null,
        createdAt: Date.now()
      });
    }
    renderTasks();
    schedule();
  }

  function schedule(){
    while(active < CONCURRENCY){
      const t = tasks.find(x => x.status === 'queued');
      if(!t) break;
      startProcessing(t);
    }
  }

  function startProcessing(task){
    task.status = 'processing';
    task.progress = 0;
    active++;
    renderTasks();

    // Simulate long processing with incremental progress
    const failChance = 0.15;
    const timer = setInterval(() => {
      // simulate long-poll style update (no real server)
      const inc = Math.floor(Math.random()*15) + 5; // 5-19
      task.progress = Math.min(100, task.progress + inc);
      renderTasks();

      if(task.progress >= 100){
        clearInterval(timer);
        // randomly fail
        const failed = Math.random() < failChance;
        if(failed){
          task.status = 'failed';
          task.error = '处理失败，请重试（网络或格式问题）';
          task.progress = 0;
          active--;
          renderTasks();
          schedule();
        }else{
          task.status = 'done';
          task.error = null;
          // create downloadable result
          const text = `处理完成：${task.file.name}\n类型：${task.type}\n质量：${task.params.quality}%\n时间：${new Date().toLocaleString('zh-CN')}`;
          const blob = new Blob([text], {type: 'text/plain;charset=utf-8'});
          task.resultUrl = URL.createObjectURL(blob);
          active--;
          renderTasks();
          schedule();
          // move focus to results region when first result appears
          if($$('.result-card').length === 1){
            resultsRegion.setAttribute('aria-busy','false');
            resultsRegion.focus();
          }
        }
      }
    }, 500 + Math.random()*400); // 500-900ms per tick
  }

  function retryTask(id){
    const t = tasks.find(x => x.id === id);
    if(!t) return;
    t.status = 'queued';
    t.error = null;
    t.progress = 0;
    renderTasks();
    schedule();
  }

  function removeTask(id){
    const idx = tasks.findIndex(x => x.id === id);
    if(idx >= 0){
      const [t] = tasks.splice(idx, 1);
      if(t.resultUrl) URL.revokeObjectURL(t.resultUrl);
    }
    renderTasks();
    schedule();
  }

  function queuePosition(task){
    let ahead = 0;
    for(const t of tasks){
      if(t === task) break;
      if(t.status === 'queued' || t.status === 'processing') ahead++;
    }
    return ahead;
  }

  function renderTasks(){
    // tasks list
    taskList.innerHTML = '';
    for(const t of tasks){
      const li = document.createElement('li');
      li.className = 'task-item';
      li.setAttribute('role','listitem');
      li.dataset.id = String(t.id);

      const head = document.createElement('div');
      head.className = 'task-head';
      const name = document.createElement('div');
      name.innerHTML = `<strong>${t.file.name}</strong> <span class="small">(${humanSize(t.file.size)})</span>`;
      const status = document.createElement('div');
      const badge = document.createElement('span');
      badge.className = 'badge';
      let label = '排队中';
      if(t.status === 'processing') label = '处理中';
      if(t.status === 'done'){ label = '已完成'; badge.classList.add('success'); }
      if(t.status === 'failed'){ label = '失败'; badge.classList.add('danger'); }
      badge.textContent = label;
      status.appendChild(badge);
      head.appendChild(name);
      head.appendChild(status);

      const meta = document.createElement('div');
      meta.className = 'small';
      if(t.status === 'queued'){
        const pos = queuePosition(t);
        meta.textContent = `队列位置：${pos + 1}`;
      } else if(t.status === 'failed'){
        meta.textContent = t.error || '处理失败';
      } else if(t.status === 'done'){
        meta.textContent = '处理成功，可下载结果文件';
      } else {
        meta.textContent = '正在处理…';
      }

      const progressWrap = document.createElement('div');
      progressWrap.className = 'progress-wrap';
      const bar = document.createElement('div');
      bar.className = 'progress';
      bar.setAttribute('role','progressbar');
      bar.setAttribute('aria-valuemin','0');
      bar.setAttribute('aria-valuemax','100');
      bar.setAttribute('aria-label','处理进度');
      bar.setAttribute('aria-valuenow', String(t.status === 'processing' ? t.progress : t.status === 'done' ? 100 : 0));
      const fill = document.createElement('span');
      fill.style.width = `${t.status === 'processing' ? t.progress : t.status === 'done' ? 100 : 0}%`;
      bar.appendChild(fill);
      const val = document.createElement('div');
      val.className = 'progress-val small';
      val.textContent = `${t.status === 'processing' ? t.progress : t.status === 'done' ? 100 : 0}%`;
      progressWrap.appendChild(bar);
      progressWrap.appendChild(val);

      const actions = document.createElement('div');
      actions.className = 'result-actions';

      if(t.status === 'done'){
        const download = document.createElement('a');
        download.href = t.resultUrl;
        download.className = 'btn';
        download.download = `${t.file.name}.result.txt`;
        download.textContent = '下载结果';
        download.setAttribute('aria-label', `下载 ${t.file.name} 的结果`);
        actions.appendChild(download);
      }
      if(t.status === 'failed'){
        const retry = document.createElement('button');
        retry.className = 'btn primary';
        retry.type = 'button';
        retry.textContent = '重试';
        retry.addEventListener('click', () => retryTask(t.id));
        actions.appendChild(retry);
      }
      const remove = document.createElement('button');
      remove.className = 'btn';
      remove.type = 'button';
      remove.textContent = '移除';
      remove.addEventListener('click', () => removeTask(t.id));
      actions.appendChild(remove);

      li.appendChild(head);
      li.appendChild(meta);
      li.appendChild(progressWrap);
      li.appendChild(actions);

      taskList.appendChild(li);
    }

    // results grid
    resultCards.innerHTML = '';
    for(const t of tasks.filter(x => x.status === 'done')){
      const card = document.createElement('article');
      card.className = 'result-card';
      card.setAttribute('role','listitem');
      const h = document.createElement('h3');
      h.textContent = t.file.name;
      const p = document.createElement('p');
      p.className = 'small';
      p.textContent = `类型：${t.type} · 质量：${t.params.quality}%`;
      const row = document.createElement('div');
      row.className = 'result-actions';
      const a = document.createElement('a');
      a.href = t.resultUrl;
      a.className = 'btn';
      a.download = `${t.file.name}.result.txt`;
      a.textContent = '下载结果';
      a.setAttribute('aria-label', `下载 ${t.file.name} 的结果`);
      row.appendChild(a);
      card.appendChild(h);
      card.appendChild(p);
      card.appendChild(row);
      resultCards.appendChild(card);
    }

    // mark results busy state
    const hasProcessing = tasks.some(t => t.status === 'processing');
    resultsRegion.setAttribute('aria-busy', hasProcessing ? 'true' : 'false');
  }

  // e2e critical path: select files then start
  startBtn.addEventListener('click', () => {
    const files = Array.from(fileInput.files || []);
    if(files.length === 0){
      showError('请先选择文件');
      return;
    }
    addTasksFromFiles(files);
    // clear input to allow re-select same files next time
    fileInput.value = '';
  });

  // support drag&drop
  const uploader = $('#uploader');
  ;['dragenter','dragover'].forEach(evt => uploader.addEventListener(evt, e => { e.preventDefault(); uploader.classList.add('dragging'); }));
  ;['dragleave','drop'].forEach(evt => uploader.addEventListener(evt, e => { e.preventDefault(); uploader.classList.remove('dragging'); }));
  uploader.addEventListener('drop', e => {
    const dt = e.dataTransfer;
    if(!dt) return;
    const files = Array.from(dt.files || []);
    if(files.length){ addTasksFromFiles(files); }
  });

  // Initial render
  renderTasks();
})();
